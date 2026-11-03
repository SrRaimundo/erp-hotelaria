import { beforeEach, describe, expect, test } from "vitest";
import { lancar, registrarPagamento } from "../../src/hospedagem/conta.js";
import { criarGrupo, criarReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { criarApp } from "../../src/http/app.js";
import { abrirCaixa } from "../../src/nucleo/caixa.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { criarQuarto, definirQuartoAtivo } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { salvarCanal, salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>; // dia hoteleiro: 2026-11-10 (terça), virada 04:00, fuso -03
let app: ReturnType<typeof criarApp>;
let h: { authorization: string };
let recepcao: UsuarioSessao;
let dados: NovaReserva;
let std: string, suite: string;
let quartos: string[]; // 4 Standard (11..14)
let quartoSuite: string;
let contador = 0;

async function reserva(nome: string, extra: Partial<NovaReserva>, estado?: string, quartoId?: string) {
  contador++;
  const titularId = `hh${contador}`;
  await salvarHospede(ctx, { id: titularId, nome, documentoTipo: "passaporte", documento: `P${contador}0000`, nascimento: "1985-01-01", nacionalidade: "BR", telefone: `1199999000${contador}` }, "u1");
  const r = await criarReserva(ctx, { ...dados, titularId, ...extra }, recepcao);
  if (estado || quartoId) {
    await ctx.db.updateTable("reservas").set({ ...(estado ? { estado: estado as any } : {}), ...(quartoId ? { quarto_id: quartoId } : {}) }).where("id", "=", r.id).execute();
  }
  return r;
}

async function gerar(id: string, query = "", cab = h): Promise<{ status: number; corpo: any }> {
  const r = await app.inject({ method: "GET", url: `/api/relatorios/${id}${query}`, headers: cab });
  return { status: r.statusCode, corpo: r.json() };
}
async function grupoUnico() {
  await salvarHospede(ctx, { id: "hg", nome: "Titular", documentoTipo: "passaporte", documento: "PG0000", nascimento: "1985-01-01", nacionalidade: "BR" }, "u1");
  return criarGrupo(ctx, { titularId: "hg", cobranca: "unica" }, recepcao);
}
const resumo = (corpo: any): Record<string, string> => Object.fromEntries(corpo.resumo.map((x: any) => [x.rotulo, x.valor]));
const linhaDe = (corpo: any, titulo: string) => corpo.secoes.find((s: any) => s.titulo === titulo).linhas[0];

beforeEach(async () => {
  ctx = await criarContextoTeste();
  app = criarApp(ctx);
  std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 2, comodidades: [] }, "u1")).id;
  suite = (await criarCategoria(ctx, { nome: "Suíte", maxAdultos: 3, maxCriancas: 2, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  await salvarTabelaBase(ctx, { categoriaId: suite, porAdultos: { 1: 40000, 2: 50000, 3: 60000 }, adultoExtra: 8000 }, "u1");
  await salvarCanal(ctx, { nome: "Site", percentual: 0, exigeSinal: false }, "u1");
  await salvarCanal(ctx, { nome: "Booking", percentual: 0, exigeSinal: false }, "u1");
  quartos = [];
  for (const n of ["11", "12", "13", "14"]) quartos.push((await criarQuarto(ctx, { numero: n, categoriaId: std }, "u1")).id);
  quartoSuite = (await criarQuarto(ctx, { numero: "21", categoriaId: suite }, "u1")).id;
  h = await entrarComo(ctx, "recepcao");
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "teste-recepcao").executeTakeFirstOrThrow();
  recepcao = (await carregarUsuarioSessao(ctx, l.id))!;
  dados = { titularId: "x", categoriaId: std, chegada: "2026-11-10", saida: "2026-11-12", adultos: 2, criancasNascimento: [], canal: "Site" };
  contador = 0;
});

describe("permissão", () => {
  test.each(["resumo-dia", "previsao", "desempenho"])("%s: sem reservas.gerenciar 403; sem login 401", async (id) => {
    expect((await gerar(id, "", await entrarComo(ctx, "governanca"))).status).toBe(403);
    expect((await app.inject({ method: "GET", url: `/api/relatorios/${id}` })).statusCode).toBe(401);
    expect((await gerar(id)).status).toBe(200);
  });
});

