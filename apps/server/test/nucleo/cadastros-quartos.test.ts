import { describe, expect, test } from "vitest";
import { criarContextoTeste } from "../ajuda.js";
import { criarCategoria, definirCategoriaAtiva, listarCategorias } from "../../src/nucleo/categorias.js";
import { obterConfig, salvarConfig } from "../../src/nucleo/pousada.js";
import { criarProduto, definirProdutoAtivo, listarProdutos } from "../../src/nucleo/produtos.js";
import { criarQuarto, criarQuartosEmLote, definirQuartoAtivo, editarQuarto, listarQuartos, mudarSituacaoQuarto, obterQuarto } from "../../src/nucleo/quartos.js";
import { emTransacao } from "../../src/shared/contexto.js";
import { ErroDominio } from "../../src/shared/erros.js";

async function cenario() {
  const ctx = await criarContextoTeste();
  const cat = await criarCategoria(ctx, { nome: "Standard", maxAdultos: 2, maxCriancas: 1, comodidades: ["wifi"] }, "u1");
  const q = await criarQuarto(ctx, { numero: "12", categoriaId: cat.id }, "u1");
  return { ctx, cat, q };
}
const mudar = (ctx: any, id: string, nova: any) => emTransacao(ctx, (tx) => mudarSituacaoQuarto(tx, id, nova, "u1"));

describe("pousada, categorias e quartos", () => {
  test("config tem padrões da spec", async () => {
    const c = await obterConfig(await criarContextoTeste());
    expect(c).toMatchObject({
      fuso: "America/Sao_Paulo", horaCheckin: "14:00", horaCheckout: "12:00", viradaDia: "04:00",
      arredondamento: "nenhum", idadeAdulto: 12, limiteCriancasGratis: 1,
      sinal: { exigir: true, tipo: "percentual", percentual: 30, prazoHoras: 48, toleranciaHoras: 12 },
      earlyCheckin: { tipo: "fixo", valor: 0 }, lateCheckout: { tipo: "fixo", valor: 0 },
    });
  });

  test("salvarConfig mescla parcial, persiste e audita", async () => {
    const ctx = await criarContextoTeste();
    await salvarConfig(ctx, { razaoSocial: "Pousada X", horaCheckin: "15:00" }, "u1");
    await salvarConfig(ctx, { viradaDia: "05:00" }, "u1");
    expect(await obterConfig(ctx)).toMatchObject({ razaoSocial: "Pousada X", horaCheckin: "15:00", viradaDia: "05:00", horaCheckout: "12:00" });
    const a = await ctx.db.selectFrom("auditoria").selectAll().where("acao", "=", "pousada.config").execute();
    expect(a).toHaveLength(2);
  });

  test("categorias são criadas e listadas", async () => {
    const { ctx, cat } = await cenario();
    expect(cat).toMatchObject({ nome: "Standard", maxAdultos: 2, maxCriancas: 1, comodidades: ["wifi"] });
    expect(await listarCategorias(ctx)).toEqual([cat]);
    const ev = await ctx.db.selectFrom("outbox").select("tipo").execute();
    expect(ev.map((e) => e.tipo)).toContain("nucleo.CategoriaCriada");
  });

  test("listas de categorias, quartos e produtos trazem o campo ativo", async () => {
    const { ctx, cat, q } = await cenario();
    const cat2 = await criarCategoria(ctx, { nome: "Luxo", maxAdultos: 2, maxCriancas: 0, comodidades: [] }, "u1");
    await definirCategoriaAtiva(ctx, cat2.id, false, "u1");
    await definirQuartoAtivo(ctx, q.id, false, "u1");
    const p = await criarProduto(ctx, { codigo: "AGUA", nome: "Água", precoCentavos: 500, unidade: "un", grupo: "bebidas", tipo: "produto" }, "u1");
    expect(p.ativo).toBe(true);
    await definirProdutoAtivo(ctx, p.id, false, "u1");
    expect((await listarCategorias(ctx)).map((c) => [c.id, c.ativo])).toEqual([[cat.id, true]]);
    expect((await listarCategorias(ctx, { incluirInativos: true })).map((c) => [c.nome, c.ativo])).toEqual([["Luxo", false], ["Standard", true]]);
    expect(await listarQuartos(ctx)).toEqual([]);
    expect((await listarQuartos(ctx, { incluirInativos: true })).map((x) => x.ativo)).toEqual([false]);
    expect((await listarProdutos(ctx, undefined, { incluirInativos: true })).find((x) => x.id === p.id)?.ativo).toBe(false);
    expect((await listarProdutos(ctx)).find((x) => x.id === p.id)).toBeUndefined();
  });

  test("número de quarto duplicado é rejeitado", async () => {
    const { ctx, cat } = await cenario();
    const erro = await criarQuarto(ctx, { numero: "12", categoriaId: cat.id }, "u1").catch((e) => e);
    expect(erro).toBeInstanceOf(ErroDominio);
    expect(erro.codigo).toBe("NUMERO_QUARTO_DUPLICADO");
  });

  test("quarto novo começa livre; lista filtra por categoria", async () => {
    const { ctx, cat, q } = await cenario();
    expect(q).toMatchObject({ numero: "12", categoriaId: cat.id, situacao: "livre" });
    const outra = await criarCategoria(ctx, { nome: "Luxo", maxAdultos: 3, maxCriancas: 2, comodidades: [] }, "u1");
    await criarQuarto(ctx, { numero: "20", categoriaId: outra.id, bloco: "B" }, "u1");
    expect(await listarQuartos(ctx)).toHaveLength(2);
    expect((await listarQuartos(ctx, { categoriaId: outra.id })).map((x) => x.numero)).toEqual(["20"]);
    expect(await obterQuarto(ctx, q.id)).toEqual(q);
  });

  test("categoria inexistente é rejeitada", async () => {
    const ctx = await criarContextoTeste();
    const erro = await criarQuarto(ctx, { numero: "1", categoriaId: "nao-existe" }, "u1").catch((e) => e);
    expect(erro.codigo).toBe("CATEGORIA_NAO_ENCONTRADA");
  });

  test("quarto ocupado não pode ir direto para livre", async () => {
    const { ctx, q } = await cenario();
    await mudar(ctx, q.id, "ocupado");
    const erro = await mudar(ctx, q.id, "livre").catch((e) => e);
    expect(erro).toBeInstanceOf(ErroDominio);
    expect(erro.codigo).toBe("TRANSICAO_QUARTO_INVALIDA");
    await mudar(ctx, q.id, "sujo");
    await mudar(ctx, q.id, "livre");
    expect((await obterQuarto(ctx, q.id)).situacao).toBe("livre");
  });

  test("mudança de situação emite evento e auditoria", async () => {
    const { ctx, q } = await cenario();
    await emTransacao(ctx, (tx) => mudarSituacaoQuarto(tx, q.id, "bloqueado", "u1", "reforma"));
    const ev = await ctx.db.selectFrom("outbox").selectAll().where("tipo", "=", "nucleo.SituacaoQuartoAlterada").execute();
    expect(ev).toHaveLength(1);
    expect(JSON.parse(ev[0]!.payload)).toMatchObject({ quartoId: q.id, de: "livre", para: "bloqueado" });
    const a = await ctx.db.selectFrom("auditoria").selectAll().where("acao", "=", "quarto.situacao").execute();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ alvo_id: q.id, motivo: "reforma", ator: "u1" });
  });

  test("transições da spec", async () => {
    const { ctx, q } = await cenario();
    for (const n of ["em_manutencao", "sujo", "em_manutencao", "livre", "bloqueado", "livre"] as const) await mudar(ctx, q.id, n);
    const erro = await mudar(ctx, q.id, "sujo").catch((e) => e);
    expect(erro.codigo).toBe("TRANSICAO_QUARTO_INVALIDA");
  });
});

