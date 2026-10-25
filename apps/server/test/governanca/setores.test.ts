import { beforeEach, describe, expect, test } from "vitest";
import { estornarLancamento, extrato, lancar, registrarPagamento } from "../../src/hospedagem/conta.js";
import { criarReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { lancarDiariasPendentes } from "../../src/hospedagem/virada.js";
import { criarApp } from "../../src/http/app.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { abrirCaixa } from "../../src/nucleo/caixa.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { criarProduto } from "../../src/nucleo/produtos.js";
import { criarQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { abrirBanco, migrar } from "../../src/shared/banco.js";
import { todasMigracoes } from "../../src/shared/migracoes.js";
import { salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let recepcao: UsuarioSessao;
let dados: NovaReserva;
const admin = { login: "admin", senha: "admin" };
const aut = { motivo: "Lançado por engano", supervisor: admin };

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

describe("setores nos lançamentos e produtos", () => {
  test("migração preenche setor dos lançamentos existentes", async () => {
    const db = abrirBanco(":memory:");
    await migrar(db, todasMigracoes.filter((m) => m.nome < "0500"));
    await db.insertInto("hospedes").values({ id: "h", nome: "H", nome_busca: "h", documento_tipo: "cpf", documento: "1", nacionalidade: "BR" }).execute();
    await db.insertInto("contas").values({ id: "c", titular_id: "h", situacao: "aberta" }).execute();
    const base = { conta_id: "c", origem: "hospedagem", quantidade: 1, instante: "2026-11-10T10:00:00Z", usuario: "u" };
    const early = await db.selectFrom("produtos").select("id").where("codigo", "=", "EARLY_CHECKIN").executeTakeFirstOrThrow();
    await db.insertInto("produtos").values({ id: "p-agua", codigo: "AGUA", nome: "Água", preco_centavos: 500, unidade: "un", grupo: "bebidas", tipo: "produto" }).execute();
    await db.insertInto("lancamentos").values({ ...base, id: "l1", tipo: "diaria", descricao: "Diária", valor: 100 }).execute();
    await db.insertInto("lancamentos").values({ ...base, id: "l2", tipo: "extra", descricao: "Early", valor: 50, produto_id: early.id }).execute();
    await db.insertInto("lancamentos").values({ ...base, id: "l3", tipo: "extra", descricao: "Água", valor: 5, produto_id: "p-agua" }).execute();
    await db.insertInto("lancamentos").values({ ...base, id: "l4", tipo: "estorno", descricao: "Estorno: Early", valor: -50, produto_id: early.id, estorna_id: "l2" }).execute();
    await db.insertInto("lancamentos").values({ ...base, id: "l5", tipo: "estorno", descricao: "Estorno: Água", valor: -5, produto_id: "p-agua", estorna_id: "l3" }).execute();
    await migrar(db, todasMigracoes);
    const ls = await db.selectFrom("lancamentos").select(["id", "setor"]).orderBy("id").execute();
    expect(ls.map((l) => l.setor)).toEqual(["hospedagem", "hospedagem", "recepcao", "hospedagem", "recepcao"]);
    const ps = await db.selectFrom("produto_setores").select(["produto_id", "setor"]).execute();
    expect(ps.filter((p) => p.produto_id === "p-agua").map((p) => p.setor)).toEqual(["recepcao"]);
    expect(ps.filter((p) => p.produto_id === early.id).map((p) => p.setor)).toEqual(["hospedagem"]);
  });

  test("diária lançada pela virada vai para hospedagem; extra da recepção respeita o setor enviado", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await lancarDiariasPendentes(ctx, r.id, "2026-11-21");
    const a = await lancar(ctx, { contaId: r.contaId, tipo: "extra", origem: "hospedagem", descricao: "Lavanderia", quantidade: 1, valorUnitario: 5000, setor: "recepcao" }, recepcao.id);
    const b = await lancar(ctx, { contaId: r.contaId, tipo: "extra", origem: "hospedagem", descricao: "Cerveja", quantidade: 1, valorUnitario: 1200, setor: "bar" }, recepcao.id);
    const ls = await ctx.db.selectFrom("lancamentos").select(["id", "tipo", "setor"]).where("conta_id", "=", r.contaId).execute();
    expect(ls.find((l) => l.tipo === "diaria")?.setor).toBe("hospedagem");
    expect(ls.find((l) => l.id === a)?.setor).toBe("recepcao");
    expect(ls.find((l) => l.id === b)?.setor).toBe("bar");
  });

  test("estorno herda o setor do lançamento original", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    const id = await lancar(ctx, { contaId: r.contaId, tipo: "extra", origem: "hospedagem", descricao: "Água", quantidade: 1, valorUnitario: 500, setor: "frigobar" }, recepcao.id);
    const est = await estornarLancamento(ctx, id, recepcao, aut);
    const l = await ctx.db.selectFrom("lancamentos").select("setor").where("id", "=", est).executeTakeFirstOrThrow();
    expect(l.setor).toBe("frigobar");
  });

  test("extrato traz setor nos lançamentos e null nos pagamentos", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await lancar(ctx, { contaId: r.contaId, tipo: "extra", origem: "hospedagem", descricao: "Jantar", quantidade: 1, valorUnitario: 8000, setor: "restaurante" }, recepcao.id);
    await abrirCaixa(ctx, recepcao.id, 0);
    await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 1000 }, recepcao);
    const ex = await extrato(ctx, r.contaId);
    expect(ex.find((l) => l.natureza === "debito")?.setor).toBe("restaurante");
    expect(ex.find((l) => l.natureza === "credito")?.setor).toBeNull();
  });

  test("produto em vários setores aparece no filtro de cada um", async () => {
    const p = await criarProduto(ctx, { codigo: "AGUA", nome: "Água mineral", precoCentavos: 500, unidade: "un", grupo: "bebidas", tipo: "produto", setores: ["frigobar", "recepcao", "bar"] }, "u1");
    expect(p.setores).toEqual(["bar", "frigobar", "recepcao"]);
    const app = criarApp(ctx);
    const h = await entrarComo(ctx, "recepcao");
    const codigos = async (q: string) => (await app.inject({ method: "GET", url: `/api/produtos${q}`, headers: h })).json().map((x: any) => x.codigo);
    expect(await codigos("?setor=frigobar")).toContain("AGUA");
    expect(await codigos("?setor=bar")).toContain("AGUA");
    expect(await codigos("?setor=restaurante")).not.toContain("AGUA");
    expect(await codigos("")).toContain("AGUA");
    const lista = (await app.inject({ method: "GET", url: "/api/produtos", headers: h })).json();
    expect(lista.find((x: any) => x.codigo === "AGUA").setores).toEqual(["bar", "frigobar", "recepcao"]);
  });

  test("produto criado sem setores fica na recepção", async () => {
    const p = await criarProduto(ctx, { codigo: "X", nome: "X", precoCentavos: 1, unidade: "un", grupo: "g", tipo: "produto" }, "u1");
    expect(p.setores).toEqual(["recepcao"]);
  });

  test("setor inválido no lançamento → 400; sem setor assume recepcao", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    const app = criarApp(ctx);
    const h = await entrarComo(ctx, "recepcao");
    const url = `/api/contas/${r.contaId}/lancamentos`;
    const ruim = await app.inject({ method: "POST", url, headers: h, payload: { tipo: "extra", descricao: "X", valorUnitario: 100, quantidade: 1, setor: "cozinha" } });
    expect(ruim.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url, headers: h, payload: { tipo: "extra", descricao: "X", valorUnitario: 100, quantidade: 1 } });
    expect(ok.statusCode).toBe(200);
    const bar = await app.inject({ method: "POST", url, headers: h, payload: { tipo: "extra", descricao: "Y", valorUnitario: 100, quantidade: 1, setor: "bar" } });
    const l = await ctx.db.selectFrom("lancamentos").select("setor").where("id", "=", bar.json().id).executeTakeFirstOrThrow();
    expect(l.setor).toBe("bar");
    const padrao = await ctx.db.selectFrom("lancamentos").select("setor").where("id", "=", ok.json().id).executeTakeFirstOrThrow();
    expect(padrao.setor).toBe("recepcao");
  });
});
