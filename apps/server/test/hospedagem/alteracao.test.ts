import { beforeEach, describe, expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { alterarReserva, cancelarReserva, marcarNoShow, previaAlteracao, prorrogarSinal } from "../../src/hospedagem/alteracao.js";
import { criarReserva, obterReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { criarAlerta } from "../../src/infra/alertas.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { criarQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { salvarRestricao, salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let std: string;
let q12: string;
let q13: string;
let recepcao: UsuarioSessao;
let dados: NovaReserva;
const admin = { login: "admin", senha: "admin" };
const aut = (motivo = "Pedido do hóspede") => ({ motivo, supervisor: admin });

beforeEach(async () => {
  ctx = await criarContextoTeste();
  std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  q12 = (await criarQuarto(ctx, { numero: "12", categoriaId: std }, "u1")).id;
  q13 = (await criarQuarto(ctx, { numero: "13", categoriaId: std }, "u1")).id;
  await ctx.db.insertInto("hospedes").values({
    id: "h1", nome: "Titular", nome_busca: "titular", documento_tipo: "cpf", documento: "1", nacionalidade: "BR",
  }).execute();
  await entrarComo(ctx, "recepcao");
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "teste-recepcao").executeTakeFirstOrThrow();
  recepcao = (await carregarUsuarioSessao(ctx, l.id))!;
  dados = { titularId: "h1", categoriaId: std, chegada: "2026-11-20", saida: "2026-11-23", adultos: 2, criancasNascimento: [], canal: "Balcão" };
});

describe("alteração", () => {
  test("esticar a saída mantém as noites antigas congeladas e cota só as novas", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 1, 2: 40000, 3: 3 }, adultoExtra: 1 }, "u1");
    const previa = await previaAlteracao(ctx, r.id, { saida: "2026-11-25" });
    expect(previa.valorAntigo).toBe(90000);
    expect(previa.valorNovo).toBe(170000);
    expect(previa.noites.map((n) => n.valor)).toEqual([30000, 30000, 30000, 40000, 40000]);
    expect((await obterReserva(ctx, r.id)).noites).toHaveLength(3); // prévia não grava

    const nova = await alterarReserva(ctx, r.id, { saida: "2026-11-25" }, recepcao);
    const d = await obterReserva(ctx, r.id);
    expect(nova.saida).toBe("2026-11-25");
    expect(d.noites.map((n) => n.valor)).toEqual([30000, 30000, 30000, 40000, 40000]);
    expect(d.valorSinal).toBe(51000); // 30% de 170000 (pre_reserva)
    const ev = await ctx.db.selectFrom("outbox").select("tipo").where("tipo", "=", "hospedagem.ReservaAlterada").execute();
    expect(ev).toHaveLength(1);
    const aud = await ctx.db.selectFrom("auditoria").select("acao").where("alvo_id", "=", r.id).execute();
    expect(aud.map((a) => a.acao)).toContain("reserva.alterar");
  });

  test("encurtar a chegada remove as noites que saem e mantém as demais", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await alterarReserva(ctx, r.id, { chegada: "2026-11-21" }, recepcao);
    const d = await obterReserva(ctx, r.id);
    expect(d.noites.map((n) => n.data)).toEqual(["2026-11-21", "2026-11-22"]);
    expect(d.total).toBe(60000);
  });

  test("mudar adultos recota todas as noites", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await alterarReserva(ctx, r.id, { adultos: 3 }, recepcao);
    expect((await obterReserva(ctx, r.id)).noites.map((n) => n.valor)).toEqual([36000, 36000, 36000]);
    await expect(alterarReserva(ctx, r.id, { adultos: 5 }, recepcao)).rejects.toMatchObject({ codigo: "CAPACIDADE_EXCEDIDA" });
  });

  test("trocar de quarto na mesma categoria não altera valores", async () => {
    const r = await criarReserva(ctx, { ...dados, quartoId: q12 }, recepcao);
    await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 1, 2: 99999, 3: 3 }, adultoExtra: 1 }, "u1");
    await alterarReserva(ctx, r.id, { quartoId: q13 }, recepcao);
    const d = await obterReserva(ctx, r.id);
    expect(d.quartoId).toBe(q13);
    expect(d.noites.map((n) => n.valor)).toEqual([30000, 30000, 30000]);
    expect(d.valorSinal).toBe(27000);
  });

  test("preço manual exige supervisor e aparece no detalhamento", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    const m = { precosManuais: [{ data: "2026-11-21", valor: 20000 }] };
    await expect(alterarReserva(ctx, r.id, m, recepcao)).rejects.toMatchObject({ codigo: "SUPERVISOR_NECESSARIO" });
    expect((await obterReserva(ctx, r.id)).total).toBe(90000);
    await alterarReserva(ctx, r.id, m, recepcao, aut("Cortesia"));
    const d = await obterReserva(ctx, r.id);
    expect(d.noites.map((n) => n.valor)).toEqual([30000, 20000, 30000]);
    expect(d.noites[1]!.passos.at(-1)).toEqual({ rotulo: "Ajuste manual", valor: 20000 });
    const aud = await ctx.db.selectFrom("auditoria").selectAll().where("alvo_id", "=", r.id).where("acao", "=", "reserva.alterar").executeTakeFirstOrThrow();
    expect(aud.motivo).toBe("Cortesia");
    expect(aud.supervisor_id).not.toBeNull();
  });

  test("Review Focus 5: arrastar sobre outra reserva é rejeitado e a original fica intacta", async () => {
    const r1 = await criarReserva(ctx, { ...dados, quartoId: q12 }, recepcao);
    const r2 = await criarReserva(ctx, { ...dados, quartoId: q13 }, recepcao);
    const quartoDaR2 = (await obterReserva(ctx, r2.id)).quartoId!;
    await expect(alterarReserva(ctx, r1.id, { quartoId: quartoDaR2 }, recepcao)).rejects.toMatchObject({ codigo: "QUARTO_INDISPONIVEL" });
    expect((await obterReserva(ctx, r1.id)).quartoId).toBe(q12);
  });

  test("restrição no novo período exige supervisor", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await salvarRestricao(ctx, { categoriaId: std, data: "2026-11-24", minNoites: null, fechadoChegada: false, fechadoSaida: true, fechadoVenda: false }, "u1");
    await expect(alterarReserva(ctx, r.id, { saida: "2026-11-24" }, recepcao)).rejects.toMatchObject({ codigo: "RESTRICAO_TARIFARIA" });
    await alterarReserva(ctx, r.id, { saida: "2026-11-24" }, recepcao, aut());
    expect((await obterReserva(ctx, r.id)).saida).toBe("2026-11-24");
  });

  test("estados e datas: hospedada não muda chegada; cancelada não altera; datas inválidas", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await expect(alterarReserva(ctx, r.id, { saida: "2026-11-20" }, recepcao)).rejects.toMatchObject({ codigo: "DATAS_INVALIDAS" });
    await ctx.db.updateTable("reservas").set({ estado: "hospedada" }).where("id", "=", r.id).execute();
    await expect(alterarReserva(ctx, r.id, { chegada: "2026-11-21" }, recepcao)).rejects.toMatchObject({ codigo: "CHEGADA_NAO_ALTERAVEL" });
    await alterarReserva(ctx, r.id, { saida: "2026-11-24" }, recepcao);
    await ctx.db.updateTable("reservas").set({ estado: "cancelada" }).where("id", "=", r.id).execute();
    await expect(alterarReserva(ctx, r.id, { saida: "2026-11-25" }, recepcao)).rejects.toMatchObject({ codigo: "RESERVA_NAO_ALTERAVEL" });
  });
});

