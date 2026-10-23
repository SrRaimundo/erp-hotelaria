import { beforeEach, describe, expect, test } from "vitest";
import { criarReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { lancarDiariasPendentes, processarVirada } from "../../src/hospedagem/virada.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { criarQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { emTransacao } from "../../src/shared/contexto.js";
import { salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let recepcao: UsuarioSessao;
let dados: NovaReserva;

beforeEach(async () => {
  ctx = await criarContextoTeste();
  const std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  await criarQuarto(ctx, { numero: "12", categoriaId: std }, "u1");
  await ctx.db.insertInto("hospedes").values({
    id: "h1", nome: "Titular", nome_busca: "titular", documento_tipo: "cpf", documento: "1", nacionalidade: "BR",
  }).execute();
  await entrarComo(ctx, "recepcao");
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "teste-recepcao").executeTakeFirstOrThrow();
  recepcao = (await carregarUsuarioSessao(ctx, l.id))!;
  dados = { titularId: "h1", categoriaId: std, chegada: "2026-11-20", saida: "2026-11-23", adultos: 2, criancasNascimento: [], canal: "Balcão" };
});

const hospedar = (id: string) => ctx.db.updateTable("reservas").set({ estado: "hospedada" }).where("id", "=", id).execute();
const diarias = (reservaId: string) =>
  ctx.db.selectFrom("lancamentos").selectAll().where("reserva_id", "=", reservaId).where("tipo", "=", "diaria").orderBy("data_ref").execute();

describe("virada do dia hoteleiro", () => {
  test("a noite de 20/11 é lançada na virada das 04:00 de 21/11", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await hospedar(r.id);
    ctx.relogio.definir("2026-11-21T06:59:00Z");
    expect(await processarVirada(ctx)).toBe(0);
    expect(await diarias(r.id)).toEqual([]);
    ctx.relogio.definir("2026-11-21T07:00:00Z");
    expect(await processarVirada(ctx)).toBe(1);
    const ls = await diarias(r.id);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({
      data_ref: "2026-11-20", valor: 30000, quantidade: 1, origem: "hospedagem", conta_id: r.contaId,
      usuario: "Sistema", descricao: "Diária 20/11 — Base",
    });
  });

  test("Review Focus 3: servidor desligado 3 dias lança as noites faltantes uma única vez", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await hospedar(r.id);
    ctx.relogio.definir("2026-11-24T12:00:00Z");
    expect(await processarVirada(ctx)).toBe(3);
    expect((await diarias(r.id)).map((l) => l.data_ref)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(await processarVirada(ctx)).toBe(0);
    expect(await diarias(r.id)).toHaveLength(3);
  });

  test("reserva não hospedada não recebe diária", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    ctx.relogio.definir("2026-11-24T12:00:00Z");
    expect(await processarVirada(ctx)).toBe(0);
    expect(await diarias(r.id)).toEqual([]);
  });

  test("lancarDiariasPendentes respeita o limite exclusivo e a idempotência", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await hospedar(r.id);
    expect(await emTransacao(ctx, (tx) => lancarDiariasPendentes(tx, r.id, "2026-11-21"))).toBe(1);
    expect(await emTransacao(ctx, (tx) => lancarDiariasPendentes(tx, r.id, "2026-11-22"))).toBe(1);
    expect(await emTransacao(ctx, (tx) => lancarDiariasPendentes(tx, r.id, "2026-11-22"))).toBe(0);
    expect((await diarias(r.id)).map((l) => l.data_ref)).toEqual(["2026-11-20", "2026-11-21"]);
  });

  test("noite congelada com valor zero é ignorada", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await hospedar(r.id);
    await ctx.db.updateTable("reserva_noites").set({ valor: 0 }).where("reserva_id", "=", r.id).where("data", "=", "2026-11-20").execute();
    ctx.relogio.definir("2026-11-24T12:00:00Z");
    expect(await processarVirada(ctx)).toBe(2);
    expect((await diarias(r.id)).map((l) => l.data_ref)).toEqual(["2026-11-21", "2026-11-22"]);
  });
});