describe("bloco do quarto", () => {
  test("é aparado; vazio vira ausente; passa de 40 caracteres → BLOCO_INVALIDO", async () => {
    const { ctx, cat } = await cenario();
    expect((await criarQuarto(ctx, { numero: "20", categoriaId: cat.id, bloco: "  A  " }, "u1")).bloco).toBe("A");
    expect((await criarQuarto(ctx, { numero: "21", categoriaId: cat.id, bloco: "   " }, "u1")).bloco).toBeNull();
    const longo = "x".repeat(41);
    const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroDominio) => e.codigo);
    expect(await falha(criarQuarto(ctx, { numero: "22", categoriaId: cat.id, bloco: longo }, "u1"))).toBe("BLOCO_INVALIDO");
    expect(await falha(criarQuartosEmLote(ctx, { categoriaId: cat.id, de: 30, ate: 31, bloco: longo }, "u1"))).toBe("BLOCO_INVALIDO");
    const q = await criarQuarto(ctx, { numero: "23", categoriaId: cat.id }, "u1");
    expect(await falha(editarQuarto(ctx, q.id, { numero: "23", categoriaId: cat.id, bloco: longo }, "u1"))).toBe("BLOCO_INVALIDO");
    expect((await editarQuarto(ctx, q.id, { numero: "23", categoriaId: cat.id, bloco: " B " }, "u1")).bloco).toBe("B");
    const lote = await criarQuartosEmLote(ctx, { categoriaId: cat.id, de: 40, ate: 41, bloco: " C " }, "u1");
    expect(lote.map((x) => x.bloco)).toEqual(["C", "C"]);
  });
});