describe("previsão de ocupação", () => {
  test("padrão: hoje por 14 dias; dia da semana; vazio mostra todos os quartos livres", async () => {
    const r = await gerar("previsao");
    const linhas = r.corpo.secoes[0].linhas;
    expect(linhas).toHaveLength(14);
    expect(linhas[0]).toMatchObject({ data: "2026-11-10", semana: "terça", disponiveis: 5, ocupados: 0, livres: 5, ocupacao: "0,0%", chegadas: 0, saidas: 0, receita: 0 });
    expect(linhas[13].data).toBe("2026-11-23");
    expect(r.corpo.subtitulo).toContain("inclui pré-reservas e confirmadas");
    expect(r.corpo.subtitulo).toContain("não são descontados");
  });

  test("limites: dias entre 1 e 90, número inteiro, data válida", async () => {
    expect((await gerar("previsao", "?dias=90")).corpo.secoes[0].linhas).toHaveLength(90);
    expect((await gerar("previsao", "?dias=1")).corpo.secoes[0].linhas).toHaveLength(1);
    for (const q of ["?dias=91", "?dias=0", "?dias=2.5", "?dias=abc", "?inicio=2026-02-30"]) expect((await gerar("previsao", q)).status, q).toBe(422);
    expect((await gerar("previsao", "?inicio=&dias=")).corpo.secoes[0].linhas).toHaveLength(14);
  });

  test("noite de saída não ocupa; chegada e saída caem no próprio dia; receita vem de reserva_noites", async () => {
    await reserva("A", { chegada: "2026-11-10", saida: "2026-11-12" });
    await reserva("B", { chegada: "2026-11-08", saida: "2026-11-10" }, "hospedada");
    const r = await gerar("previsao", "?inicio=2026-11-09&dias=4");
    const l = r.corpo.secoes[0].linhas;
    expect(l.map((x: any) => [x.data, x.ocupados, x.chegadas, x.saidas, x.receita])).toEqual([
      ["2026-11-09", 1, 0, 0, 30000],
      ["2026-11-10", 1, 1, 1, 30000],
      ["2026-11-11", 1, 0, 0, 30000],
      ["2026-11-12", 0, 0, 1, 0],
    ]);
    expect(r.corpo.secoes[0].totais).toMatchObject({ ocupados: 3, chegadas: 1, saidas: 2, receita: 90000 });
    expect(resumo(r.corpo)["Receita prevista"]).toBe("R$ 900,00");
  });

  test("pré-reserva e confirmada contam; cancelada e no-show não", async () => {
    await reserva("Pre", {}, "pre_reserva");
    await reserva("Conf", {}, "confirmada");
    await reserva("Canc", {}, "cancelada");
    await reserva("Sumiu", {}, "no_show");
    const l = (await gerar("previsao", "?dias=2")).corpo.secoes[0].linhas;
    expect(l[0]).toMatchObject({ ocupados: 2, chegadas: 2, receita: 60000 });
    expect(l[1]).toMatchObject({ ocupados: 2, livres: 3, ocupacao: "40,0%" });
  });

  test("quarto desativado sai dos disponíveis; bloqueado ou em manutenção continua (a situação não tem data)", async () => {
    await definirQuartoAtivo(ctx, quartos[3]!, false, "u1");
    await ctx.db.updateTable("quartos").set({ situacao: "bloqueado" }).where("id", "=", quartos[0]!).execute();
    await ctx.db.updateTable("quartos").set({ situacao: "em_manutencao" }).where("id", "=", quartos[1]!).execute();
    const l = (await gerar("previsao", "?dias=1")).corpo.secoes[0].linhas[0];
    expect(l).toMatchObject({ disponiveis: 4, livres: 4 });
  });

  test("sem quartos ativos: ocupação '—', livres 0 e sem erro", async () => {
    await reserva("A", {});
    await ctx.db.updateTable("quartos").set({ ativo: 0 }).execute();
    const r = await gerar("previsao", "?dias=2");
    expect(r.status).toBe(200);
    expect(r.corpo.secoes[0].linhas[0]).toMatchObject({ disponiveis: 0, ocupados: 1, livres: 0, ocupacao: "—" });
    expect(resumo(r.corpo)["Ocupação média"]).toBe("—");
  });

  test("grupo com conta única: cada reserva ocupa o seu quarto, sem duplicar", async () => {
    const g = await grupoUnico();
    await reserva("G1", { grupoId: g.id });
    await reserva("G2", { grupoId: g.id });
    const l = (await gerar("previsao", "?dias=1")).corpo.secoes[0].linhas[0];
    expect(l).toMatchObject({ ocupados: 2, chegadas: 2, receita: 60000 });
  });
});

