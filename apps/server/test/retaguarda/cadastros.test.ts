import { beforeEach, describe, expect, test } from "vitest";
import { sugerirQuartos } from "../../src/hospedagem/checkin.js";
import { mapaOcupacao } from "../../src/hospedagem/consultas.js";
import { verificarDisponibilidade } from "../../src/hospedagem/disponibilidade.js";
import { listaGovernanca } from "../../src/hospedagem/governanca.js";
import { criarReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { criarApp } from "../../src/http/app.js";
import { criarCategoria, definirCategoriaAtiva, editarCategoria, listarCategorias } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { criarProduto, definirProdutoAtivo, editarProduto, listarProdutos } from "../../src/nucleo/produtos.js";
import { criarQuarto, criarQuartosEmLote, definirQuartoAtivo, editarQuarto, listarQuartos } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { obterModelos } from "../../src/governanca/modelos.js";
import { ocupacaoCategoria } from "../../src/tarifas/ocupacao.js";
import { salvarTabelaBase } from "../../src/tarifas/regras.js";
import { emTransacao } from "../../src/shared/contexto.js";
import { ErroDominio } from "../../src/shared/erros.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let cat: string;
let q101: string;
let q102: string;
let recepcao: UsuarioSessao;
let dados: NovaReserva;

const erro = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroDominio) return e;
    throw e;
  }
  throw new Error("esperava ErroDominio");
};

beforeEach(async () => {
  ctx = await criarContextoTeste(); // dia hoteleiro: 2026-11-10
  cat = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: cat, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  q101 = (await criarQuarto(ctx, { numero: "101", categoriaId: cat }, "u1")).id;
  q102 = (await criarQuarto(ctx, { numero: "102", categoriaId: cat }, "u1")).id;
  await salvarHospede(ctx, { id: "h1", nome: "Maria Silva", documentoTipo: "cpf", documento: "529.982.247-25", nascimento: "1990-01-01", nacionalidade: "BR" }, "u1");
  await entrarComo(ctx, "recepcao");
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "teste-recepcao").executeTakeFirstOrThrow();
  recepcao = (await carregarUsuarioSessao(ctx, l.id))!;
  dados = { titularId: "h1", categoriaId: cat, chegada: "2026-11-20", saida: "2026-11-23", adultos: 1, criancasNascimento: [], canal: "Balcão" };
});

describe("categorias", () => {
  test("editar categoria altera campos e audita", async () => {
    const c = await editarCategoria(ctx, cat, { nome: "Superior", maxAdultos: 4, maxCriancas: 2, comodidades: ["wifi"] }, "u1");
    expect(c).toMatchObject({ id: cat, nome: "Superior", maxAdultos: 4, maxCriancas: 2, comodidades: ["wifi"] });
    expect((await listarCategorias(ctx))[0]).toEqual(c);
    expect(await ctx.db.selectFrom("auditoria").select("id").where("acao", "=", "categoria.editar").execute()).toHaveLength(1);
  });

  test("desativar categoria com quarto ativo → CATEGORIA_COM_QUARTOS", async () => {
    const e = await erro(definirCategoriaAtiva(ctx, cat, false, "u1"));
    expect(e.codigo).toBe("CATEGORIA_COM_QUARTOS");
    expect(await listarCategorias(ctx)).toHaveLength(1);
  });

  test("categoria sem quartos ativos desativa, some da lista padrão e reativa; tudo auditado", async () => {
    await definirQuartoAtivo(ctx, q101, false, "u1");
    await definirQuartoAtivo(ctx, q102, false, "u1");
    await definirCategoriaAtiva(ctx, cat, false, "u1");
    expect(await listarCategorias(ctx)).toEqual([]);
    expect(await listarCategorias(ctx, { incluirInativos: true })).toHaveLength(1);
    await definirCategoriaAtiva(ctx, cat, true, "u1");
    expect(await listarCategorias(ctx)).toHaveLength(1);
    const acoes = (await ctx.db.selectFrom("auditoria").select("acao").where("alvo_id", "=", cat).execute()).map((a) => a.acao);
    expect(acoes).toEqual(expect.arrayContaining(["categoria.desativar", "categoria.reativar"]));
  });
});

