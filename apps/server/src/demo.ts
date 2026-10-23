import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { lerConfiguracao } from "./config.js";
import { fazerCheckin } from "./hospedagem/checkin.js";
import { lancar, registrarPagamento } from "./hospedagem/conta.js";
import { colocarEmManutencao } from "./hospedagem/governanca.js";
import { criarGrupo, criarReserva, type NovaReserva, type Reserva } from "./hospedagem/reservas.js";
import { processarVirada } from "./hospedagem/virada.js";
import { Barramento } from "./infra/barramento.js";
import { abrirCaixa, fecharCaixa } from "./nucleo/caixa.js";
import { criarCategoria } from "./nucleo/categorias.js";
import { cpfValido, salvarHospede, type Hospede } from "./nucleo/hospedes.js";
import { obterConfig, salvarConfig } from "./nucleo/pousada.js";
import { criarProduto } from "./nucleo/produtos.js";
import { criarQuarto, mudarSituacaoQuarto, type Quarto } from "./nucleo/quartos.js";
import { carregarUsuarioSessao } from "./nucleo/sessoes.js";
import { criarUsuario } from "./nucleo/usuarios.js";
import { abrirBanco, migrar } from "./shared/banco.js";
import { emTransacao, type Contexto } from "./shared/contexto.js";
import { ErroDominio } from "./shared/erros.js";
import { todasMigracoes } from "./shared/migracoes.js";
import { RelogioFixo, relogioSistema } from "./shared/relogio.js";
import { diaHoteleiro, somarDias, type Data } from "./shared/tempo.js";
import { salvarCanal, salvarPercentualDiaSemana, salvarTabelaBase, salvarTemporada } from "./tarifas/regras.js";

/** Gera um CPF válido (dígitos verificadores calculados) a partir de um número base de 9 dígitos. */
function gerarCpf(base: number): string {
  const nove = String(base % 1_000_000_000).padStart(9, "0");
  const digitos = nove.split("").map(Number);
  for (const n of [9, 10]) {
    const soma = digitos.slice(0, n).reduce((s, d, i) => s + d * (n + 1 - i), 0);
    digitos.push(((soma * 10) % 11) % 10);
  }
  const cpf = digitos.join("");
  if (!cpfValido(cpf)) throw new Error(`CPF gerado inválido: ${cpf}`);
  return cpf;
}

const NOMES = [
  "Maria das Graças Silva", "João Pedro Almeida", "Ana Beatriz Costa", "Carlos Eduardo Lima", "Fernanda Oliveira",
  "Ricardo Souza Pereira", "Luciana Barbosa", "Paulo Henrique Rocha", "Juliana Martins", "Marcos Vinícius Teixeira",
  "Patrícia Gomes", "Rafael Carvalho", "Camila Ribeiro", "Eduardo Nogueira", "Beatriz Fernandes",
];

// O fuso padrão da pousada (America/Sao_Paulo) é UTC-3 o ano todo: 15:00 local = 18:00 UTC.
const instante = (dia: Data, horaLocal: number): string => `${dia}T${String(horaLocal + 3).padStart(2, "0")}:00:00Z`;

const comRelogio = (ctx: Contexto, iso: string): Contexto => ({ ...ctx, relogio: new RelogioFixo(iso) });

/**
 * Povoa uma base vazia com uma pousada de demonstração, tudo relativo ao dia hoteleiro atual (H).
 * O que é passado (hóspedes já instalados, diárias) nasce pelos serviços de domínio com um relógio
 * fixo no instante necessário. Tudo ocorre numa única transação: se algo falhar, a base fica vazia.
 */
