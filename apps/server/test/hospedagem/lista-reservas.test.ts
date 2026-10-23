import { beforeEach, describe, expect, test } from "vitest";
import { listarReservas } from "../../src/hospedagem/lista-reservas.js";
import { criarReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { criarApp } from "../../src/http/app.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { salvarConfig } from "../../src/nucleo/pousada.js";
import { criarQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { salvarCanal, salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let recepcao: UsuarioSessao;
let dados: NovaReserva;

async function reserva(extra: Partial<NovaReserva>, estado?: string) {
  const r = await criarReserva(ctx, { ...dados, ...extra }, recepcao);
  if (estado) await ctx.db.updateTable("reservas").set({ estado: estado as any }).where("id", "=", r.id).execute();
  return r;
}

beforeEach(async () => {
  ctx = await criarContextoTeste();
  const std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  await salvarCanal(ctx, { nome: "Site", percentual: 0, exigeSinal: false }, "u1");
  for (const n of ["11", "12", "13", "14"]) await criarQuarto(ctx, { numero: n, categoriaId: std }, "u1");
  await salvarConfig(ctx, { sinal: { exigir: false, tipo: "percentual", percentual: 30, prazoHoras: 24, toleranciaHoras: 2 } }, "u1");
  await salvarHospede(ctx, { id: "h1", nome: "Maria Silva", documentoTipo: "cpf", documento: "529.982.247-25", nascimento: "1990-01-01", nacionalidade: "BR" }, "u1");
  await salvarHospede(ctx, { id: "h2", nome: "João Pereira", documentoTipo: "passaporte", documento: "AB123456", nascimento: "1985-01-01", nacionalidade: "BR" }, "u1");
  await salvarHospede(ctx, { id: "h3", nome: "Ana Souza", documentoTipo: "passaporte", documento: "CD123456", nascimento: "1985-01-01", nacionalidade: "BR" }, "u1");
  await entrarComo(ctx, "recepcao");
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "teste-recepcao").executeTakeFirstOrThrow();
  recepcao = (await carregarUsuarioSessao(ctx, l.id))!;
  dados = { titularId: "h1", categoriaId: std, chegada: "2026-11-20", saida: "2026-11-23", adultos: 2, criancasNascimento: [], canal: "Balcão" };
});

async function tres() {
  const maria = await reserva({}, "confirmada");
  const joao = await reserva({ titularId: "h2", chegada: "2026-11-25", saida: "2026-11-27", canal: "Site" }, "pre_reserva");
  const ana = await reserva({ titularId: "h3", chegada: "2026-12-01", saida: "2026-12-03" }, "cancelada");
  return { maria, joao, ana };
}

describe("listarReservas", () => {
  test("filtra por período, estado e texto, com paginação", async () => {
    const { maria } = await tres();
    const r = await listarReservas(ctx, { inicio: "2026-11-21", fim: "2026-11-30", estados: ["confirmada", "pre_reserva"] });
    expect(r.itens.map((i) => i.titular)).toEqual(["João Pereira", "Maria Silva"]);
    expect(r.total).toBe(2);
    expect((await listarReservas(ctx, { q: "joao" })).itens[0].titular).toBe("João Pereira");
    expect((await listarReservas(ctx, { q: String(maria.codigo) })).itens.map((i) => i.titular)).toEqual(["Maria Silva"]);
    expect((await listarReservas(ctx, { canal: "Site" })).itens.map((i) => i.titular)).toEqual(["João Pereira"]);
    const p2 = await listarReservas(ctx, { porPagina: 1, pagina: 2 });
    expect(p2.itens).toHaveLength(1);
    expect(p2.total).toBe(3);
  });

  test("q trata % e _ literalmente", async () => {
    await tres();
    expect((await listarReservas(ctx, { q: "50%" })).itens).toHaveLength(0);
    expect((await listarReservas(ctx, { q: "_" })).itens).toHaveLength(0);
    expect((await listarReservas(ctx, { q: "%" })).total).toBe(0);
  });

  test("item traz total da estadia e categoria", async () => {
    await tres();
    const r = await listarReservas(ctx, { q: "maria" });
    expect(r.itens[0]).toMatchObject({ total: 90000, categoria: "Standard", estado: "confirmada", canal: "Balcão", chegada: "2026-11-20", saida: "2026-11-23" });
  });

  test("GET /api/reservas exige reservas.gerenciar e valida datas", async () => {
    await tres();
    const app = criarApp(ctx);
    const gov = await entrarComo(ctx, "governanca");
    expect((await app.inject({ method: "GET", url: "/api/reservas", headers: gov })).statusCode).toBe(403);
    const rec = await entrarComo(ctx, "recepcao");
    expect((await app.inject({ method: "GET", url: "/api/reservas?inicio=2026-02-30", headers: rec })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/reservas?estado=xyz", headers: rec })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/reservas?porPagina=101", headers: rec })).statusCode).toBe(400);
    const ok = await app.inject({ method: "GET", url: "/api/reservas?estado=confirmada,pre_reserva&pagina=1&porPagina=10", headers: rec });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().total).toBe(2);
  });

  test("canais podem ser lidos pela recepção, mas não alterados", async () => {
    const app = criarApp(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    expect((await app.inject({ method: "GET", url: "/api/tarifas/canais", headers: rec })).statusCode).toBe(200);
    const put = await app.inject({ method: "PUT", url: "/api/tarifas/canais", headers: rec, payload: { nome: "X", percentual: 0, exigeSinal: false } });
    expect(put.statusCode).toBe(403);
  });
});