describe("quartos", () => {
  test("editar quarto: número, categoria e bloco; número duplicado → NUMERO_QUARTO_DUPLICADO", async () => {
    const q = await editarQuarto(ctx, q101, { numero: "201", categoriaId: cat, bloco: "B" }, "u1");
    expect(q).toMatchObject({ numero: "201", bloco: "B" });
    expect((await erro(editarQuarto(ctx, q101, { numero: "102", categoriaId: cat, bloco: null }, "u1"))).codigo).toBe("NUMERO_QUARTO_DUPLICADO");
    expect((await erro(editarQuarto(ctx, q101, { numero: "201", categoriaId: "nao-existe", bloco: null }, "u1"))).codigo).toBe("CATEGORIA_NAO_ENCONTRADA");
  });

  test("desativar quarto com reserva futura → QUARTO_COM_RESERVAS com os códigos", async () => {
    const r = await criarReserva(ctx, { ...dados, quartoId: q101 }, recepcao);
    const e = await erro(definirQuartoAtivo(ctx, q101, false, "u1"));
    expect(e.codigo).toBe("QUARTO_COM_RESERVAS");
    expect((e.detalhes as any).codigos).toEqual([r.codigo]);
    expect((await listarQuartos(ctx)).map((q) => q.numero)).toEqual(["101", "102"]);
  });

  test("desativar quarto ocupado → QUARTO_COM_RESERVAS; reserva já encerrada não impede", async () => {
    await ctx.db.updateTable("quartos").set({ situacao: "ocupado" }).where("id", "=", q102).execute();
    expect((await erro(definirQuartoAtivo(ctx, q102, false, "u1"))).codigo).toBe("QUARTO_COM_RESERVAS");
    const passada = await criarReserva(ctx, { ...dados, quartoId: q101, chegada: "2026-11-20", saida: "2026-11-22" }, recepcao);
    await ctx.db.updateTable("reservas").set({ chegada: "2026-11-05", saida: "2026-11-09" }).where("id", "=", passada.id).execute();
    await definirQuartoAtivo(ctx, q101, false, "u1");
    expect((await listarQuartos(ctx)).map((q) => q.numero)).toEqual(["102"]);
  });

  test("quarto inativo some do mapa, da disponibilidade, da governança, das sugestões e da ocupação", async () => {
    const r = await criarReserva(ctx, { ...dados, quartoId: q102 }, recepcao);
    await definirQuartoAtivo(ctx, q101, false, "u1");
    const mapa = await mapaOcupacao(ctx, { inicio: "2026-11-20", fim: "2026-11-25" });
    expect(mapa.quartos.map((q) => q.numero)).toEqual(["102"]);
    expect((await listaGovernanca(ctx)).map((i) => i.numero)).toEqual(["102"]);
    expect((await sugerirQuartos(ctx, r.id)).map((q) => q.numero)).toEqual(["102"]);
    expect(await ocupacaoCategoria(ctx, cat, "2026-11-21")).toBe(100); // 1 reserva / 1 quarto ativo
    expect((await erro(verificarDisponibilidade(ctx, { categoriaId: cat, chegada: "2026-11-20", saida: "2026-11-23" }))).codigo).toBe("CATEGORIA_LOTADA");
    expect((await erro(verificarDisponibilidade(ctx, { categoriaId: cat, quartoId: q101, chegada: "2026-11-30", saida: "2026-12-01" }))).codigo).toBe("QUARTO_INDISPONIVEL");
    await definirQuartoAtivo(ctx, q101, true, "u1");
    expect((await mapaOcupacao(ctx, { inicio: "2026-11-20", fim: "2026-11-25" })).quartos).toHaveLength(2);
  });

  test("Review Focus 3 (R3): número de quarto inativo continua ocupado — criar, editar e lote → NUMERO_QUARTO_DUPLICADO", async () => {
    await definirQuartoAtivo(ctx, q101, false, "u1");
    expect((await erro(editarQuarto(ctx, q102, { numero: "101", categoriaId: cat, bloco: null }, "u1"))).codigo).toBe("NUMERO_QUARTO_DUPLICADO");
    expect((await erro(criarQuarto(ctx, { numero: "101", categoriaId: cat }, "u1"))).codigo).toBe("NUMERO_QUARTO_DUPLICADO");
    const lote = await erro(emTransacao(ctx, (tx) => criarQuartosEmLote(tx, { categoriaId: cat, de: 101, ate: 101 }, "u1")));
    expect([lote.codigo, (lote.detalhes as any).numeros]).toEqual(["NUMERO_QUARTO_DUPLICADO", ["101"]]);
    await definirQuartoAtivo(ctx, q101, true, "u1");
    expect((await listarQuartos(ctx)).map((q) => q.numero)).toEqual(["101", "102"]);
    expect(await ctx.db.selectFrom("auditoria").select("id").where("acao", "in", ["quarto.desativar", "quarto.reativar"]).execute()).toHaveLength(2);
  });

  test("categoria inativa: criar, editar para ela, lote e reativar quarto → CATEGORIA_INATIVA", async () => {
    const outra = (await criarCategoria(ctx, { nome: "Luxo", maxAdultos: 2, maxCriancas: 0, comodidades: [] }, "u1")).id;
    await definirCategoriaAtiva(ctx, outra, false, "u1");
    expect((await erro(criarQuarto(ctx, { numero: "900", categoriaId: outra }, "u1"))).codigo).toBe("CATEGORIA_INATIVA");
    expect((await erro(editarQuarto(ctx, q101, { numero: "101", categoriaId: outra, bloco: null }, "u1"))).codigo).toBe("CATEGORIA_INATIVA");
    expect((await erro(emTransacao(ctx, (tx) => criarQuartosEmLote(tx, { categoriaId: outra, de: 900, ate: 901 }, "u1")))).codigo).toBe("CATEGORIA_INATIVA");
    await definirQuartoAtivo(ctx, q101, false, "u1");
    await definirQuartoAtivo(ctx, q102, false, "u1");
    await definirCategoriaAtiva(ctx, cat, false, "u1");
    expect((await erro(definirQuartoAtivo(ctx, q101, true, "u1"))).codigo).toBe("CATEGORIA_INATIVA");
  });

  test("último quarto ativo da categoria com reserva sem quarto → QUARTO_COM_RESERVAS; com outro quarto ativo, desativa", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await definirQuartoAtivo(ctx, q101, false, "u1");
    const e = await erro(definirQuartoAtivo(ctx, q102, false, "u1"));
    expect([e.codigo, (e.detalhes as any).codigos]).toEqual(["QUARTO_COM_RESERVAS", [r.codigo]]);
  });

  test("editar categoria de quarto com reserva ativa → QUARTO_COM_RESERVAS; sem reserva, troca", async () => {
    const outra = (await criarCategoria(ctx, { nome: "Luxo", maxAdultos: 2, maxCriancas: 0, comodidades: [] }, "u1")).id;
    const r = await criarReserva(ctx, { ...dados, quartoId: q101 }, recepcao);
    const e = await erro(editarQuarto(ctx, q101, { numero: "101", categoriaId: outra, bloco: null }, "u1"));
    expect(e.codigo).toBe("QUARTO_COM_RESERVAS");
    expect((e.detalhes as any).codigos).toEqual([r.codigo]);
    expect((await editarQuarto(ctx, q101, { numero: "111", categoriaId: cat, bloco: null }, "u1")).numero).toBe("111");
    expect((await editarQuarto(ctx, q102, { numero: "102", categoriaId: outra, bloco: null }, "u1")).categoriaId).toBe(outra);
  });

  test("lote cria números de..ate como texto, com bloco", async () => {
    const criados = await emTransacao(ctx, (tx) => criarQuartosEmLote(tx, { categoriaId: cat, de: 201, ate: 203, bloco: "B" }, "u1"));
    expect(criados.map((q) => [q.numero, q.bloco, q.situacao])).toEqual([["201", "B", "livre"], ["202", "B", "livre"], ["203", "B", "livre"]]);
    expect(await listarQuartos(ctx)).toHaveLength(5);
  });

  test("Review Focus 2: lote 101–106 com 105 existente → nada criado e detalhes.numeros = ['105']", async () => {
    const q105 = await criarQuarto(ctx, { numero: "105", categoriaId: cat }, "u1");
    await definirQuartoAtivo(ctx, q105.id, false, "u1");
    const antes = await listarQuartos(ctx, { incluirInativos: true });
    const e = await erro(emTransacao(ctx, (tx) => criarQuartosEmLote(tx, { categoriaId: cat, de: 103, ate: 106 }, "u1")));
    expect(e.codigo).toBe("NUMERO_QUARTO_DUPLICADO");
    expect((e.detalhes as any).numeros).toEqual(["105"]);
    expect(await listarQuartos(ctx, { incluirInativos: true })).toEqual(antes);
    // lote que colide com 101 e 102 (ativos)
    const e2 = await erro(emTransacao(ctx, (tx) => criarQuartosEmLote(tx, { categoriaId: cat, de: 100, ate: 102 }, "u1")));
    expect((e2.detalhes as any).numeros).toEqual(["101", "102"]);
  });

  test("lote: máximo de 200 por vez, intervalo válido e categoria existente", async () => {
    expect((await erro(emTransacao(ctx, (tx) => criarQuartosEmLote(tx, { categoriaId: cat, de: 1000, ate: 1200 }, "u1")))).codigo).toBe("LOTE_INVALIDO");
    expect((await erro(emTransacao(ctx, (tx) => criarQuartosEmLote(tx, { categoriaId: cat, de: 5, ate: 4 }, "u1")))).codigo).toBe("LOTE_INVALIDO");
    expect((await erro(emTransacao(ctx, (tx) => criarQuartosEmLote(tx, { categoriaId: "x", de: 5, ate: 6 }, "u1")))).codigo).toBe("CATEGORIA_NAO_ENCONTRADA");
    const ok = await emTransacao(ctx, (tx) => criarQuartosEmLote(tx, { categoriaId: cat, de: 1000, ate: 1199 }, "u1"));
    expect(ok).toHaveLength(200);
  });
});