describe("desempenho", () => {
  test("padrão é o mês atual; diária média e RevPAR em centavos inteiros", async () => {
    await reserva("A", { chegada: "2026-11-10", saida: "2026-11-12" }); // 2 noites Standard: 60000
    const r = await gerar("desempenho", "?inicio=2026-11-10&fim=2026-11-11");
    expect(r.corpo.secoes.map((s: any) => s.titulo)).toEqual(["Total", "Standard", "Suíte"]);
    expect(r.corpo.secoes[0].linhas[0]).toEqual({ disponiveis: 10, vendidos: 2, ocupacao: "20,0%", receita: 60000, diariaMedia: 30000, revpar: 6000 });
    expect(linhaDe(r.corpo, "Standard")).toMatchObject({ disponiveis: 8, vendidos: 2, receita: 60000, diariaMedia: 30000, revpar: 7500 });
    expect(linhaDe(r.corpo, "Suíte")).toMatchObject({ disponiveis: 2, vendidos: 0, ocupacao: "0,0%", receita: 0, diariaMedia: "—", revpar: 0 });
    expect(resumo(r.corpo)).toMatchObject({ "Diária média": "R$ 300,00", RevPAR: "R$ 60,00", Ocupação: "20,0%" });
    const mes = await gerar("desempenho");
    expect(mes.corpo.subtitulo).toContain("01/11/2026 a 30/11/2026 (30 dias)");
    expect(mes.corpo.secoes[0].linhas[0].disponiveis).toBe(150);
  });

  test("arredondamento: diária média e RevPAR são inteiros", async () => {
    await reserva("A", { chegada: "2026-11-10", saida: "2026-11-11" });
    await reserva("B", { chegada: "2026-11-10", saida: "2026-11-11", categoriaId: suite }); // 30000 + 50000 = 80000 em 2 noites
    await reserva("C", { chegada: "2026-11-11", saida: "2026-11-12", adultos: 3 }); // 36000: 116000 em 3 noites
    const t = (await gerar("desempenho", "?inicio=2026-11-10&fim=2026-11-12")).corpo.secoes[0].linhas[0];
    expect(t).toMatchObject({ disponiveis: 15, vendidos: 3, receita: 116000, diariaMedia: 38667, revpar: 7733 });
  });

  test("borda do período, cancelada e no-show de fora", async () => {
    await reserva("Cruza o início", { chegada: "2026-10-30", saida: "2026-11-02" }); // só 01/11 conta
    await reserva("Cruza o fim", { chegada: "2026-11-29", saida: "2026-12-03" }); // 29 e 30
    await reserva("Antes", { chegada: "2026-10-30", saida: "2026-11-01" }); // saída exclusiva
    await reserva("Cancelada", { chegada: "2026-11-10", saida: "2026-11-12" }, "cancelada");
    await reserva("No-show", { chegada: "2026-11-10", saida: "2026-11-12" }, "no_show");
    const t = (await gerar("desempenho")).corpo.secoes[0].linhas[0];
    expect(t).toMatchObject({ vendidos: 3, receita: 90000 });
  });

  test("quarto desativado sai da base de quartos de todo o período", async () => {
    await definirQuartoAtivo(ctx, quartos[0]!, false, "u1");
    const t = (await gerar("desempenho", "?inicio=2026-11-10&fim=2026-11-11")).corpo.secoes[0].linhas[0];
    expect(t.disponiveis).toBe(8);
  });

  test("sem quartos: tudo '—', sem erro; início depois do fim: 422", async () => {
    await ctx.db.updateTable("quartos").set({ ativo: 0 }).execute();
    const r = await gerar("desempenho");
    expect(r.status).toBe(200);
    expect(r.corpo.secoes[0].linhas[0]).toMatchObject({ disponiveis: 0, vendidos: 0, ocupacao: "—", receita: 0, diariaMedia: "—", revpar: "—" });
    expect(resumo(r.corpo)).toMatchObject({ Ocupação: "—", "Diária média": "—", RevPAR: "—" });
    expect((await gerar("desempenho", "?inicio=2026-11-05&fim=2026-11-01")).status).toBe(422);
  });

  test("receita total bate com o relatório por canal no mesmo período (com bordas, cancelada e no-show)", async () => {
    await reserva("A", { chegada: "2026-10-30", saida: "2026-11-03", canal: "Booking" });
    await reserva("B", { chegada: "2026-11-10", saida: "2026-11-14", canal: "Site", categoriaId: suite });
    await reserva("C", { chegada: "2026-11-29", saida: "2026-12-04", canal: "Site" });
    await reserva("D", { chegada: "2026-11-10", saida: "2026-11-12", canal: "Site" }, "cancelada");
    await reserva("E", { chegada: "2026-11-10", saida: "2026-11-12", canal: "Booking" }, "no_show");
    const f = await reserva("F", { chegada: "2026-11-05", saida: "2026-11-07" }, "finalizada");
    await ctx.db.updateTable("reservas").set({ canal: "" }).where("id", "=", f.id).execute();
    for (const q of ["", "?inicio=2026-11-02&fim=2026-11-30", "?inicio=2026-11-11&fim=2026-11-11"]) {
      const canais = (await gerar("canais", q)).corpo.secoes[1].totais;
      const d = (await gerar("desempenho", q)).corpo;
      expect(d.secoes[0].linhas[0].receita, q).toBe(canais.receita);
      expect(d.secoes[0].linhas[0].vendidos, q).toBe(canais.noites);
      const soma = d.secoes.slice(1).reduce((t: number, s: any) => t + s.linhas[0].receita, 0);
      expect(soma, q).toBe(canais.receita);
    }
    expect((await gerar("canais")).corpo.secoes[1].totais.receita).toBeGreaterThan(0);
  });
});

