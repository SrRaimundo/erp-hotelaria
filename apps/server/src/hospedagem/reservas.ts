import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import type { UsuarioSessao } from "../nucleo/permissoes.js";
import { obterConfig } from "../nucleo/pousada.js";
import { autorizarSupervisor } from "../nucleo/supervisor.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { arredondarCentavos, type Centavos } from "../shared/dinheiro.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";
import { idadeEm, type Data } from "../shared/tempo.js";
import { cotar, exigirEstadiaPermitida } from "../tarifas/cotacao.js";
import { listarCanais } from "../tarifas/regras.js";
import { verificarRestricoes } from "../tarifas/restricoes.js";
import type { ValorNoite } from "../tarifas/tipos.js";
import { verificarDisponibilidade } from "./disponibilidade.js";
import { pagoNaReserva } from "./conta.js";
import type { EstadoReserva } from "./estados.js";

export type NovaReserva = {
  titularId: string;
  categoriaId: string;
  quartoId?: string;
  chegada: Data;
  saida: Data;
  adultos: number;
  criancasNascimento: Data[];
  canal: string;
  observacoes?: string;
  descontoPercentual?: number;
  grupoId?: string;
  autorizacao?: { motivo: string; supervisor: { login: string; senha: string } };
};

export type Reserva = {
  id: string;
  codigo: number;
  estado: EstadoReserva;
  titularId: string;
  categoriaId: string;
  quartoId: string | null;
  chegada: Data;
  saida: Data;
  adultos: number;
  criancasNascimento: Data[];
  canal: string;
  observacoes: string | null;
  grupoId: string | null;
  contaId: string;
  valorSinal: Centavos;
  prazoSinal: string | null;
  avisoSinalEm: string | null;
  criadaEm: string;
};

export type ReservaDetalhe = Reserva & { noites: ValorNoite[]; total: Centavos; pago: Centavos };

export type Grupo = { id: string; titularId: string; cobranca: "unica" | "separada" };

function paraReserva(l: any): Reserva {
  return {
    id: l.id, codigo: l.codigo, estado: l.estado, titularId: l.titular_id, categoriaId: l.categoria_id,
    quartoId: l.quarto_id, chegada: l.chegada, saida: l.saida, adultos: l.adultos,
    criancasNascimento: JSON.parse(l.criancas), canal: l.canal, observacoes: l.observacoes, grupoId: l.grupo_id,
    contaId: l.conta_id, valorSinal: l.valor_sinal, prazoSinal: l.prazo_sinal, avisoSinalEm: l.aviso_sinal_em,
    criadaEm: l.criada_em,
  };
}

async function exigirTitular(ctx: Contexto, id: string): Promise<void> {
  const h = await ctx.db.selectFrom("hospedes").select("id").where("id", "=", id).executeTakeFirst();
  if (!h) throw new ErroDominio("HOSPEDE_NAO_ENCONTRADO", "Hóspede não encontrado. Cadastre o hóspede antes de reservar.", { id });
}

export async function criarGrupo(
  ctx: Contexto,
  d: { titularId: string; cobranca: "unica" | "separada" },
  usuario: UsuarioSessao,
): Promise<Grupo> {
  return emTransacao(ctx, async (tx) => {
    await exigirTitular(tx, d.titularId);
    const g: Grupo = { id: novoId(), titularId: d.titularId, cobranca: d.cobranca };
    await tx.db.insertInto("grupos").values({ id: g.id, titular_id: g.titularId, cobranca: g.cobranca }).execute();
    await auditar(tx, { ator: usuario.id, acao: "grupo.criar", alvoTipo: "grupo", alvoId: g.id, dados: g });
    return g;
  });
}