describe("produtos", () => {
  test("editar produto troca campos e setores; código não muda", async () => {
    const p = await criarProduto(ctx, { codigo: "AGUA", nome: "Água", precoCentavos: 500, unidade: "un", grupo: "bebidas", tipo: "produto", setores: ["frigobar"] }, "u1");
    const e = await editarProduto(ctx, p.id, { nome: "Água 500ml", precoCentavos: 600, unidade: "un", tipo: "produto", setores: ["frigobar", "recepcao"] }, "u1");
    expect(e).toMatchObject({ codigo: "AGUA", nome: "Água 500ml", precoCentavos: 600 });
    expect([...e.setores].sort()).toEqual(["frigobar", "recepcao"]);
    expect((await erro(editarProduto(ctx, p.id, { nome: "x", precoCentavos: -1, unidade: "un", tipo: "produto", setores: ["frigobar"] }, "u1"))).codigo).toBe("PRECO_INVALIDO");
  });

  test("produto inativo some do lançamento e do frigobar; EARLY/LATE fora da lista", async () => {
    const p = await criarProduto(ctx, { codigo: "AGUA", nome: "Água", precoCentavos: 500, unidade: "un", grupo: "bebidas", tipo: "produto", setores: ["frigobar", "recepcao"] }, "u1");
    expect((await listarProdutos(ctx, "recepcao")).map((x) => x.codigo)).toContain("AGUA");
    expect((await listarProdutos(ctx, "recepcao")).map((x) => x.codigo)).not.toContain("EARLY_CHECKIN");
    expect((await listarProdutos(ctx)).map((x) => x.codigo)).not.toContain("LATE_CHECKOUT");
    expect((await listarProdutos(ctx, "hospedagem")).map((x) => x.codigo)).toEqual(expect.arrayContaining(["EARLY_CHECKIN", "LATE_CHECKOUT"]));
    await definirProdutoAtivo(ctx, p.id, false, "u1");
    expect((await listarProdutos(ctx, "recepcao")).map((x) => x.codigo)).not.toContain("AGUA");
    expect((await obterModelos(ctx)).produtosFrigobar.map((x) => x.codigo)).not.toContain("AGUA");
    expect((await listarProdutos(ctx, "recepcao", { incluirInativos: true })).map((x) => x.codigo)).toContain("AGUA");
    await definirProdutoAtivo(ctx, p.id, true, "u1");
    expect((await obterModelos(ctx)).produtosFrigobar.map((x) => x.codigo)).toContain("AGUA");
    expect(await ctx.db.selectFrom("auditoria").select("id").where("acao", "in", ["produto.desativar", "produto.reativar"]).execute()).toHaveLength(2);
  });
});