describe("resumo do dia", () => {
  test("contagens do dia e limites das datas", async () => {
    await reserva("Chega", { chegada: "2026-11-10", saida: "2026-11-12" }, "confirmada");
    await reserva("Chega hospedada", { chegada: "2026-11-10", saida: "2026-11-11" }, "hospedada", quartos[0]);
    await reserva("Sai", { chegada: "2026-11-08", saida: "2026-11-10" }, "hospedada", quartos[1]);
    await reserva("Saiu", { chegada: "2026-11-08", saida: "2026-11-10" }, "finalizada", quartos[2]);
    await reserva("Fica", { chegada: "2026-11-09", saida: "2026-11-13" }, "hospedada", quartos[3]);
    await reserva("Ontem", { chegada: "2026-11-09", saida: "2026-11-10" }, "cancelada");
    await reserva("Cancelada hoje", { chegada: "2026-11-10", saida: "2026-11-12" }, "cancelada");
    await reserva("No-show hoje", { chegada: "2026-11-10", saida: "2026-11-12" }, "no_show");
    await reserva("No-show amanhã", { chegada: "2026-11-11", saida: "2026-11-12" }, "no_show");
    const velha = await reserva("Criada ontem", { chegada: "2026-11-20", saida: "2026-11-21" });
    await ctx.db.updateTable("reservas").set({ criada_em: "2026-11-10T06:00:00.000Z" }).where("id", "=", velha.id).execute(); // 03:00 local: ainda dia 09
    const r = await gerar("resumo-dia");
    expect(r.corpo.subtitulo).toContain("Dia 10/11/2026");
    expect(resumo(r.corpo)).toMatchObject({
      Chegadas: "2", Saídas: "2", Hospedados: "2", Ocupação: "40,0%", "No-shows": "1", "Cancelamentos (chegada no dia)": "1", "Novas reservas": "9",
    });
    const outro = await gerar("resumo-dia", "?data=2026-11-11");
    expect(resumo(outro.corpo)).toMatchObject({ Chegadas: "0", Saídas: "1", Hospedados: "1", "No-shows": "1", "Novas reservas": "0" });
  });

  test("sem quartos ativos: ocupação '—'", async () => {
    await ctx.db.updateTable("quartos").set({ ativo: 0 }).execute();
    expect(resumo((await gerar("resumo-dia")).corpo).Ocupação).toBe("—");
  });

  test("receita por tipo e recebimentos por forma, líquidos de estorno, em conta de grupo", async () => {
    const grupo = await grupoUnico();
    const a = await reserva("G1", { grupoId: grupo.id }, "hospedada", quartos[0]);
    const b = await reserva("G2", { grupoId: grupo.id }, "hospedada", quartos[1]);
    expect(a.contaId).toBe(b.contaId);
    const conta = a.contaId;
    const diaria = (reservaId: string, dataRef: string, valor: number) =>
      lancar(ctx, { contaId: conta, reservaId, tipo: "diaria", origem: "hospedagem", descricao: `Diária ${dataRef}`, quantidade: 1, valorUnitario: valor, dataRef, setor: "hospedagem" }, "u1");
    await diaria(a.id, "2026-11-10", 30000);
    await diaria(b.id, "2026-11-10", 30000);
    await diaria(a.id, "2026-11-09", 30000); // outro dia
    await diaria(a.id, "2026-11-11", 30000); // outro dia
    await lancar(ctx, { contaId: conta, reservaId: a.id, tipo: "extra", origem: "hospedagem", produtoId: "prod-early-checkin", descricao: "Early check-in", quantidade: 1, valorUnitario: 2500, setor: "hospedagem" }, "u1");
    const lav = await lancar(ctx, { contaId: conta, reservaId: a.id, tipo: "extra", origem: "hospedagem", descricao: "Lavanderia", quantidade: 1, valorUnitario: 4000, setor: "recepcao" }, "u1");
    await lancar(ctx, { contaId: conta, reservaId: b.id, tipo: "extra", origem: "hospedagem", descricao: "Água", quantidade: 1, valorUnitario: 1500, setor: "recepcao" }, "u1");
    await ctx.db.insertInto("lancamentos").values({
      id: "est1", conta_id: conta, reserva_id: a.id, tipo: "estorno", origem: "hospedagem", produto_id: null, descricao: "Estorno: Lavanderia",
      quantidade: 1, valor: -4000, data_ref: null, estorna_id: lav, instante: ctx.relogio.agora().toISOString(), usuario: "u1", setor: "recepcao",
    }).execute();

    const turno = (await abrirCaixa(ctx, recepcao.id, 0)).id;
    const pix = await registrarPagamento(ctx, { contaId: conta, reservaId: a.id, formaCodigo: "pix", valor: 10000 }, recepcao);
    const din = await registrarPagamento(ctx, { contaId: conta, reservaId: b.id, formaCodigo: "dinheiro", valor: 5000 }, recepcao);
    const pagar = (id: string, forma: string, valor: number, instante: string, estorna: string | null = null, t: string | null = turno) =>
      ctx.db.insertInto("pagamentos").values({ id, conta_id: conta, reserva_id: a.id, forma_codigo: forma, valor, estorna_id: estorna, turno_id: t, instante, usuario: "u1" }).execute();
    await pagar("e1", "dinheiro", -5000, ctx.relogio.agora().toISOString(), din); // estorno do dinheiro
    await pagar("p-ontem", "pix", 7000, "2026-11-10T06:00:00.000Z"); // 03:00 local: dia hoteleiro 09
    await pagar("p-madrugada", "credito", 3000, "2026-11-11T05:00:00.000Z"); // 02:00 local de 11/11: ainda dia 10
    await pagar("p-faturado", "faturado", 9000, ctx.relogio.agora().toISOString(), null, null);
    expect(pix).toBeTruthy();

    const r = await gerar("resumo-dia");
    const [receita, receb] = r.corpo.secoes;
    expect(receita.linhas).toEqual([
      { tipo: "Hospedagem (diárias do dia)", valor: 60000 },
      { tipo: "Taxas (early check-in, late check-out)", valor: 2500 },
      { tipo: "Extras", valor: 1500 },
    ]);
    expect(receita.totais).toEqual({ valor: 64000 });
    expect(receb.linhas).toEqual([
      { forma: "Cartão de crédito", valor: 3000 },
      { forma: "Dinheiro", valor: 0 },
      { forma: "Pix", valor: 10000 },
    ]);
    expect(receb.totais).toEqual({ valor: 13000 });
    expect(resumo(r.corpo)).toMatchObject({ "Receita do dia": "R$ 640,00", "Recebido no dia": "R$ 130,00" });
  });
});
