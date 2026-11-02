import { beforeEach, describe, expect, test } from "vitest";
import { criarReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { criarApp } from "../../src/http/app.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { criarQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { salvarCanal, salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>; // dia hoteleiro: 2026-11-10
let app: ReturnType<typeof criarApp>;
let h: { authorization: string };
let recepcao: UsuarioSessao;
let dados: NovaReserva;
let q11: string;
let contador = 0;

/** O nome do hóspede titular vem de `nome`; `extra` ajusta datas, pessoas etc. */
async function reserva(nome: string, extra: Partial<NovaReserva>, estado?: string, quartoId?: string) {
  contador++;
  const titularId = `hh${contador}`;
  await salvarHospede(ctx, { id: titularId, nome, documentoTipo: "passaporte", documento: `P${contador}0000`, nascimento: "1985-01-01", nacionalidade: "BR", telefone: `1199999000${contador}` }, "u1");
  const r = await criarReserva(ctx, { ...dados, titularId, ...extra }, recepcao);
  if (!estado && !quartoId) return r;
  await ctx.db
    .updateTable("reservas")
    .set({ ...(estado ? { estado: estado as any } : {}), ...(quartoId ? { quarto_id: quartoId } : {}) })
    .where("id", "=", r.id)
    .execute();
  return r;
}

async function gerar(id: string, query = "", cab = h): Promise<{ status: number; corpo: any }> {
  const r = await app.inject({ method: "GET", url: `/api/relatorios/${id}${query}`, headers: cab });
  return { status: r.statusCode, corpo: r.json() };
}
const nomes = (corpo: any): string[] => corpo.secoes[0].linhas.map((l: any) => l.hospede);

beforeEach(async () => {
  ctx = await criarContextoTeste();
  app = criarApp(ctx);
  const std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 2, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  await salvarCanal(ctx, { nome: "Site", percentual: 0, exigeSinal: false }, "u1");
  await salvarCanal(ctx, { nome: "Booking", percentual: 0, exigeSinal: false }, "u1");
  q11 = (await criarQuarto(ctx, { numero: "11", categoriaId: std }, "u1")).id;
  for (const n of ["12", "13", "14", "15", "16", "17", "18", "19"]) await criarQuarto(ctx, { numero: n, categoriaId: std }, "u1");
  h = await entrarComo(ctx, "recepcao");
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "teste-recepcao").executeTakeFirstOrThrow();
  recepcao = (await carregarUsuarioSessao(ctx, l.id))!;
  dados = { titularId: "x", categoriaId: std, chegada: "2026-11-10", saida: "2026-11-12", adultos: 2, criancasNascimento: [], canal: "Balcão" };
  contador = 0;
});

const linhas = (corpo: any, i: number): any[] => corpo.secoes[i].linhas;
const porCanal = (corpo: any, i: number, canal: string) => linhas(corpo, i).find((l) => l.canal === canal);