describe("rotas", () => {
  test("produto inativo não pode ser lançado na conta → PRODUTO_INATIVO; ativo segue o fluxo", async () => {
    const app = criarApp(ctx);
    const h = await entrarComo(ctx, "recepcao");
    const p = await criarProduto(ctx, { codigo: "AGUA", nome: "Água", precoCentavos: 500, unidade: "un", grupo: "bebidas", tipo: "produto", setores: ["recepcao"] }, "u1");
    await definirProdutoAtivo(ctx, p.id, false, "u1");
    const lancar = () => app.inject({ method: "POST", url: "/api/contas/qualquer/lancamentos", headers: h, payload: { tipo: "extra", produtoCodigo: "AGUA", quantidade: 1 } });
    const r = await lancar();
    expect([r.statusCode, r.json().codigo]).toEqual([422, "PRODUTO_INATIVO"]);
    await definirProdutoAtivo(ctx, p.id, true, "u1");
    expect((await lancar()).json().codigo).not.toBe("PRODUTO_INATIVO");
  });

  test("governança não edita cadastros (403)", async () => {
    const app = criarApp(ctx);
    const h = await entrarComo(ctx, "governanca");
    const chamadas: [string, string, unknown][] = [
      ["PUT", `/api/categorias/${cat}`, { nome: "x", maxAdultos: 1, maxCriancas: 0 }],
      ["POST", `/api/categorias/${cat}/desativar`, {}],
      ["PUT", `/api/quartos/${q101}`, { numero: "9", categoriaId: cat }],
      ["POST", `/api/quartos/${q101}/desativar`, {}],
      ["POST", `/api/quartos/${q101}/reativar`, {}],
      ["POST", "/api/quartos/lote", { categoriaId: cat, de: 1, ate: 2 }],
      ["PUT", "/api/produtos/x", { nome: "x", precoCentavos: 1, unidade: "un", tipo: "produto", setores: ["recepcao"] }],
      ["POST", "/api/produtos/x/desativar", {}],
    ];
    for (const [method, url, payload] of chamadas) {
      const r = await app.inject({ method: method as any, url, headers: h, payload: payload as any });
      expect([method, url, r.statusCode]).toEqual([method, url, 403]);
    }
    for (const u of ["categorias", "quartos", "produtos"]) {
      expect((await app.inject({ method: "GET", url: `/api/${u}?incluirInativos=1`, headers: h })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: `/api/${u}`, headers: h })).statusCode).toBe(200);
    }
  });

  test("admin edita, desativa, reativa e cria lote pela API", async () => {
    const app = criarApp(ctx);
    const h = await entrarComo(ctx, "admin");
    const put = await app.inject({ method: "PUT", url: `/api/quartos/${q101}`, headers: h, payload: { numero: "111", categoriaId: cat, bloco: "A" } });
    expect(put.json()).toMatchObject({ numero: "111", bloco: "A" });
    expect((await app.inject({ method: "POST", url: `/api/quartos/${q101}/desativar`, headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/quartos", headers: h })).json()).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: "/api/quartos?incluirInativos=1", headers: h })).json()).toHaveLength(2);
    expect((await app.inject({ method: "POST", url: `/api/quartos/${q101}/reativar`, headers: h })).statusCode).toBe(200);
    const lote = await app.inject({ method: "POST", url: "/api/quartos/lote", headers: h, payload: { categoriaId: cat, de: 301, ate: 303 } });
    expect(lote.statusCode).toBe(201);
    expect(lote.json()).toHaveLength(3);
    const dup = await app.inject({ method: "POST", url: "/api/quartos/lote", headers: h, payload: { categoriaId: cat, de: 302, ate: 304 } });
    expect(dup.statusCode).toBe(422);
    expect(dup.json().detalhes.numeros).toEqual(["302", "303"]);
    const cp = await app.inject({ method: "PUT", url: `/api/categorias/${cat}`, headers: h, payload: { nome: "Novo", maxAdultos: 2, maxCriancas: 0 } });
    expect(cp.json().nome).toBe("Novo");
    expect((await app.inject({ method: "POST", url: `/api/categorias/${cat}/desativar`, headers: h })).json().codigo).toBe("CATEGORIA_COM_QUARTOS");
  });
});