describe("cancelamento, no-show e sinal", () => {
  test("cancelar exige supervisor e motivo; resolve alertas e libera o quarto", async () => {
    const r = await criarReserva(ctx, { ...dados, quartoId: q12 }, recepcao);
    await criarAlerta(ctx, { tipo: "sinal_vencendo", alvoTipo: "reserva", alvoId: r.id, mensagem: "x" });
    await expect(cancelarReserva(ctx, r.id, recepcao, undefined)).rejects.toMatchObject({ codigo: "SUPERVISOR_NECESSARIO" });
    await expect(cancelarReserva(ctx, r.id, recepcao, { motivo: " ", supervisor: admin })).rejects.toMatchObject({ codigo: "MOTIVO_OBRIGATORIO" });
    expect((await obterReserva(ctx, r.id)).estado).toBe("pre_reserva");
    await cancelarReserva(ctx, r.id, recepcao, aut("Desistiu"));
    expect((await obterReserva(ctx, r.id)).estado).toBe("cancelada");
    expect(await ctx.db.selectFrom("alertas").select("id").where("alvo_id", "=", r.id).where("resolvido_em", "is", null).execute()).toHaveLength(0);
    const ev = await ctx.db.selectFrom("outbox").selectAll().where("tipo", "=", "hospedagem.ReservaCancelada").execute();
    expect(ev).toHaveLength(1);
    expect(JSON.parse(ev[0]!.payload)).toEqual({ reservaId: r.id, motivo: "Desistiu", automatico: false });
    const aud = await ctx.db.selectFrom("auditoria").selectAll().where("alvo_id", "=", r.id).where("acao", "=", "reserva.cancelar").executeTakeFirstOrThrow();
    expect(aud.motivo).toBe("Desistiu");
    await criarReserva(ctx, { ...dados, quartoId: q12 }, recepcao);
    await expect(cancelarReserva(ctx, r.id, recepcao, aut())).rejects.toMatchObject({ codigo: "TRANSICAO_RESERVA_INVALIDA" });
  });

  test("no-show antes da data de chegada é rejeitado", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await ctx.db.updateTable("reservas").set({ estado: "confirmada" }).where("id", "=", r.id).execute();
    await expect(marcarNoShow(ctx, r.id, recepcao, aut("Não veio"))).rejects.toMatchObject({ codigo: "NO_SHOW_ANTECIPADO" });
    // chegada no próprio dia hoteleiro (2026-11-10) também é antecipado
    await ctx.db.updateTable("reservas").set({ chegada: "2026-11-10", saida: "2026-11-12" }).where("id", "=", r.id).execute();
    await expect(marcarNoShow(ctx, r.id, recepcao, aut())).rejects.toMatchObject({ codigo: "NO_SHOW_ANTECIPADO" });
    await ctx.db.updateTable("reservas").set({ chegada: "2026-11-09" }).where("id", "=", r.id).execute();
    await expect(marcarNoShow(ctx, r.id, recepcao, undefined)).rejects.toMatchObject({ codigo: "SUPERVISOR_NECESSARIO" });
    await marcarNoShow(ctx, r.id, recepcao, aut("Não veio"));
    expect((await obterReserva(ctx, r.id)).estado).toBe("no_show");
    const aud = await ctx.db.selectFrom("auditoria").select("motivo").where("alvo_id", "=", r.id).where("acao", "=", "reserva.no_show").executeTakeFirstOrThrow();
    expect(aud.motivo).toBe("Não veio");
  });

  test("no-show só vale para reserva confirmada", async () => {
    const r = await criarReserva(ctx, { ...dados, chegada: "2026-11-01", saida: "2026-11-02" }, recepcao);
    await expect(marcarNoShow(ctx, r.id, recepcao, aut())).rejects.toMatchObject({ codigo: "TRANSICAO_RESERVA_INVALIDA" });
  });

  test("prorrogar sinal zera o aviso e resolve o alerta", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await ctx.db.updateTable("reservas").set({ aviso_sinal_em: "2026-11-11T00:00:00.000Z" }).where("id", "=", r.id).execute();
    await criarAlerta(ctx, { tipo: "sinal_vencendo", alvoTipo: "reserva", alvoId: r.id, mensagem: "x" });
    await expect(prorrogarSinal(ctx, r.id, "2026-11-09T00:00:00.000Z", recepcao, aut())).rejects.toMatchObject({ codigo: "PRAZO_INVALIDO" });
    await expect(prorrogarSinal(ctx, r.id, "2026-11-15T12:00:00.000Z", recepcao, undefined)).rejects.toMatchObject({ codigo: "SUPERVISOR_NECESSARIO" });
    await prorrogarSinal(ctx, r.id, "2026-11-15T12:00:00.000Z", recepcao, aut("Aguardando PIX"));
    const d = await obterReserva(ctx, r.id);
    expect(d.prazoSinal).toBe("2026-11-15T12:00:00.000Z");
    expect(d.avisoSinalEm).toBeNull();
    expect(await ctx.db.selectFrom("alertas").select("id").where("alvo_id", "=", r.id).where("resolvido_em", "is", null).execute()).toHaveLength(0);
    await ctx.db.updateTable("reservas").set({ estado: "confirmada" }).where("id", "=", r.id).execute();
    await expect(prorrogarSinal(ctx, r.id, "2026-11-16T12:00:00.000Z", recepcao, aut())).rejects.toMatchObject({ codigo: "SINAL_NAO_PRORROGAVEL" });
  });
});

