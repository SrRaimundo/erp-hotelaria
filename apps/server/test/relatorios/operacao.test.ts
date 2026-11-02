import { beforeEach, describe, expect, test } from "vitest";
import { lancar, registrarPagamento } from "../../src/hospedagem/conta.js";
import { bloquear } from "../../src/hospedagem/governanca.js";
import { criarGrupo, criarReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { criarApp } from "../../src/http/app.js";
import { abrirCaixa, fecharCaixa } from "../../src/nucleo/caixa.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { criarQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao, entrar } from "../../src/nucleo/sessoes.js";
import { criarUsuario } from "../../src/nucleo/usuarios.js";
import { salvarCanal, salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>; // dia hoteleiro: 2026-11-10
let app: ReturnType<typeof criarApp>;
let h: { authorization: string };
let hAdmin: { authorization: string };
let recepcao: UsuarioSessao;
let dados: NovaReserva;
let q11: string, q12: string, q13: string;

async function sessao(login: string): Promise<UsuarioSessao> {
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", login).executeTakeFirstOrThrow();
  return (await carregarUsuarioSessao(ctx, l.id))!;
}
async function gerar(url: string, cab = h): Promise<{ status: number; corpo: any }> {
  const r = await app.inject({ method: "GET", url, headers: cab });
  return { status: r.statusCode, corpo: r.json() };
}

beforeEach(async () => {
  ctx = await criarContextoTeste();
  app = criarApp(ctx);
  const std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 2, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  await salvarCanal(ctx, { nome: "Site", percentual: 0, exigeSinal: false }, "u1");
  q11 = (await criarQuarto(ctx, { numero: "11", categoriaId: std }, "u1")).id;
  q12 = (await criarQuarto(ctx, { numero: "12", categoriaId: std }, "u1")).id;
  q13 = (await criarQuarto(ctx, { numero: "13", categoriaId: std }, "u1")).id;
  await criarQuarto(ctx, { numero: "14", categoriaId: std }, "u1");
  hAdmin = await entrarComo(ctx, "admin");
  h = await entrarComo(ctx, "recepcao");
  recepcao = await sessao("teste-recepcao");
  await salvarHospede(ctx, { id: "h1", nome: "Maria Silva", documentoTipo: "cpf", documento: "529.982.247-25", nascimento: "1990-01-01", nacionalidade: "BR", telefone: "11988887777", email: "maria@ex.com" }, "u1");
  await salvarHospede(ctx, { id: "h2", nome: "João Pereira", documentoTipo: "passaporte", documento: "AB123456", nascimento: "1985-01-01", nacionalidade: "BR" }, "u1");
  dados = { titularId: "h1", categoriaId: std, chegada: "2026-11-08", saida: "2026-11-12", adultos: 2, criancasNascimento: [], canal: "Balcão" };
});

describe("limpeza", () => {
  test("lista sujos, arrumações e fora de uso, com colunas em branco para preencher", async () => {
    const r1 = await criarReserva(ctx, dados, recepcao);
    await ctx.db.updateTable("reservas").set({ estado: "hospedada", quarto_id: q11 }).where("id", "=", r1.id).execute();
    await ctx.db.updateTable("quartos").set({ situacao: "ocupado" }).where("id", "=", q11).execute();
    await ctx.db.updateTable("quartos").set({ situacao: "sujo" }).where("id", "=", q12).execute();
    await bloquear(ctx, q13, "Vazamento no banheiro", recepcao);
    const r = await gerar("/api/relatorios/limpeza");
    expect(r.status).toBe(200);
    const s = r.corpo.secoes[0];
    expect(s.colunas.map((c: any) => [c.chave, c.tipo])).toEqual([
      ["quarto", "texto"], ["situacao", "texto"], ["servico", "texto"], ["hospedadoAte", "data"], ["motivo", "texto"], ["feito", "em-branco"], ["camareira", "em-branco"],
    ]);
    expect(s.linhas).toEqual([
      expect.objectContaining({ quarto: "12", situacao: "Sujo", servico: "Limpeza de saída" }),
      expect.objectContaining({ quarto: "11", situacao: "Ocupado", servico: "Arrumação", hospedadoAte: "2026-11-12" }),
      expect.objectContaining({ quarto: "13", situacao: "Bloqueado", servico: null, motivo: "Vazamento no banheiro" }),
    ]);
    expect(r.corpo.resumo).toEqual([
      { rotulo: "Limpezas de saída", valor: "1" }, { rotulo: "Arrumações", valor: "1" }, { rotulo: "Fora de uso", valor: "1" },
    ]);
  });

  test("só quartos ativos, como a lista da governança", async () => {
    await ctx.db.updateTable("quartos").set({ situacao: "sujo" }).where("id", "in", [q11, q12]).execute();
    await ctx.db.updateTable("quartos").set({ ativo: 0 }).where("id", "=", q12).execute();
    expect((await gerar("/api/relatorios/limpeza")).corpo.secoes[0].linhas.map((l: any) => l.quarto)).toEqual(["11"]);
  });

  test("sem tarefas: lista vazia e 403 sem permissão", async () => {
    expect((await gerar("/api/relatorios/limpeza")).corpo.secoes[0].linhas).toEqual([]);
    expect((await gerar("/api/relatorios/limpeza", await entrarComo(ctx, "governanca"))).status).toBe(403);
  });
});

describe("conta", () => {
  test("estadia, extrato com estorno, totais e saldo", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await abrirCaixa(ctx, recepcao.id, 10000);
    await lancar(ctx, { contaId: r.contaId, reservaId: r.id, tipo: "extra", origem: "hospedagem", descricao: "Lavanderia", quantidade: 2, valorUnitario: 1500, setor: "recepcao" }, "u1");
    await lancar(ctx, { contaId: r.contaId, reservaId: r.id, tipo: "extra", origem: "hospedagem", descricao: "Frigobar", quantidade: 1, valorUnitario: 700, setor: "recepcao" }, "u1");
    await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 1000 }, recepcao);
    const g = await gerar(`/api/relatorios/conta?reserva=${r.id}`);
    expect(g.status).toBe(200);
    const [estadia, extrato] = g.corpo.secoes;
    expect(estadia.linhas[0]).toEqual(expect.objectContaining({ codigo: r.codigo, hospede: "Maria Silva", quarto: "a definir", categoria: "Standard", chegada: "2026-11-08", saida: "2026-11-12", noites: 4, pessoas: 2 }));
    // o relógio de teste é fixo: a ordem entre instantes iguais é por id, então comparamos sem ordem
    expect(extrato.linhas.map((l: any) => l.descricao).sort()).toEqual(["Frigobar", "Lavanderia", "Pagamento (pix)"]);
    expect(extrato.linhas.find((l: any) => l.descricao === "Lavanderia")).toEqual(expect.objectContaining({ debito: 3000, credito: null }));
    expect(extrato.linhas.find((l: any) => l.credito === 1000)).toEqual(expect.objectContaining({ debito: null }));
    const { debito, credito } = extrato.totais;
    expect(credito).toBe(1000);
    expect(g.corpo.resumo.map((x: any) => x.rotulo)).toEqual(["Débitos", "Créditos", "Saldo"]);
    expect(g.corpo.resumo[1].valor.replace(/\s/g, " ")).toMatch(/10,00/);
    expect(debito - credito).toBeGreaterThan(0);
  });

  test("reserva ausente: 422; inexistente: 422 RESERVA_NAO_ENCONTRADA; cancelada ainda imprime", async () => {
    expect((await gerar("/api/relatorios/conta")).status).toBe(422);
    const x = await gerar("/api/relatorios/conta?reserva=nao-existe");
    expect(x.status).toBe(422);
    expect(x.corpo.codigo).toBe("RESERVA_NAO_ENCONTRADA");
    const r = await criarReserva(ctx, dados, recepcao);
    await ctx.db.updateTable("reservas").set({ estado: "cancelada" }).where("id", "=", r.id).execute();
    expect((await gerar(`/api/relatorios/conta?reserva=${r.id}`)).corpo.secoes[0].linhas[0].situacao).toBe("Cancelada");
  });
});

