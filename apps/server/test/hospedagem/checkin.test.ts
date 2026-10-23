import { beforeEach, describe, expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { fazerCheckin, sugerirQuartos } from "../../src/hospedagem/checkin.js";
import { extrato } from "../../src/hospedagem/conta.js";
import { criarReserva, obterReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { salvarConfig } from "../../src/nucleo/pousada.js";
import { criarQuarto, mudarSituacaoQuarto, obterQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let std: string;
let lux: string;
let q101: string;
let q102: string;
let q201: string;
let recepcao: UsuarioSessao;
let dados: NovaReserva;

const completo = (id: string, nome: string, nascimento = "1990-01-01") => ({
  id, nome, documentoTipo: "passaporte" as const, documento: `doc-${id}`, nascimento, nacionalidade: "BR",
  telefone: "11999990000", endereco: { logradouro: "Rua A", cidade: "Recife", uf: "PE", pais: "BR" },
});

beforeEach(async () => {
  ctx = await criarContextoTeste(); // 2026-11-10 12:00 local, antes do check-in das 14:00
  std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  lux = (await criarCategoria(ctx, { nome: "Luxo", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  await salvarTabelaBase(ctx, { categoriaId: lux, porAdultos: { 1: 40000, 2: 50000, 3: 60000 }, adultoExtra: 9000 }, "u1");
  q101 = (await criarQuarto(ctx, { numero: "101", categoriaId: std }, "u1")).id;
  q102 = (await criarQuarto(ctx, { numero: "102", categoriaId: std }, "u1")).id;
  q201 = (await criarQuarto(ctx, { numero: "201", categoriaId: lux }, "u1")).id;
  await salvarConfig(ctx, { sinal: { exigir: false, tipo: "percentual", percentual: 30, prazoHoras: 24, toleranciaHoras: 2 } }, "u1");
  await salvarHospede(ctx, completo("h1", "Titular"), "u1");
  await entrarComo(ctx, "recepcao");
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "teste-recepcao").executeTakeFirstOrThrow();
  recepcao = (await carregarUsuarioSessao(ctx, l.id))!;
  dados = { titularId: "h1", categoriaId: std, chegada: "2026-11-10", saida: "2026-11-12", adultos: 1, criancasNascimento: [], canal: "Balcão" };
});

const pedido = (reservaId: string, quartoId: string, extra: object = {}) => ({ reservaId, quartoId, acompanhantes: [], ...extra });

describe("check-in", () => {
  test("sugere apenas quartos limpos da categoria", async () => {
    await mudarSituacaoQuarto(ctx, q102, "em_manutencao", "u1");
    await mudarSituacaoQuarto(ctx, q102, "sujo", "u1");
    const r = await criarReserva(ctx, dados, recepcao);
    expect((await sugerirQuartos(ctx, r.id)).map((q) => q.numero)).toEqual(["101"]);
    await mudarSituacaoQuarto(ctx, q102, "livre", "u1");
    const r2 = await criarReserva(ctx, { ...dados, quartoId: q102 }, recepcao);
    expect((await sugerirQuartos(ctx, r2.id)).map((q) => q.numero)).toEqual(["102", "101"]); // atribuído primeiro
  });

  test("FNRH incompleta bloqueia e diz o que falta", async () => {
    await salvarHospede(ctx, { id: "h2", nome: "Acomp", documentoTipo: "passaporte", documento: null, nascimento: null, nacionalidade: "BR" }, "u1");
    await salvarHospede(ctx, { id: "h3", nome: "Bebe", documentoTipo: "passaporte", documento: null, nascimento: "2026-01-01", nacionalidade: "BR" }, "u1");
    const r = await criarReserva(ctx, dados, recepcao);
    const erro = await fazerCheckin(ctx, pedido(r.id, q101, { acompanhantes: ["h2", "h3"] }), recepcao).catch((e) => e);
    expect(erro).toMatchObject({ codigo: "FNRH_INCOMPLETA" });
    // h2 (adulto, sem nascimento) lista tudo o que falta; h3 (criança) está completa e fica de fora.
    expect(erro.detalhes).toEqual({ h2: ["documento", "nascimento", "endereco.cidade", "contato"] });
    expect((await obterReserva(ctx, r.id)).estado).toBe("confirmada");
    await fazerCheckin(ctx, pedido(r.id, q101, { acompanhantes: ["h3"] }), recepcao); // criança só precisa de nome e nascimento
    expect((await obterReserva(ctx, r.id)).estado).toBe("hospedada");
  });

  test("FNRH incompleta do titular também bloqueia", async () => {
    await salvarHospede(ctx, { id: "h9", nome: "Sem dados", documentoTipo: "passaporte", documento: null, nascimento: "1980-01-01", nacionalidade: "BR" }, "u1");
    const r = await criarReserva(ctx, { ...dados, titularId: "h9" }, recepcao);
    await expect(fazerCheckin(ctx, pedido(r.id, q101), recepcao)).rejects.toMatchObject({
      codigo: "FNRH_INCOMPLETA",
      detalhes: { h9: ["documento", "endereco.cidade", "contato"] },
    });
  });

  test("check-in fora da data é rejeitado", async () => {
    const antes = await criarReserva(ctx, { ...dados, chegada: "2026-11-11", saida: "2026-11-12" }, recepcao);
    await expect(fazerCheckin(ctx, pedido(antes.id, q101), recepcao)).rejects.toMatchObject({ codigo: "CHECKIN_FORA_DA_DATA" });
    const depois = await criarReserva(ctx, { ...dados, chegada: "2026-11-09", saida: "2026-11-11" }, recepcao);
    await expect(fazerCheckin(ctx, pedido(depois.id, q101), recepcao)).rejects.toMatchObject({ codigo: "CHECKIN_FORA_DA_DATA" });
  });

  test("só reserva confirmada faz check-in", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await ctx.db.updateTable("reservas").set({ estado: "pre_reserva" }).where("id", "=", r.id).execute();
    await expect(fazerCheckin(ctx, pedido(r.id, q101), recepcao)).rejects.toMatchObject({ codigo: "RESERVA_NAO_CONFIRMADA" });
  });

  test("quarto em manutenção, sujo ou reservado para outra pessoa é indisponível", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await mudarSituacaoQuarto(ctx, q102, "em_manutencao", "u1");
    await expect(fazerCheckin(ctx, pedido(r.id, q102), recepcao)).rejects.toMatchObject({ codigo: "QUARTO_INDISPONIVEL" });
    await mudarSituacaoQuarto(ctx, q102, "livre", "u1");
    await criarReserva(ctx, { ...dados, quartoId: q101 }, recepcao);
    await expect(fazerCheckin(ctx, pedido(r.id, q101), recepcao)).rejects.toMatchObject({ codigo: "QUARTO_INDISPONIVEL" });
    await ctx.db.updateTable("quartos").set({ situacao: "sujo" }).where("id", "=", q102).execute();
    await expect(fazerCheckin(ctx, pedido(r.id, q102), recepcao)).rejects.toMatchObject({ codigo: "QUARTO_INDISPONIVEL" });
  });

  test("check-in antes do horário lança early check-in; com cobrarEarlyCheckin=false não lança", async () => {
    await salvarConfig(ctx, { earlyCheckin: { tipo: "fixo", valor: 5000 } }, "u1");
    const r = await criarReserva(ctx, dados, recepcao);
    await fazerCheckin(ctx, pedido(r.id, q101), recepcao);
    const ex = await extrato(ctx, r.contaId);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ tipo: "extra", descricao: "Early check-in", valor: 5000, reservaId: r.id });

    const r2 = await criarReserva(ctx, dados, recepcao);
    await fazerCheckin(ctx, pedido(r2.id, q102, { cobrarEarlyCheckin: false }), recepcao);
    expect(await extrato(ctx, r2.contaId)).toHaveLength(0);
  });

  test("early check-in percentual usa a 1ª diária congelada; depois do horário não cobra", async () => {
    await salvarConfig(ctx, { earlyCheckin: { tipo: "percentual_diaria", valor: 50 } }, "u1");
    const r = await criarReserva(ctx, dados, recepcao);
    await fazerCheckin(ctx, pedido(r.id, q101), recepcao);
    expect((await extrato(ctx, r.contaId)).map((l) => l.valor)).toEqual([12500]);

    ctx.relogio.definir("2026-11-10T18:00:00Z"); // 15:00 local
    const r2 = await criarReserva(ctx, dados, recepcao);
    await fazerCheckin(ctx, pedido(r2.id, q102), recepcao);
    expect(await extrato(ctx, r2.contaId)).toHaveLength(0);
  });

  test("taxa de early check-in zero não lança nada", async () => {
    const r = await criarReserva(ctx, dados, recepcao); // padrão: fixo 0
    await fazerCheckin(ctx, pedido(r.id, q101), recepcao);
    expect(await extrato(ctx, r.contaId)).toHaveLength(0);
  });

  test("check-in concluído: hospedada, quarto ocupado, evento CheckinConcluido no outbox", async () => {
    await salvarHospede(ctx, completo("h2", "Acompanhante"), "u1");
    const r = await criarReserva(ctx, dados, recepcao);
    await fazerCheckin(ctx, pedido(r.id, q101, { acompanhantes: ["h2"] }), recepcao);
    const d = await obterReserva(ctx, r.id);
    expect(d.estado).toBe("hospedada");
    expect(d.quartoId).toBe(q101);
    expect((await obterQuarto(ctx, q101)).situacao).toBe("ocupado");
    const ac = await ctx.db.selectFrom("acompanhantes").select("hospede_id").where("reserva_id", "=", r.id).execute();
    expect(ac).toEqual([{ hospede_id: "h2" }]);
    const ev = await ctx.db.selectFrom("outbox").select("payload").where("tipo", "=", "hospedagem.CheckinConcluido").execute();
    expect(ev.map((e) => JSON.parse(e.payload))).toEqual([{ reservaId: r.id, quartoId: q101, hospedeIds: ["h1", "h2"] }]);
    const aud = await ctx.db.selectFrom("auditoria").select("acao").where("alvo_id", "=", r.id).execute();
    expect(aud.map((a) => a.acao)).toContain("reserva.checkin");
    await expect(fazerCheckin(ctx, pedido(r.id, q102), recepcao)).rejects.toMatchObject({ codigo: "RESERVA_NAO_CONFIRMADA" });
  });

  test("upgrade mantém o preço congelado e é auditado", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await fazerCheckin(ctx, pedido(r.id, q201), recepcao);
    const d = await obterReserva(ctx, r.id);
    expect(d.categoriaId).toBe(lux);
    expect(d.noites.map((n) => n.valor)).toEqual([25000, 25000]);
    const aud = await ctx.db.selectFrom("auditoria").select("acao").where("alvo_id", "=", r.id).execute();
    expect(aud.map((a) => a.acao)).toContain("reserva.upgrade");
  });

  test("upgrade com recalcularPreco recota as noites na nova categoria", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await fazerCheckin(ctx, pedido(r.id, q201, { recalcularPreco: true }), recepcao);
    const d = await obterReserva(ctx, r.id);
    expect(d.estado).toBe("hospedada");
    expect(d.categoriaId).toBe(lux);
    expect(d.noites.map((n) => n.valor)).toEqual([40000, 40000]);
  });

  test("falha no meio não deixa efeitos parciais", async () => {
    await salvarConfig(ctx, { earlyCheckin: { tipo: "fixo", valor: 5000 } }, "u1");
    const r = await criarReserva(ctx, dados, recepcao);
    await ctx.db.updateTable("contas").set({ situacao: "fechada" }).where("id", "=", r.contaId).execute();
    await expect(fazerCheckin(ctx, pedido(r.id, q201), recepcao)).rejects.toMatchObject({ codigo: "CONTA_FECHADA" });
    expect(await obterReserva(ctx, r.id)).toMatchObject({ estado: "confirmada", categoriaId: std, quartoId: null });
    expect((await obterQuarto(ctx, q201)).situacao).toBe("livre");
  });
});

describe("rotas", () => {
  test("sugeridos e check-in exigem hospedagem.checkin", async () => {
    const app = criarApp(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    const gov = await entrarComo(ctx, "governanca");
    const r = await criarReserva(ctx, dados, recepcao);
    const sug = await app.inject({ method: "GET", url: `/api/reservas/${r.id}/quartos-sugeridos`, headers: rec });
    expect(sug.statusCode).toBe(200);
    expect(sug.json().map((q: { numero: string }) => q.numero)).toEqual(["101", "102"]);
    expect((await app.inject({ method: "GET", url: `/api/reservas/${r.id}/quartos-sugeridos`, headers: gov })).statusCode).toBe(403);
    const url = `/api/reservas/${r.id}/checkin`;
    expect((await app.inject({ method: "POST", url, headers: gov, payload: { quartoId: q101 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: rec, payload: {} })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url, headers: rec, payload: { quartoId: q101, acompanhantes: [] } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ estado: "hospedada", quartoId: q101 });
  });
});