describe("relatório canais: Reservas por canal", () => {
  test("sem permissão reservas.gerenciar: 403; sem login: 401", async () => {
    expect((await gerar("canais", "", await entrarComo(ctx, "governanca"))).status).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/relatorios/canais" })).statusCode).toBe(401);
  });

  test("padrão é o mês atual do dia hoteleiro; só o dia 1 e o último entram", async () => {
    await reserva("Início", { chegada: "2026-11-01", saida: "2026-11-02", canal: "Site" });
    await reserva("Fim", { chegada: "2026-11-30", saida: "2026-12-01", canal: "Site" });
    await reserva("Antes", { chegada: "2026-10-30", saida: "2026-11-01", canal: "Booking" }); // saída exclusiva: nenhuma noite em novembro
    await reserva("Depois", { chegada: "2026-12-01", saida: "2026-12-02", canal: "Booking" });
    const r = await gerar("canais");
    expect(r.status).toBe(200);
    expect(r.corpo.subtitulo).toBe("Período de 01/11/2026 a 30/11/2026");
    expect(porCanal(r.corpo, 1, "Site")).toMatchObject({ reservas: 2, noites: 2, receita: 60000 });
    expect(porCanal(r.corpo, 1, "Booking")).toBeUndefined();
  });

  test("estadia que cruza a borda conta só as noites e a receita de dentro do período", async () => {
    await reserva("Cruza o início", { chegada: "2026-10-30", saida: "2026-11-03", canal: "Booking" }); // 30/10, 31/10 fora; 01/11 e 02/11 dentro
    await reserva("Cruza o fim", { chegada: "2026-11-29", saida: "2026-12-04", canal: "Booking" }); // 29/11 e 30/11 dentro
    const r = await gerar("canais");
    expect(porCanal(r.corpo, 1, "Booking")).toMatchObject({ reservas: 2, noites: 4, receita: 120000 });
    const menor = await gerar("canais", "?inicio=2026-11-02&fim=2026-11-02");
    expect(porCanal(menor.corpo, 1, "Booking")).toMatchObject({ reservas: 1, noites: 1, receita: 30000 });
  });

  test("cancelada e no-show só aparecem nas próprias colunas, sem noites nem receita", async () => {
    await reserva("Ok", { chegada: "2026-11-10", saida: "2026-11-12", canal: "Site" });
    await reserva("Cancelou", { chegada: "2026-11-10", saida: "2026-11-12", canal: "Site" }, "cancelada");
    await reserva("Sumiu", { chegada: "2026-11-10", saida: "2026-11-12", canal: "Site" }, "no_show");
    await reserva("Só cancelou", { chegada: "2026-11-10", saida: "2026-11-12", canal: "Booking" }, "cancelada");
    const r = await gerar("canais");
    expect(porCanal(r.corpo, 1, "Site")).toMatchObject({ reservas: 1, noites: 2, receita: 60000, cancelamentos: 1, noShows: 1 });
    expect(porCanal(r.corpo, 1, "Booking")).toMatchObject({ reservas: 0, noites: 0, receita: 0, cancelamentos: 1, noShows: 0 });
    expect(r.corpo.secoes[1].totais).toMatchObject({ reservas: 1, noites: 2, receita: 60000, cancelamentos: 2, noShows: 1, pct: "100,0%" });
  });

  test("percentual das noites, ordem decrescente e linha de totais", async () => {
    await reserva("A", { chegada: "2026-11-10", saida: "2026-11-13", canal: "Booking" });
    await reserva("B", { chegada: "2026-11-10", saida: "2026-11-11", canal: "Site" });
    const r = await gerar("canais");
    expect(linhas(r.corpo, 1).map((l) => [l.canal, l.pct])).toEqual([["Booking", "75,0%"], ["Site", "25,0%"]]);
    expect(r.corpo.secoes[1].totais).toMatchObject({ reservas: 2, noites: 4, receita: 120000 });
  });

  test("canal vazio vira 'Sem canal' nas duas seções", async () => {
    const a = await reserva("Sem", { chegada: "2026-11-09", saida: "2026-11-11" }, "hospedada", q11);
    await ctx.db.updateTable("reservas").set({ canal: "" }).where("id", "=", a.id).execute();
    const r = await gerar("canais");
    expect(porCanal(r.corpo, 0, "Sem canal")).toMatchObject({ quartos: 1, pessoas: 2, pct: "100,0%" });
    expect(porCanal(r.corpo, 1, "Sem canal")).toMatchObject({ reservas: 1, noites: 2 });
  });

  test("hospedados agora: quartos, pessoas e % por canal, ignorando o período", async () => {
    await reserva("A", { chegada: "2026-11-09", saida: "2026-11-11", canal: "Booking", criancasNascimento: ["2020-01-01"] }, "hospedada", q11);
    await reserva("B", { chegada: "2026-11-09", saida: "2026-11-11", canal: "Booking" }, "hospedada");
    await reserva("C", { chegada: "2026-11-09", saida: "2026-11-11", canal: "Site", adultos: 1 }, "hospedada");
    await reserva("D", { chegada: "2026-11-09", saida: "2026-11-11", canal: "Site" }, "confirmada");
    const r = await gerar("canais", "?inicio=2026-01-01&fim=2026-01-02");
    expect(linhas(r.corpo, 0)).toEqual([
      { canal: "Booking", quartos: 2, pessoas: 5, pct: "66,7%" },
      { canal: "Site", quartos: 1, pessoas: 1, pct: "33,3%" },
    ]);
    expect(r.corpo.secoes[0].totais).toMatchObject({ quartos: 3, pessoas: 6 });
    expect(r.corpo.resumo[0]).toEqual({ rotulo: "Hospedados agora", valor: "3 quartos" });
  });

  test("período inválido: 422", async () => {
    expect((await gerar("canais", "?inicio=2026-11-05&fim=2026-11-01")).status).toBe(422);
  });
});