describe("grupo com conta única", () => {
  test("check-in e check-out mostram o saldo da conta só na primeira linha; conta lista todas as reservas", async () => {
    const g = await criarGrupo(ctx, { titularId: "h1", cobranca: "unica" }, recepcao);
    const a = await criarReserva(ctx, { ...dados, grupoId: g.id, chegada: "2026-11-10", saida: "2026-11-12" }, recepcao);
    const b = await criarReserva(ctx, { ...dados, titularId: "h2", grupoId: g.id, chegada: "2026-11-10", saida: "2026-11-12" }, recepcao);
    expect(a.contaId).toBe(b.contaId);
    await ctx.db.updateTable("reservas").set({ quarto_id: q11 }).where("id", "=", a.id).execute();
    await ctx.db.updateTable("reservas").set({ quarto_id: q12 }).where("id", "=", b.id).execute();
    await lancar(ctx, { contaId: a.contaId, reservaId: a.id, tipo: "extra", origem: "hospedagem", descricao: "Lavanderia", quantidade: 1, valorUnitario: 4000, setor: "recepcao" }, "u1");
    for (const rel of ["check-in", "check-out"]) {
      const g1 = await gerar(`/api/relatorios/${rel}?data=${rel === "check-in" ? "2026-11-10" : "2026-11-12"}`);
      const linhas = g1.corpo.secoes[0].linhas;
      expect(linhas.map((l: any) => [l.quarto, l.saldo])).toEqual([["11", 4000], ["12", null]]);
    }
    const c = await gerar(`/api/relatorios/conta?reserva=${b.id}`);
    expect(c.corpo.subtitulo).toContain("Conta do grupo (2 reservas)");
    const [estadias, extrato] = c.corpo.secoes;
    expect(estadias.titulo).toBe("Estadias na conta do grupo");
    expect(estadias.linhas.map((l: any) => [l.quarto, l.hospede])).toEqual([["11", "Maria Silva"], ["12", "João Pereira"]]);
    expect(extrato.linhas.map((l: any) => l.descricao)).toContain("Lavanderia"); // lançada na reserva irmã, vale para a conta toda
    expect(c.corpo.resumo[2].rotulo).toBe("Saldo");
  });

  test("irmãs canceladas ou no-show ficam fora da lista de estadias e da contagem do grupo", async () => {
    const g = await criarGrupo(ctx, { titularId: "h1", cobranca: "unica" }, recepcao);
    const dg = { ...dados, grupoId: g.id, chegada: "2026-11-10", saida: "2026-11-12" };
    const a = await criarReserva(ctx, dg, recepcao);
    const b = await criarReserva(ctx, { ...dg, titularId: "h2" }, recepcao);
    const c3 = await criarReserva(ctx, dg, recepcao);
    await ctx.db.updateTable("reservas").set({ estado: "cancelada" }).where("id", "=", b.id).execute();
    await ctx.db.updateTable("reservas").set({ estado: "no_show" }).where("id", "=", c3.id).execute();
    // sobrou só uma ativa: não é mais "grupo"
    const so = await gerar(`/api/relatorios/conta?reserva=${a.id}`);
    expect(so.corpo.subtitulo).not.toContain("grupo");
    expect(so.corpo.secoes[0].titulo).toBe("Estadia");
    expect(so.corpo.secoes[0].linhas).toHaveLength(1);
    // a própria reserva pedida entra mesmo cancelada; a irmã no-show continua fora
    const pedida = await gerar(`/api/relatorios/conta?reserva=${b.id}`);
    expect(pedida.corpo.secoes[0].linhas.map((l: any) => l.situacao).sort()).toEqual(["Cancelada", "Pré-reserva"]);
    // com duas ativas, conta só as duas
    const d = await criarReserva(ctx, { ...dg, titularId: "h2" }, recepcao);
    const dois = await gerar(`/api/relatorios/conta?reserva=${d.id}`);
    expect(dois.corpo.subtitulo).toContain("Conta do grupo (2 reservas)");
    expect(dois.corpo.secoes[0].linhas).toHaveLength(2);
  });
});