describe("rotas", () => {
  test("prévia, alteração, cancelamento, no-show e prorrogação", async () => {
    const app = criarApp(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    const gov = await entrarComo(ctx, "governanca");
    const r = await criarReserva(ctx, dados, recepcao);
    const url = `/api/reservas/${r.id}`;

    const prev = await app.inject({ method: "GET", url: `${url}/previa?saida=2026-11-24`, headers: rec });
    expect(prev.statusCode).toBe(200);
    expect(prev.json()).toMatchObject({ valorAntigo: 90000, valorNovo: 120000 });
    expect((await app.inject({ method: "GET", url: `${url}/previa?saida=2026-11-24`, headers: gov })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `${url}/previa?saida=24/11`, headers: rec })).statusCode).toBe(400);

    expect((await app.inject({ method: "PATCH", url, headers: gov, payload: { saida: "2026-11-24" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url, headers: rec, payload: { saida: "x" } })).statusCode).toBe(400);
    const alt = await app.inject({ method: "PATCH", url, headers: rec, payload: { saida: "2026-11-24" } });
    expect(alt.statusCode).toBe(200);
    expect(alt.json().saida).toBe("2026-11-24");

    const pror = await app.inject({ method: "POST", url: `${url}/prorrogar-sinal`, headers: rec, payload: { novoPrazo: "2026-11-15T12:00:00.000Z", motivo: "PIX", supervisor: admin } });
    expect(pror.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${url}/no-show`, headers: rec, payload: { motivo: "x", supervisor: admin } })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: `${url}/cancelar`, headers: rec, payload: { motivo: "x" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `${url}/cancelar`, headers: gov, payload: { motivo: "x", supervisor: admin } })).statusCode).toBe(403);
    const canc = await app.inject({ method: "POST", url: `${url}/cancelar`, headers: rec, payload: { motivo: "Desistiu", supervisor: admin } });
    expect(canc.statusCode).toBe(200);
    expect(canc.json().estado).toBe("cancelada");
  });
});
