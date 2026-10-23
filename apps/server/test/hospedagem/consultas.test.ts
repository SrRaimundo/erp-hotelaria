import { beforeEach, describe, expect, test } from "vitest";
import { buscaUniversal, historicoEstadias, mapaOcupacao, painelDoDia } from "../../src/hospedagem/consultas.js";
import { registrarPagamento } from "../../src/hospedagem/conta.js";
import { colocarEmManutencao } from "../../src/hospedagem/governanca.js";
import { abrirCaixa } from "../../src/nucleo/caixa.js";
import { criarReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { criarApp } from "../../src/http/app.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { salvarConfig } from "../../src/nucleo/pousada.js";
import { criarQuarto, mudarSituacaoQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let std: string;
let lux: string;
let q12: string;
let q13: string;
let recepcao: UsuarioSessao;
let dados: NovaReserva;

async function reserva(extra: Partial<NovaReserva>, estado?: string) {
  const r = await criarReserva(ctx, { ...dados, ...extra }, recepcao);
  if (estado) await ctx.db.updateTable("reservas").set({ estado: estado as any }).where("id", "=", r.id).execute();
  return r;
}

beforeEach(async () => {
  ctx = await criarContextoTeste(); // dia hoteleiro: 2026-11-10
  std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  lux = (await criarCategoria(ctx, { nome: "Luxo", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  for (const c of [std, lux]) await salvarTabelaBase(ctx, { categoriaId: c, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  q12 = (await criarQuarto(ctx, { numero: "12", categoriaId: std }, "u1")).id;
  q13 = (await criarQuarto(ctx, { numero: "13", categoriaId: lux }, "u1")).id;
  // quartos extras só para dar folga de disponibilidade (reservas simultâneas)
  for (const n of ["21", "22", "23", "24", "25"]) await criarQuarto(ctx, { numero: n, categoriaId: std }, "u1");
  for (const n of ["31", "32"]) await criarQuarto(ctx, { numero: n, categoriaId: lux }, "u1");
  await salvarConfig(ctx, { sinal: { exigir: false, tipo: "percentual", percentual: 30, prazoHoras: 24, toleranciaHoras: 2 } }, "u1");
  await salvarHospede(ctx, { id: "h1", nome: "Maria Silva", documentoTipo: "cpf", documento: "529.982.247-25", nascimento: "1990-01-01", nacionalidade: "BR" }, "u1");
  await salvarHospede(ctx, { id: "h2", nome: "John Smith", documentoTipo: "passaporte", documento: "AB123456", nascimento: "1985-01-01", nacionalidade: "US" }, "u1");
  await entrarComo(ctx, "recepcao");
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "teste-recepcao").executeTakeFirstOrThrow();
  recepcao = (await carregarUsuarioSessao(ctx, l.id))!;
  dados = { titularId: "h1", categoriaId: std, chegada: "2026-11-20", saida: "2026-11-23", adultos: 1, criancasNascimento: [], canal: "Balcão" };
});

describe("mapa de ocupação", () => {
  test("mapa inclui reservas que tocam o período e reservas sem quarto", async () => {
    const dentro = await reserva({ quartoId: q12 }, "confirmada");
    const semQuarto = await reserva({ chegada: "2026-11-21", saida: "2026-11-22" });
    const anterior = await reserva({ quartoId: q12, chegada: "2026-11-15", saida: "2026-11-20" }); // sai no início: não toca
    const cancelada = await reserva({ quartoId: q12, chegada: "2026-11-24", saida: "2026-11-25" }, "cancelada");
    const depois = await reserva({ quartoId: q12, chegada: "2026-11-26", saida: "2026-11-27" });
    const naBorda = await reserva({ quartoId: q12, chegada: "2026-11-25", saida: "2026-11-26" }); // chegada == fim: toca
    const m = await mapaOcupacao(ctx, { inicio: "2026-11-20", fim: "2026-11-25" });
    expect(m.quartos.filter((q) => ["12", "13"].includes(q.numero)).map((q) => [q.numero, q.categoria, q.situacao])).toEqual([["12", "Standard", "livre"], ["13", "Luxo", "livre"]]);
    expect(m.quartos).toHaveLength(9);
    const ids = m.barras.map((b) => b.reservaId);
    expect(ids).toEqual(expect.arrayContaining([dentro.id, semQuarto.id, naBorda.id]));
    expect(ids).not.toContain(anterior.id);
    expect(ids).not.toContain(cancelada.id);
    expect(ids).not.toContain(depois.id);
    const b = m.barras.find((x) => x.reservaId === dentro.id)!;
    expect(b).toMatchObject({ codigo: dentro.codigo, quartoId: q12, categoriaId: std, chegada: "2026-11-20", saida: "2026-11-23", estado: "confirmada", titular: "Maria Silva" });
    expect(m.barras.find((x) => x.reservaId === semQuarto.id)!.quartoId).toBeNull();
  });

  test("filtra por categoria", async () => {
    await reserva({ quartoId: q12 });
    const l = await reserva({ categoriaId: lux, quartoId: q13 });
    const m = await mapaOcupacao(ctx, { inicio: "2026-11-20", fim: "2026-11-25", categoriaId: lux });
    expect(m.quartos.map((q) => q.numero)).toEqual(["13", "31", "32"]);
    expect(m.barras.map((b) => b.reservaId)).toEqual([l.id]);
  });
});

describe("painel do dia", () => {
  test("painel do dia lista chegadas, saídas, sujos, sinais vencendo e chegadas vencidas", async () => {
    const chega = await reserva({ chegada: "2026-11-10", saida: "2026-11-12" }, "confirmada");
    const chegaPre = await reserva({ chegada: "2026-11-10", saida: "2026-11-11", quartoId: q13, categoriaId: lux }, "pre_reserva");
    const sai = await reserva({ chegada: "2026-11-08", saida: "2026-11-10", quartoId: q12 }, "hospedada");
    const q31 = (await ctx.db.selectFrom("quartos").select("id").where("numero", "=", "31").executeTakeFirstOrThrow()).id;
    const fica = await reserva({ chegada: "2026-11-08", saida: "2026-11-14", quartoId: q31, categoriaId: lux }, "hospedada");
    const vencida = await reserva({ chegada: "2026-11-09", saida: "2026-11-11" }, "confirmada");
    const cancelada = await reserva({ chegada: "2026-11-10", saida: "2026-11-11" }, "cancelada");
    await ctx.db.updateTable("reservas").set({ prazo_sinal: "2026-11-11T10:00:00.000Z" }).where("id", "=", chegaPre.id).execute(); // < 24h
    await ctx.db.updateTable("reservas").set({ prazo_sinal: "2026-11-13T10:00:00.000Z" }).where("id", "=", cancelada.id).execute();
    await mudarSituacaoQuarto(ctx, q12, "ocupado", "u1");
    await mudarSituacaoQuarto(ctx, q12, "sujo", "u1");
    await ctx.db.insertInto("alertas").values({ id: "al1", tipo: "x", alvo_tipo: "reserva", alvo_id: "r", mensagem: "m", criado_em: "2026-11-10T10:00:00Z", resolvido_em: null, resolvido_por: null }).execute();

    const p = await painelDoDia(ctx);
    expect(p.dia).toBe("2026-11-10");
    expect(p.chegadas.map((x) => x.reservaId).sort()).toEqual([chega.id, chegaPre.id].sort());
    expect(p.chegadas.find((x) => x.reservaId === chegaPre.id)).toMatchObject({ codigo: chegaPre.codigo, titular: "Maria Silva", quartoNumero: "13", chegada: "2026-11-10", saida: "2026-11-11" });
    expect(p.chegadas.find((x) => x.reservaId === chega.id)!.quartoNumero).toBeNull();
    expect(p.saidas.map((x) => x.reservaId)).toEqual([sai.id]);
    expect(p.hospedados).toBe(2);
    expect(p.quartosSujos).toEqual([{ quartoId: q12, numero: "12" }]);
    expect(p.sinaisVencendo.map((x) => x.reservaId)).toEqual([chegaPre.id]);
    expect(p.chegadasVencidas.map((x) => x.reservaId)).toEqual([vencida.id]);
    expect(p.alertas.map((a) => a.id)).toEqual(["al1"]);
    expect(p.saidas.map((x) => x.reservaId)).not.toContain(fica.id);
  });

  test("antes da virada o dia hoteleiro é o anterior", async () => {
    ctx.relogio.definir("2026-11-10T05:00:00Z"); // 02:00 em São Paulo
    expect((await painelDoDia(ctx)).dia).toBe("2026-11-09");
  });
});

describe("painel do dia ampliado", () => {
  const dia = "2026-11-10";

  test("ocupação e números do dia", async () => {
    await criarQuarto(ctx, { numero: "33", categoriaId: lux }, "u1"); // 10 quartos
    await colocarEmManutencao(ctx, (await ctx.db.selectFrom("quartos").select("id").where("numero", "=", "33").executeTakeFirstOrThrow()).id, "Ar-condicionado", recepcao);
    const kid = ["2020-01-01"];
    await reserva({ chegada: "2026-11-09", saida: "2026-11-12", adultos: 2, criancasNascimento: kid }, "hospedada");
    await reserva({ chegada: "2026-11-09", saida: "2026-11-12", adultos: 2, criancasNascimento: kid }, "hospedada");
    await reserva({ chegada: "2026-11-09", saida: "2026-11-12", adultos: 2 }, "hospedada");
    await reserva({ categoriaId: lux, chegada: "2026-11-10", saida: "2026-11-12", adultos: 1 }, "hospedada");
    await reserva({ chegada: "2026-11-10", saida: "2026-11-11" }, "confirmada");
    await reserva({ categoriaId: lux, chegada: "2026-11-08", saida: "2026-11-11" }, "pre_reserva");
    await reserva({ chegada: "2026-11-10", saida: "2026-11-11" }, "cancelada");
    const p = await painelDoDia(ctx);
    expect(p.ocupacao).toEqual({ ocupados: 6, total: 9, percentual: 67 });
    expect(p.numeros).toEqual({
      chegadas: 2, chegadasJaHospedadas: 1, saidas: 0, hospedados: 4, pessoasHospedadas: 9,
      quartosSujos: 0, quartosManutencao: 1, livresHoje: 3,
    });
    expect(p.chegadas).toHaveLength(2); // confirmada + já hospedada
    expect(p.chegadas.map((c) => c.estado).sort()).toEqual(["confirmada", "hospedada"]);
  });

  test("chegada mostra sinal pendente e pendência de FNRH", async () => {
    await salvarHospede(ctx, { id: "h3", nome: "Ana Sem Documento", documentoTipo: "cpf", documento: null, nascimento: "1992-02-02", nacionalidade: "BR" }, "u1");
    const pre = await reserva({ titularId: "h3", chegada: dia, saida: "2026-11-12", adultos: 2, criancasNascimento: ["2020-01-01"] }, "pre_reserva");
    await ctx.db.updateTable("reservas").set({ valor_sinal: 27000 }).where("id", "=", pre.id).execute();
    await abrirCaixa(ctx, recepcao.id, 0);
    await registrarPagamento(ctx, { contaId: pre.contaId, reservaId: pre.id, formaCodigo: "pix", valor: 10000 }, recepcao);
    await salvarHospede(ctx, { id: "h4", nome: "Completa", documentoTipo: "cpf", documento: "111.444.777-35", nascimento: "1980-05-05", nacionalidade: "BR", telefone: "(48) 90000-0000", endereco: { logradouro: "Rua A", cidade: "Floripa", uf: "SC", pais: "BR" } }, "u1");
    const ok = await reserva({ titularId: "h4", chegada: dia, saida: "2026-11-11" }, "confirmada");
    const p = await painelDoDia(ctx);
    const c = p.chegadas.find((x) => x.reservaId === pre.id)!;
    expect(c).toMatchObject({ estado: "pre_reserva", noites: 2, adultos: 2, criancas: 1, canal: "Balcão", sinalPendente: 17000, pendenciasFnrh: true, titular: "Ana Sem Documento" });
    const o = p.chegadas.find((x) => x.reservaId === ok.id)!;
    expect(o).toMatchObject({ sinalPendente: 0, pendenciasFnrh: false });
  });

  test("titular menor de 18 na chegada não exige documento no FNRH", async () => {
    await salvarHospede(ctx, { id: "h5", nome: "Menor Titular", documentoTipo: "cpf", documento: null, nascimento: "2015-03-03", nacionalidade: "BR" }, "u1");
    await salvarHospede(ctx, { id: "h6", nome: "Adulto Igual", documentoTipo: "cpf", documento: null, nascimento: "1990-03-03", nacionalidade: "BR" }, "u1");
    const menor = await reserva({ titularId: "h5", chegada: dia, saida: "2026-11-11" }, "confirmada");
    const adulto = await reserva({ titularId: "h6", chegada: dia, saida: "2026-11-11" }, "confirmada");
    const p = await painelDoDia(ctx);
    expect(p.chegadas.find((x) => x.reservaId === menor.id)!.pendenciasFnrh).toBe(false);
    expect(p.chegadas.find((x) => x.reservaId === adulto.id)!.pendenciasFnrh).toBe(true);
  });

  test("saída mostra saldo da conta", async () => {
    const r = await reserva({ chegada: "2026-11-08", saida: dia, quartoId: q12 }, "hospedada");
    await ctx.db.insertInto("lancamentos").values({
      id: "l1", conta_id: r.contaId, reserva_id: r.id, tipo: "extra", origem: "hospedagem", produto_id: null,
      descricao: "Jantar", quantidade: 1, valor: 15000, data_ref: null, estorna_id: null, instante: "2026-11-09T10:00:00Z", usuario: "u1",
    }).execute();
    const p = await painelDoDia(ctx);
    expect(p.saidas).toHaveLength(1);
    expect(p.saidas[0]).toMatchObject({ reservaId: r.id, contaId: r.contaId, saldo: 15000, quartoNumero: "12" });
    expect(p.numeros.saidas).toBe(1);
  });

  test("fila de atenção: sinal antes de chegada atrasada antes de alerta, com ações", async () => {
    await salvarHospede(ctx, { id: "h1", nome: "Maria Silva", documentoTipo: "cpf", documento: "529.982.247-25", nascimento: "1990-01-01", nacionalidade: "BR", telefone: "(48) 99812-3344" }, "u1");
    const pre = await reserva({ chegada: "2026-11-12", saida: "2026-11-14" }, "pre_reserva");
    await ctx.db.updateTable("reservas").set({ valor_sinal: 27000, prazo_sinal: "2026-11-11T10:00:00.000Z" }).where("id", "=", pre.id).execute();
    const atrasada = await reserva({ chegada: "2026-11-09", saida: "2026-11-11" }, "confirmada");
    await ctx.db.insertInto("alertas").values({ id: "al1", tipo: "x", alvo_tipo: "reserva", alvo_id: pre.id, mensagem: "Algo errado", criado_em: "2026-11-10T10:00:00Z", resolvido_em: null, resolvido_por: null }).execute();
    await ctx.db.insertInto("alertas").values({ id: "al2", tipo: "y", alvo_tipo: "conta", alvo_id: atrasada.contaId, mensagem: "Conta com saldo", criado_em: "2026-11-10T11:00:00Z", resolvido_em: null, resolvido_por: null }).execute();
    const p = await painelDoDia(ctx);
    expect(p.atencao.map((a) => a.tipo)).toEqual(["sinal_vencendo", "chegada_atrasada", "alerta", "alerta"]);
    expect(p.atencao[0]).toMatchObject({
      id: `sinal:${pre.id}`, titulo: "Sinal vence amanhã às 07:00", reservaId: pre.id, acoes: ["registrar_sinal", "prorrogar_sinal"],
      detalhe: `Reserva #${pre.codigo} · Maria Silva · 12/11–14/11 · faltam R$ 270,00`,
    });
    expect(p.atencao[1]).toMatchObject({
      id: `atraso:${atrasada.id}`, titulo: "Chegada atrasada", acoes: ["marcar_no_show", "abrir_reserva"], telefone: "(48) 99812-3344",
      detalhe: `Reserva #${atrasada.codigo} · Maria Silva · era para 09/11, qto sem quarto`,
    });
    expect(p.atencao[2]).toMatchObject({ id: "al1", titulo: "Algo errado", detalhe: "", reservaId: pre.id, contaId: null, acoes: ["abrir_reserva", "resolver_alerta"] });
    expect(p.atencao[3]).toMatchObject({ id: "al2", contaId: atrasada.contaId, reservaId: atrasada.id, acoes: ["abrir_conta", "resolver_alerta"] });
  });

  test("sinal que vence hoje diz só a hora", async () => {
    const pre = await reserva({ chegada: "2026-11-12", saida: "2026-11-14" }, "pre_reserva");
    await ctx.db.updateTable("reservas").set({ valor_sinal: 1000, prazo_sinal: "2026-11-10T20:00:00.000Z" }).where("id", "=", pre.id).execute();
    expect((await painelDoDia(ctx)).atencao[0]!.titulo).toBe("Sinal vence às 17:00");
  });

  test("governança traz motivo da manutenção", async () => {
    await colocarEmManutencao(ctx, q13, "Vazamento no banheiro", recepcao);
    await mudarSituacaoQuarto(ctx, q12, "ocupado", "u1");
    await mudarSituacaoQuarto(ctx, q12, "sujo", "u1");
    const p = await painelDoDia(ctx);
    expect(p.governanca).toEqual([
      { quartoId: q12, numero: "12", situacao: "sujo", motivo: null },
      { quartoId: q13, numero: "13", situacao: "em_manutencao", motivo: "Vazamento no banheiro" },
    ]);
  });

  test("próximos dias: exatamente dois", async () => {
    await reserva({ chegada: "2026-11-11", saida: "2026-11-12" }, "confirmada");
    await reserva({ chegada: "2026-11-09", saida: "2026-11-11" }, "hospedada");
    const p = await painelDoDia(ctx);
    expect(p.proximosDias).toEqual([
      { dia: "2026-11-11", chegadas: 1, saidas: 1, ocupacaoPct: 11 },
      { dia: "2026-11-12", chegadas: 0, saidas: 1, ocupacaoPct: 0 },
    ]);
  });

  test("resolver alerta pela API", async () => {
    const app = criarApp(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    const gov = await entrarComo(ctx, "governanca");
    await ctx.db.insertInto("alertas").values({ id: "al1", tipo: "x", alvo_tipo: "reserva", alvo_id: "r", mensagem: "m", criado_em: "2026-11-10T10:00:00Z", resolvido_em: null, resolvido_por: null }).execute();
    expect((await app.inject({ method: "POST", url: "/api/alertas/al1/resolver" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/alertas/al1/resolver", headers: gov })).statusCode).toBe(403);
    const ok = await app.inject({ method: "POST", url: "/api/alertas/al1/resolver", headers: rec });
    expect([ok.statusCode, ok.json()]).toEqual([200, { ok: true }]);
    expect((await painelDoDia(ctx)).alertas).toEqual([]);
    const outra = await app.inject({ method: "POST", url: "/api/alertas/al1/resolver", headers: rec });
    expect([outra.statusCode, outra.json().codigo]).toEqual([422, "ALERTA_NAO_ENCONTRADO"]);
    expect((await app.inject({ method: "POST", url: "/api/alertas/nada/resolver", headers: rec })).json().codigo).toBe("ALERTA_NAO_ENCONTRADO");
  });
});

describe("busca universal", () => {
  test("busca '12' encontra o quarto 12 e a reserva de código 12", async () => {
    let r = await reserva({ quartoId: q12 });
    for (let i = 2; r.codigo < 12; i++) r = await reserva({ chegada: `2026-12-${String(i).padStart(2, "0")}`, saida: `2026-12-${String(i + 1).padStart(2, "0")}` });
    await ctx.db.updateTable("reservas").set({ estado: "pre_reserva" }).where("id", "=", r.id).execute();
    const res = await buscaUniversal(ctx, "12");
    expect(res[0]).toMatchObject({ tipo: "quarto", id: q12, rotulo: "Quarto 12", acoes: ["ver_quarto"] });
    const rr = res.find((x) => x.tipo === "reserva" && x.id === r.id)!;
    expect(rr.rotulo).toBe(`Reserva #12 — Maria Silva (${r.chegada.slice(8)}/${r.chegada.slice(5, 7)}–${r.saida.slice(8)}/${r.saida.slice(5, 7)})`);
    expect(rr.acoes).toEqual(["abrir", "registrar_pagamento"]);
    expect(res.length).toBeLessThanOrEqual(10);
  });

  test("busca por CPF formatado encontra o hóspede", async () => {
    const res = await buscaUniversal(ctx, "529.982.247-25");
    expect(res).toEqual([{ tipo: "hospede", id: "h1", rotulo: "Maria Silva — CPF ***.***.247-25", acoes: ["nova_reserva", "ver_historico"] }]);
  });

  test("busca por nome e passaporte; ações da reserva por estado", async () => {
    const res = await buscaUniversal(ctx, "smith");
    expect(res).toEqual([{ tipo: "hospede", id: "h2", rotulo: "John Smith — AB123456", acoes: ["nova_reserva", "ver_historico"] }]);
    const r = await reserva({ titularId: "h2" }, "hospedada");
    const b = await buscaUniversal(ctx, String(r.codigo));
    expect(b.find((x) => x.id === r.id)!.acoes).toEqual(["abrir", "lancar_extra", "checkout"]);
    await ctx.db.updateTable("reservas").set({ estado: "confirmada" }).where("id", "=", r.id).execute();
    expect((await buscaUniversal(ctx, String(r.codigo))).find((x) => x.id === r.id)!.acoes).toEqual(["abrir", "checkin"]);
    await ctx.db.updateTable("reservas").set({ estado: "finalizada" }).where("id", "=", r.id).execute();
    expect((await buscaUniversal(ctx, String(r.codigo))).find((x) => x.id === r.id)!.acoes).toEqual(["abrir"]);
  });

  test("I9: busca pelo nome traz as reservas em aberto do hóspede antes do cadastro", async () => {
    const confirmada = await reserva({}, "confirmada");
    await reserva({ chegada: "2026-10-01", saida: "2026-10-03" }, "finalizada");
    await reserva({ titularId: "h2" }, "confirmada");
    const res = await buscaUniversal(ctx, "maria");
    expect(res.map((x) => [x.tipo, x.id])).toEqual([["reserva", confirmada.id], ["hospede", "h1"]]);
    expect(res[0]).toEqual({
      tipo: "reserva", id: confirmada.id, acoes: ["abrir", "checkin"],
      rotulo: `Reserva #${confirmada.codigo} — Maria Silva (20/11–23/11)`,
    });
  });

  test("limita a 10 resultados e ignora consulta vazia", async () => {
    for (let i = 0; i < 12; i++) await salvarHospede(ctx, { id: `x${i}`, nome: `Pedro ${i}`, documentoTipo: "passaporte", documento: `P${i}`, nascimento: null, nacionalidade: "BR" }, "u1");
    expect(await buscaUniversal(ctx, "pedro")).toHaveLength(10);
    expect(await buscaUniversal(ctx, "  ")).toEqual([]);
  });
});

describe("histórico e rotas", () => {
  test("histórico traz só reservas finalizadas do hóspede", async () => {
    const f = await reserva({ chegada: "2026-10-01", saida: "2026-10-03" }, "finalizada");
    await reserva({}, "confirmada");
    await reserva({ titularId: "h2", chegada: "2026-10-05", saida: "2026-10-06" }, "finalizada");
    const h = await historicoEstadias(ctx, "h1");
    expect(h.map((x) => x.reservaId)).toEqual([f.id]);
  });

  test("I5: consultas exigem sessão e reservas.gerenciar; governança só vê quartos", async () => {
    const app = criarApp(ctx);
    const r = await reserva({});
    expect((await app.inject({ method: "GET", url: "/api/painel" })).statusCode).toBe(401);
    const gov = await entrarComo(ctx, "governanca");
    const rec = await entrarComo(ctx, "recepcao");
    const restritas = [
      `/api/contas/${r.contaId}`, "/api/hospedes", "/api/hospedes?q=maria", "/api/hospedes/h1/historico",
      "/api/busca?q=maria", "/api/mapa?inicio=2026-11-01&fim=2026-11-30", "/api/painel",
    ];
    for (const url of restritas) {
      const g = await app.inject({ method: "GET", url, headers: gov });
      expect([url, g.statusCode]).toEqual([url, 403]);
      expect([url, (await app.inject({ method: "GET", url, headers: rec })).statusCode]).toEqual([url, 200]);
    }
    for (const url of ["/api/governanca", "/api/quartos", "/api/categorias"]) {
      expect([url, (await app.inject({ method: "GET", url, headers: gov })).statusCode]).toEqual([url, 200]);
    }
    const b = await app.inject({ method: "GET", url: "/api/busca?q=smith", headers: rec });
    expect(b.json()).toHaveLength(1);
  });
});

describe("validação do período do mapa", () => {
  test("I7/I8: mapa recusa data impossível, fim antes do início e período acima de 366 dias", async () => {
    const app = criarApp(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    const mapa = (q: string) => app.inject({ method: "GET", url: `/api/mapa?${q}`, headers: rec });
    expect((await mapa("inicio=2026-02-30&fim=2026-03-10")).statusCode).toBe(400);
    expect((await mapa("inicio=2026-11-10&fim=2026-11-09")).statusCode).toBe(400);
    expect((await mapa("inicio=2026-01-01&fim=2027-01-03")).statusCode).toBe(400);
    expect((await mapa("inicio=2026-01-01&fim=2027-01-02")).statusCode).toBe(200);
    expect((await mapa("inicio=2026-11-10&fim=2026-11-10")).statusCode).toBe(200);
  });
});