/** Capacidade: quem já tem idade de adulto na chegada conta como adulto. */
export async function verificarCapacidade(
  ctx: Contexto,
  categoria: { nome: string; max_adultos: number; max_criancas: number },
  adultosInformados: number,
  criancasNascimento: Data[],
  chegada: Data,
): Promise<void> {
  const config = await obterConfig(ctx);
  const criancas = criancasNascimento.filter((n) => idadeEm(n, chegada) < config.idadeAdulto);
  const adultos = adultosInformados + (criancasNascimento.length - criancas.length);
  if (adultos > categoria.max_adultos || criancas.length > categoria.max_criancas) {
    throw new ErroDominio(
      "CAPACIDADE_EXCEDIDA",
      `A categoria ${categoria.nome} comporta no máximo ${categoria.max_adultos} adultos e ${categoria.max_criancas} crianças. Reduza os hóspedes ou escolha outra categoria.`,
      { adultos, criancas: criancas.length, maxAdultos: categoria.max_adultos, maxCriancas: categoria.max_criancas },
    );
  }
}

export async function criarReserva(ctx: Contexto, d: NovaReserva, usuario: UsuarioSessao): Promise<Reserva> {
  if (!(d.chegada < d.saida)) {
    throw new ErroDominio("DATAS_INVALIDAS", "A saída deve ser depois da chegada. Corrija as datas.");
  }
  exigirEstadiaPermitida(d.chegada, d.saida);
  await exigirTitular(ctx, d.titularId);
  if (!(await listarCanais(ctx)).some((c) => c.nome === d.canal)) {
    throw new ErroDominio("CANAL_INEXISTENTE", `O canal "${d.canal}" não está cadastrado. Escolha um canal existente.`, { canal: d.canal });
  }
  const categoria = await ctx.db.selectFrom("categorias").select(["nome", "max_adultos", "max_criancas"]).where("id", "=", d.categoriaId).executeTakeFirst();
  if (!categoria) throw new ErroDominio("CATEGORIA_NAO_ENCONTRADA", "Categoria não encontrada. Escolha uma categoria existente.");
  if (d.quartoId) {
    const quarto = await ctx.db.selectFrom("quartos").select("categoria_id").where("id", "=", d.quartoId).executeTakeFirst();
    if (!quarto) throw new ErroDominio("QUARTO_NAO_ENCONTRADO", "Quarto não encontrado.");
    if (quarto.categoria_id !== d.categoriaId) {
      throw new ErroDominio("QUARTO_FORA_DA_CATEGORIA", "O quarto escolhido não pertence à categoria da reserva. Escolha outro quarto.");
    }
  }

  const config = await obterConfig(ctx);
  await verificarCapacidade(ctx, categoria, d.adultos, d.criancasNascimento, d.chegada);

  // Autorização de supervisor (scrypt é lento): fora da transação e só quando necessária.
  const desconto = d.descontoPercentual ?? 0;
  const violacoes = await verificarRestricoes(ctx, d.categoriaId, d.chegada, d.saida);
  if (violacoes.length > 0 && !d.autorizacao) {
    throw new ErroDominio("RESTRICAO_TARIFARIA", "Estas datas têm restrição de venda. Peça a autorização de um supervisor para continuar.", violacoes);
  }
  const autorizado =
    violacoes.length > 0 || desconto > usuario.limiteDesconto
      ? await autorizarSupervisor(ctx, d.autorizacao?.supervisor, d.autorizacao?.motivo)
      : undefined;

  return emTransacao(ctx, async (tx) => {
    await verificarDisponibilidade(tx, { categoriaId: d.categoriaId, quartoId: d.quartoId, chegada: d.chegada, saida: d.saida });
    const cotacao = await cotar(tx, {
      categoriaId: d.categoriaId, chegada: d.chegada, saida: d.saida, canal: d.canal,
      hospedes: { adultos: d.adultos, criancasNascimento: d.criancasNascimento },
    });
    if (cotacao.violacoes.length > 0 && !autorizado) {
      throw new ErroDominio("RESTRICAO_TARIFARIA", "Estas datas têm restrição de venda. Peça a autorização de um supervisor para continuar.", cotacao.violacoes);
    }
    const noites: ValorNoite[] = cotacao.noites.map((n) => {
      if (desconto <= 0) return n;
      const valor = arredondarCentavos(n.valor * (1 - desconto / 100));
      return { data: n.data, valor, passos: [...n.passos, { rotulo: `Desconto −${desconto}%`, valor }] };
    });
    const total = noites.reduce((s, n) => s + n.valor, 0);

    const canal = (await listarCanais(tx)).find((c) => c.nome === d.canal)!;
    const agora = tx.relogio.agora();
    const exigeSinal = config.sinal.exigir && canal.exigeSinal;
    const valorSinal = exigeSinal
      ? config.sinal.tipo === "percentual"
        ? arredondarCentavos((total * config.sinal.percentual) / 100)
        : noites[0]!.valor
      : 0;
    // Sinal zero já está pago: a reserva nasce confirmada.
    const comSinal = exigeSinal && valorSinal > 0;
    const prazoSinal = comSinal ? new Date(agora.getTime() + config.sinal.prazoHoras * 3_600_000).toISOString() : null;

    // Conta: grupo de cobrança única compartilha a conta; senão, conta nova.
    let contaId: string | undefined;
    if (d.grupoId) {
      const grupo = await tx.db.selectFrom("grupos").selectAll().where("id", "=", d.grupoId).executeTakeFirst();
      if (!grupo) throw new ErroDominio("GRUPO_NAO_ENCONTRADO", "Grupo não encontrado. Crie o grupo antes de reservar.");
      if (grupo.cobranca === "unica") {
        const irma = await tx.db.selectFrom("reservas").select("conta_id").where("grupo_id", "=", d.grupoId).orderBy("codigo").executeTakeFirst();
        contaId = irma?.conta_id;
        if (!contaId) {
          contaId = novoId();
          await tx.db.insertInto("contas").values({ id: contaId, titular_id: grupo.titular_id, situacao: "aberta" }).execute();
        }
      }
    }
    if (!contaId) {
      contaId = novoId();
      await tx.db.insertInto("contas").values({ id: contaId, titular_id: d.titularId, situacao: "aberta" }).execute();
    }

    const ultimo = await tx.db.selectFrom("reservas").select((eb) => eb.fn.max("codigo").as("m")).executeTakeFirst();
    const id = novoId();
    const linha = {
      id, codigo: Number(ultimo?.m ?? 0) + 1, estado: comSinal ? "pre_reserva" : "confirmada",
      titular_id: d.titularId, categoria_id: d.categoriaId, quarto_id: d.quartoId ?? null,
      chegada: d.chegada, saida: d.saida, adultos: d.adultos, criancas: JSON.stringify(d.criancasNascimento),
      canal: d.canal, observacoes: d.observacoes ?? null, grupo_id: d.grupoId ?? null, conta_id: contaId,
      valor_sinal: valorSinal, prazo_sinal: prazoSinal, aviso_sinal_em: null, criada_em: agora.toISOString(),
    };
    await tx.db.insertInto("reservas").values(linha).execute();
    for (const n of noites) {
      await tx.db.insertInto("reserva_noites").values({ reserva_id: id, data: n.data, valor: n.valor, passos: JSON.stringify(n.passos) }).execute();
    }
    await auditar(tx, {
      ator: usuario.id, acao: "reserva.criar", alvoTipo: "reserva", alvoId: id,
      ...(autorizado ? { motivo: autorizado.motivo, supervisorId: autorizado.supervisorId } : {}),
      dados: { codigo: linha.codigo, estado: linha.estado, total, valorSinal, descontoPercentual: desconto, violacoes: cotacao.violacoes.map((v) => v.codigo) },
    });
    await registrarEvento(tx, "hospedagem.ReservaCriada", { reservaId: id, codigo: linha.codigo, estado: linha.estado });
    return paraReserva(linha);
  });
}

export async function obterReserva(ctx: Contexto, id: string): Promise<ReservaDetalhe> {
  const l = await ctx.db.selectFrom("reservas").selectAll().where("id", "=", id).executeTakeFirst();
  if (!l) throw new ErroDominio("RESERVA_NAO_ENCONTRADA", "Reserva não encontrada. Confira o número informado.", { id });
  const ns = await ctx.db.selectFrom("reserva_noites").selectAll().where("reserva_id", "=", id).orderBy("data").execute();
  const noites: ValorNoite[] = ns.map((n) => ({ data: n.data, valor: n.valor, passos: JSON.parse(n.passos) }));
  return { ...paraReserva(l), noites, total: noites.reduce((s, n) => s + n.valor, 0), pago: await pagoNaReserva(ctx, id) };
}