describe("hóspedes", () => {
  test("lista com estadias finalizadas e última saída; busca por nome e documento", async () => {
    for (const [ch, sa] of [["2026-10-01", "2026-10-03"], ["2026-10-20", "2026-10-22"]]) {
      const r = await criarReserva(ctx, { ...dados, chegada: ch!, saida: sa! }, recepcao);
      await ctx.db.updateTable("reservas").set({ estado: "finalizada" }).where("id", "=", r.id).execute();
    }
    const todos = await gerar("/api/relatorios/hospedes");
    expect(todos.status).toBe(200);
    expect(todos.corpo.secoes[0].linhas).toEqual([
      expect.objectContaining({ nome: "João Pereira", estadias: 0, ultimaSaida: null, telefone: null }),
      expect.objectContaining({ nome: "Maria Silva", estadias: 2, ultimaSaida: "2026-10-22", telefone: "11988887777", email: "maria@ex.com" }),
    ]);
    expect((await gerar("/api/relatorios/hospedes?busca=joao")).corpo.secoes[0].linhas.map((l: any) => l.nome)).toEqual(["João Pereira"]);
    expect((await gerar("/api/relatorios/hospedes?busca=AB1234")).corpo.secoes[0].linhas.map((l: any) => l.nome)).toEqual(["João Pereira"]);
    expect((await gerar("/api/relatorios/hospedes?busca=zzzz")).corpo.secoes[0].linhas).toEqual([]);
  });

  test("cada geração é auditada com ator, filtro e quantidade; falha de permissão não audita", async () => {
    await gerar("/api/relatorios/hospedes?busca=maria");
    await gerar("/api/relatorios/hospedes?busca=");
    await gerar(`/api/relatorios/hospedes?busca=${"x".repeat(101)}`); // 422: não audita
    await gerar("/api/relatorios/hospedes", await entrarComo(ctx, "governanca")); // 403: não audita
    const a = await ctx.db.selectFrom("auditoria").selectAll().where("acao", "=", "relatorio.hospedes").orderBy("instante").execute();
    expect(a).toHaveLength(2);
    expect(a.every((x) => x.ator === recepcao.id)).toBe(true);
    const dados = a.map((x) => JSON.parse(x.dados)).sort((x, y) => Number(x.comFiltro) - Number(y.comFiltro));
    expect(dados).toEqual([{ comFiltro: false, total: 2 }, { comFiltro: true, total: 1 }]);
    expect(JSON.stringify(a)).not.toContain("maria"); // o termo buscado nunca vai para a auditoria
  });
});

