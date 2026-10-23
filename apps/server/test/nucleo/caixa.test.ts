import { beforeEach, describe, expect, test } from "vitest";
import { criarContextoTeste, entrarComo } from "../ajuda.js";
import { criarApp } from "../../src/http/app.js";
import { abrirCaixa, exigirCaixaAberto, fecharCaixa, registrarMovimento, turnoAberto } from "../../src/nucleo/caixa.js";
import { emTransacao } from "../../src/shared/contexto.js";

const u = "usuario-admin";
let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;

beforeEach(async () => {
  ctx = await criarContextoTeste();
});

describe("turnos de caixa", () => {
  test("fechamento mostra diferença por forma", async () => {
    await abrirCaixa(ctx, u, 10000);
    await emTransacao(ctx, async (tx) => {
      const t = await exigirCaixaAberto(tx, u);
      await registrarMovimento(tx, t.id, { formaCodigo: "dinheiro", valor: 5000, origemTipo: "teste", origemId: "1" });
      await registrarMovimento(tx, t.id, { formaCodigo: "pix", valor: 20000, origemTipo: "teste", origemId: "2" });
    });
    const r = await fecharCaixa(ctx, u, { dinheiro: 14000, pix: 20000 });
    expect(r.porForma).toEqual(
      expect.arrayContaining([
        { forma: "dinheiro", esperado: 15000, contado: 14000, diferenca: -1000 },
        { forma: "pix", esperado: 20000, contado: 20000, diferenca: 0 },
      ]),
    );
    expect(await turnoAberto(ctx, u)).toBeNull();
  });

  test("forma não contada vale 0 e forma só contada aparece", async () => {
    await abrirCaixa(ctx, u, 0);
    await emTransacao(ctx, async (tx) => {
      const t = await exigirCaixaAberto(tx, u);
      await registrarMovimento(tx, t.id, { formaCodigo: "pix", valor: 3000, origemTipo: "teste", origemId: "1" });
    });
    const r = await fecharCaixa(ctx, u, { credito: 500 });
    expect(r.porForma).toEqual(
      expect.arrayContaining([
        { forma: "dinheiro", esperado: 0, contado: 0, diferenca: 0 },
        { forma: "pix", esperado: 3000, contado: 0, diferenca: -3000 },
        { forma: "credito", esperado: 0, contado: 500, diferenca: 500 },
      ]),
    );
  });

  test("sem caixa aberto não registra", async () => {
    await expect(emTransacao(ctx, (tx) => exigirCaixaAberto(tx, u))).rejects.toMatchObject({ codigo: "CAIXA_FECHADO" });
  });

  test("fechar sem turno aberto → CAIXA_FECHADO", async () => {
    await expect(fecharCaixa(ctx, u, {})).rejects.toMatchObject({ codigo: "CAIXA_FECHADO" });
  });

  test("não abre dois turnos, mas reabre depois de fechar", async () => {
    await abrirCaixa(ctx, u, 100);
    await expect(abrirCaixa(ctx, u, 100)).rejects.toMatchObject({ codigo: "CAIXA_JA_ABERTO" });
    await fecharCaixa(ctx, u, { dinheiro: 100 });
    const t = await abrirCaixa(ctx, u, 200);
    expect(t.valorInicial).toBe(200);
  });

  test("abrir e fechar emitem eventos e auditam", async () => {
    const tipos: string[] = [];
    ctx.barramento.publicar = ((e: any) => tipos.push(e.tipo)) as any;
    await abrirCaixa(ctx, u, 0);
    await fecharCaixa(ctx, u, {});
    expect(tipos).toEqual(["nucleo.CaixaAberto", "nucleo.CaixaFechado"]);
    const acoes = (await ctx.db.selectFrom("auditoria").select("acao").execute()).map((a: any) => a.acao);
    expect(acoes).toEqual(expect.arrayContaining(["caixa.abrir", "caixa.fechar"]));
  });
});

describe("API de caixa", () => {
  test("governança 403; recepção abre e consulta o turno atual", async () => {
    const app = criarApp(ctx);
    const gov = await entrarComo(ctx, "governanca");
    const negado = await app.inject({ method: "POST", url: "/api/caixa/abrir", headers: gov, payload: { valorInicial: 0 } });
    expect(negado.statusCode).toBe(403);

    const rec = await entrarComo(ctx, "recepcao");
    expect((await app.inject({ method: "GET", url: "/api/caixa/atual", headers: rec })).json()).toBeNull();
    const abre = await app.inject({ method: "POST", url: "/api/caixa/abrir", headers: rec, payload: { valorInicial: 5000 } });
    expect(abre.statusCode).toBe(201);
    const atual = await app.inject({ method: "GET", url: "/api/caixa/atual", headers: rec });
    expect(atual.json()).toMatchObject({ valorInicial: 5000, fechadoEm: null });
    const invalido = await app.inject({ method: "POST", url: "/api/caixa/abrir", headers: rec, payload: { valorInicial: 10.5 } });
    expect(invalido.statusCode).toBe(400);
    const fecha = await app.inject({ method: "POST", url: "/api/caixa/fechar", headers: rec, payload: { contados: { dinheiro: 4000 } } });
    expect(fecha.statusCode).toBe(200);
    expect(fecha.json().porForma).toEqual([{ forma: "dinheiro", esperado: 5000, contado: 4000, diferenca: -1000 }]);
  });
});