export async function semearDemonstracao(ctx: Contexto): Promise<{ quartos: number; reservas: number }> {
  const existentes = await ctx.db.selectFrom("quartos").select("id").executeTakeFirst();
  if (existentes) {
    throw new ErroDominio("BASE_NAO_VAZIA", "A base já tem quartos cadastrados. A pousada de demonstração só pode ser criada em uma base vazia.");
  }

  return emTransacao(ctx, async (tx) => {
    const agora = tx.relogio.agora();
    const adminLinha = await tx.db.selectFrom("usuarios").select("id").where("login", "=", "admin").executeTakeFirstOrThrow();
    const admin = (await carregarUsuarioSessao(tx, adminLinha.id))!;
    const ator = admin.id;

    await salvarConfig(tx, {
      razaoSocial: "Pousada Sol (demonstração)",
      sinal: { exigir: true, tipo: "percentual", percentual: 30, prazoHoras: 48, toleranciaHoras: 12 },
    }, ator);
    const config = await obterConfig(tx);
    const H = diaHoteleiro(agora, config.fuso, config.viradaDia);
    const dia = (n: number): Data => somarDias(H, n);

    // Categorias, quartos e tarifas
    const categorias = {
      standard: await criarCategoria(tx, { nome: "Standard", maxAdultos: 2, maxCriancas: 1, comodidades: ["Ar-condicionado", "TV"] }, ator),
      superior: await criarCategoria(tx, { nome: "Superior", maxAdultos: 3, maxCriancas: 2, comodidades: ["Ar-condicionado", "TV", "Varanda"] }, ator),
      chale: await criarCategoria(tx, { nome: "Chalé", maxAdultos: 4, maxCriancas: 2, comodidades: ["Ar-condicionado", "Cozinha", "Varanda"] }, ator),
    };
    const tabelas: [keyof typeof categorias, Record<1 | 2 | 3, number>, number][] = [
      ["standard", { 1: 22000, 2: 28000, 3: 34000 }, 8000],
      ["superior", { 1: 30000, 2: 38000, 3: 46000 }, 10000],
      ["chale", { 1: 45000, 2: 52000, 3: 60000 }, 12000],
    ];
    for (const [chave, porAdultos, adultoExtra] of tabelas) {
      await salvarTabelaBase(tx, { categoriaId: categorias[chave].id, porAdultos, adultoExtra }, ator);
    }
    const numeros: [keyof typeof categorias, string[]][] = [
      ["standard", ["101", "102", "103", "104", "105", "106"]],
      ["superior", ["201", "202", "203", "204"]],
      ["chale", ["301", "302"]],
    ];
    const quartos = new Map<string, Quarto>();
    for (const [chave, lista] of numeros) {
      for (const numero of lista) quartos.set(numero, await criarQuarto(tx, { numero, categoriaId: categorias[chave].id }, ator));
    }
    const quarto = (numero: string) => quartos.get(numero)!;

    await salvarTemporada(tx, { nome: "Alta", inicio: dia(20), fim: dia(40), prioridade: 1, percentual: 20 }, ator);
    await salvarCanal(tx, { nome: "Balcão", percentual: 0, exigeSinal: false }, ator);
    await salvarCanal(tx, { nome: "Site", percentual: -5, exigeSinal: true }, ator);
    for (const diaSemana of [5, 6]) await salvarPercentualDiaSemana(tx, { dia: diaSemana, percentual: 15 }, ator);

    // Usuários (o admin já existe e mantém a troca de senha obrigatória)
    await criarUsuario(tx, { nome: "Recepção", login: "recepcao", senha: "recepcao123", perfil: "recepcao" }, ator);
    await criarUsuario(tx, { nome: "Governança", login: "governanca", senha: "governanca123", perfil: "governanca" }, ator);
    const frigobar = await criarProduto(tx, { codigo: "FRIGOBAR", nome: "Frigobar", precoCentavos: 1800, unidade: "un", grupo: "frigobar", tipo: "produto" }, ator);

    // Hóspedes (o índice 6 fica sem documento, para mostrar a pendência da FNRH)
    const cidades: [string, string][] = [["Recife", "PE"], ["Olinda", "PE"], ["Salvador", "BA"], ["São Paulo", "SP"], ["Fortaleza", "CE"]];
    const hospedes: Hospede[] = [];
    for (const [i, nome] of NOMES.entries()) {
      const [cidade, uf] = cidades[i % cidades.length]!;
      hospedes.push(await salvarHospede(tx, {
        nome,
        documentoTipo: "cpf",
        documento: i === 6 ? null : gerarCpf(123_456_789 + i * 7_919_123),
        nascimento: `${1960 + ((i * 3) % 40)}-${String((i % 12) + 1).padStart(2, "0")}-${String(((i * 5) % 27) + 1).padStart(2, "0")}`,
        nacionalidade: "BR",
        telefone: `8199990${String(i).padStart(4, "0")}`,
        ...(i % 2 === 0 ? { email: `hospede${i + 1}@exemplo.com.br` } : {}),
        endereco: { logradouro: `Rua das Palmeiras, ${10 + i}`, cidade, uf, pais: "BR" },
      }, ator));
    }
    const h = (i: number) => hospedes[i]!.id;

    const reservas: Reserva[] = [];
    const reservar = async (c: Contexto, d: Pick<NovaReserva, "titularId" | "categoriaId" | "chegada" | "saida"> & Partial<NovaReserva>) => {
      const r = await criarReserva(c, { adultos: 2, criancasNascimento: [], canal: "Balcão", ...d }, admin);
      reservas.push(r);
      return r;
    };

    // Hospedadas: reserva e check-in no dia da chegada (relógio no passado). A virada lança as diárias.
    const hospedadas: [number, keyof typeof categorias, string, number, number][] = [
      [0, "standard", "101", -2, 1],
      [1, "standard", "102", -1, 2],
      [2, "superior", "201", -2, 2],
      [3, "superior", "202", -2, 0], // sai hoje
    ];
    const saemHoje: Reserva[] = [];
    for (const [i, cat, numero, ch, sa] of hospedadas) {
      const passado = comRelogio(tx, instante(dia(ch), 15));
      const r = await reservar(passado, { titularId: h(i), categoriaId: categorias[cat].id, quartoId: quarto(numero).id, chegada: dia(ch), saida: dia(sa) });
      await fazerCheckin(passado, { reservaId: r.id, quartoId: quarto(numero).id, acompanhantes: [] }, admin);
      if (sa === 0) saemHoje.push(r);
    }
    await processarVirada(tx);
    for (const r of saemHoje) {
      await lancar(tx, {
        contaId: r.contaId, reservaId: r.id, tipo: "extra", origem: "hospedagem", produtoId: frigobar.id,
        descricao: "Frigobar", quantidade: 3, valorUnitario: frigobar.precoCentavos,
      }, ator);
    }

    // Chegadas de hoje, confirmadas (uma sem quarto atribuído; o hóspede 6 tem a ficha incompleta)
    await reservar(tx, { titularId: h(4), categoriaId: categorias.standard.id, quartoId: quarto("104").id, chegada: H, saida: dia(2) });
    await reservar(tx, { titularId: h(6), categoriaId: categorias.superior.id, chegada: H, saida: dia(3) });
    await reservar(tx, { titularId: h(5), categoriaId: categorias.superior.id, quartoId: quarto("203").id, chegada: H, saida: dia(1), adultos: 1 });

    // Pré-reserva com o prazo do sinal vencendo em 6 horas (criada 42 horas atrás, com prazo de 48)
    const antes = comRelogio(tx, new Date(agora.getTime() - (config.sinal.prazoHoras - 6) * 3_600_000).toISOString());
    await reservar(antes, { titularId: h(7), categoriaId: categorias.standard.id, chegada: dia(3), saida: dia(5), canal: "Site" });

    // Confirmada que deveria ter chegado ontem
    await reservar(comRelogio(tx, instante(dia(-3), 12)), {
      titularId: h(8), categoriaId: categorias.standard.id, quartoId: quarto("105").id, chegada: dia(-1), saida: dia(1),
    });

    // Grupo com conta única, dois chalés chegando amanhã
    const grupo = await criarGrupo(tx, { titularId: h(9), cobranca: "unica" }, admin);
    for (const numero of ["301", "302"]) {
      await reservar(tx, { titularId: h(9), categoriaId: categorias.chale.id, quartoId: quarto(numero).id, chegada: dia(1), saida: dia(3), grupoId: grupo.id });
    }

    // Reservas futuras; as do Site pagam o sinal (exige caixa aberto, fechado ao final)
    const futuras: [number, keyof typeof categorias, number, number, "Balcão" | "Site"][] = [
      [10, "standard", 4, 6, "Balcão"],
      [11, "superior", 7, 10, "Site"],
      [12, "chale", 12, 14, "Balcão"],
      [13, "standard", 15, 18, "Balcão"],
      [14, "superior", 21, 25, "Site"],
      [0, "standard", 28, 30, "Balcão"],
    ];
    await abrirCaixa(tx, ator, 0);
    let recebido = 0;
    for (const [i, cat, ch, sa, canal] of futuras) {
      const r = await reservar(tx, { titularId: h(i), categoriaId: categorias[cat].id, chegada: dia(ch), saida: dia(sa), canal });
      if (r.valorSinal > 0) {
        await registrarPagamento(tx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: r.valorSinal }, admin);
        recebido += r.valorSinal;
      }
    }
    await fecharCaixa(tx, ator, { pix: recebido, dinheiro: 0 });

    // Governança: 103 sujo (passa por manutenção, único caminho do domínio) e 106 em manutenção
    await mudarSituacaoQuarto(tx, quarto("103").id, "em_manutencao", ator, "limpeza pendente");
    await mudarSituacaoQuarto(tx, quarto("103").id, "sujo", ator);
    await colocarEmManutencao(tx, quarto("106").id, "chuveiro", admin);

    return { quartos: quartos.size, reservas: reservas.length };
  });
}

async function principal(): Promise<void> {
  const config = lerConfiguracao();
  mkdirSync(dirname(config.arquivoBanco), { recursive: true });
  const db = abrirBanco(config.arquivoBanco);
  try {
    await migrar(db, todasMigracoes);
    const ctx: Contexto = { db, relogio: relogioSistema, barramento: new Barramento(), eventosPendentes: [] };
    const r = await semearDemonstracao(ctx);
    console.log(`Pousada de demonstração criada em ${config.arquivoBanco}: ${r.quartos} quartos e ${r.reservas} reservas.`);
    console.log("Logins:");
    console.log("  admin       / admin        (pede a troca da senha no primeiro acesso)");
    console.log("  recepcao    / recepcao123");
    console.log("  governanca  / governanca123");
  } catch (erro) {
    if (erro instanceof ErroDominio && erro.codigo === "BASE_NAO_VAZIA") {
      console.error(`${erro.message} Use um arquivo de banco novo (variável ERP_DB) ou apague o atual.`);
    } else {
      console.error("Não foi possível criar a pousada de demonstração:", erro);
    }
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void principal();