describe("caixa", () => {
  let outra: UsuarioSessao;
  let hOutra: { authorization: string };
  let turnoRecepcao: string;
  let turnoOutra: string;

  beforeEach(async () => {
    await criarUsuario(ctx, { nome: "Outra Recepção", login: "outra", senha: "senha-teste", perfil: "recepcao" }, "admin");
    hOutra = { authorization: `Bearer ${(await entrar(ctx, "outra", "senha-teste")).token}` };
    outra = await sessao("outra");
    const r = await criarReserva(ctx, dados, recepcao);
    turnoRecepcao = (await abrirCaixa(ctx, recepcao.id, 20000)).id;
    await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 5000 }, recepcao);
    await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "dinheiro", valor: 3000 }, recepcao);
    await fecharCaixa(ctx, recepcao.id, { dinheiro: 22500, pix: 5000 });
    turnoOutra = (await abrirCaixa(ctx, outra.id, 1000)).id;
  });

  test("turno fechado: esperado recalculado, contado do turno e diferença por forma, com movimentos", async () => {
    const g = await gerar(`/api/relatorios/caixa?inicio=2026-11-10&fim=2026-11-10&turno=${turnoRecepcao}`);
    expect(g.status).toBe(200);
    const [turnos, formas, movs] = g.corpo.secoes;
    expect(turnos.linhas).toHaveLength(1); // só o próprio turno
    expect(turnos.linhas[0]).toEqual(expect.objectContaining({ operador: "Teste recepcao", situacao: "Fechado", valorInicial: 20000 }));
    expect(formas.linhas).toEqual([
      { forma: "Dinheiro", esperado: 23000, contado: 22500, diferenca: -500 },
      { forma: "Pix", esperado: 5000, contado: 5000, diferenca: 0 },
    ]);
    expect(formas.totais).toEqual({ esperado: 28000, contado: 27500, diferenca: -500 });
    expect(movs.linhas.map((m: any) => [m.forma, m.valor]).sort()).toEqual([["Dinheiro", 3000], ["Pix", 5000]]);
    expect(movs.totais).toEqual({ valor: 8000 });
    expect(movs.colunas.map((c: any) => c.chave)).toEqual(["data", "hora", "forma", "origem", "valor"]);
  });

  test("turno aberto: sem contado nem diferença", async () => {
    const g = await gerar(`/api/relatorios/caixa?turno=${turnoOutra}`, hOutra);
    const formas = g.corpo.secoes[1];
    expect(formas.linhas).toEqual([{ forma: "Dinheiro", esperado: 1000, contado: null, diferenca: null }]);
    expect(g.corpo.resumo).toContainEqual({ rotulo: "Fechamento", valor: "Em aberto" });
  });

  test("só os próprios turnos; admin (config.gerenciar) vê todos", async () => {
    // turno de outro operador responde igual a turno inexistente
    const alheio = await gerar(`/api/relatorios/caixa?turno=${turnoOutra}`);
    const inexistente = await gerar("/api/relatorios/caixa?turno=nao-existe");
    expect(alheio.status).toBe(422);
    expect(alheio.corpo.codigo).toBe("TURNO_NAO_ENCONTRADO");
    expect({ ...alheio.corpo, detalhes: null }).toEqual({ ...inexistente.corpo, detalhes: null });
    expect((await gerar("/api/relatorios/caixa")).corpo.secoes[0].linhas).toHaveLength(1);
    const adm = await gerar(`/api/relatorios/caixa?turno=${turnoOutra}`, hAdmin);
    expect(adm.status).toBe(200);
    expect(adm.corpo.secoes[0].linhas).toHaveLength(2);
    expect((await gerar("/api/relatorios/caixa?turno=nao-existe")).corpo.codigo).toBe("TURNO_NAO_ENCONTRADO");
  });

  test("exige caixa.operar", async () => {
    expect((await gerar("/api/relatorios/caixa", await entrarComo(ctx, "governanca"))).status).toBe(403);
  });

  test("período inválido: 422", async () => {
    expect((await gerar("/api/relatorios/caixa?inicio=2026-11-12&fim=2026-11-10")).status).toBe(422);
    expect((await gerar("/api/relatorios/caixa?inicio=lixo")).status).toBe(422);
  });

  test("GET /api/relatorios/caixa/turnos lista turnos do período (não cai em :id)", async () => {
    const r = await gerar("/api/relatorios/caixa/turnos?inicio=2026-11-10&fim=2026-11-10");
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual([expect.objectContaining({ id: turnoRecepcao, operador: "Teste recepcao", situacao: "fechado", valorInicial: 20000 })]);
    expect((await gerar("/api/relatorios/caixa/turnos?inicio=2026-11-10&fim=2026-11-10", hAdmin)).corpo).toHaveLength(2);
    expect((await gerar("/api/relatorios/caixa/turnos?inicio=2026-11-01&fim=2026-11-09")).corpo).toEqual([]);
    expect((await gerar("/api/relatorios/caixa/turnos", await entrarComo(ctx, "governanca"))).status).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/relatorios/caixa/turnos" })).statusCode).toBe(401);
    expect((await gerar("/api/relatorios/caixa/turnos?inicio=x")).status).toBe(422);
  });

  test("o turno pertence ao dia hoteleiro da abertura: entre a meia-noite e a virada ainda é o dia anterior", async () => {
    // 04:00Z = 01:00 local (virada 04:00): dia hoteleiro 11-09, embora o dia civil seja 11-10
    await ctx.db.updateTable("turnos_caixa").set({ aberto_em: "2026-11-10T04:00:00.000Z" }).where("id", "=", turnoOutra).execute();
    ctx.relogio.definir("2026-11-10T05:00:00Z"); // 02:00 local: "hoje" é 11-09
    const padrao = await gerar("/api/relatorios/caixa/turnos", hAdmin);
    expect(padrao.corpo.map((t: any) => t.id)).toEqual([turnoOutra]);
    expect((await gerar("/api/relatorios/caixa", hAdmin)).corpo.secoes[0].linhas).toHaveLength(1);
    expect((await gerar("/api/relatorios/caixa/turnos?inicio=2026-11-10&fim=2026-11-10", hAdmin)).corpo.map((t: any) => t.id)).toEqual([turnoRecepcao]);
    expect((await gerar("/api/relatorios/caixa/turnos?inicio=2026-11-09&fim=2026-11-09", hAdmin)).corpo.map((t: any) => t.id)).toEqual([turnoOutra]);
  });

  test("período considera o dia local (fuso), não o UTC", async () => {
    // 01:30Z de 11-11 é 22:30 de 11-10 em São Paulo
    await ctx.db.updateTable("turnos_caixa").set({ aberto_em: "2026-11-11T01:30:00.000Z" }).where("id", "=", turnoRecepcao).execute();
    expect((await gerar("/api/relatorios/caixa/turnos?inicio=2026-11-10&fim=2026-11-10")).corpo).toHaveLength(1);
    expect((await gerar("/api/relatorios/caixa/turnos?inicio=2026-11-11&fim=2026-11-11")).corpo).toHaveLength(0);
  });
});
