import { beforeEach, describe, expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { obterModelos } from "../../src/governanca/modelos.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { CONFIG_PADRAO, obterConfig, salvarConfig } from "../../src/nucleo/pousada.js";
import { criarProduto } from "../../src/nucleo/produtos.js";
import { criarQuarto, mudarSituacaoQuarto, obterQuarto } from "../../src/nucleo/quartos.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;

beforeEach(async () => {
  ctx = await criarContextoTeste();
});

describe("modelos de checklist", () => {
  test("modelos padrão da spec", async () => {
    const m = await obterModelos(ctx);
    expect(m.saida.map((i) => i.etapa)).toEqual([
      ...Array(6).fill("limpeza"), ...Array(4).fill("enxoval"), ...Array(4).fill("equipamento"), ...Array(2).fill("controles"),
    ]);
    expect(m.saida[0].texto).toBe("Banheiro limpo");
    expect(m.saida.filter((i) => i.etapa === "equipamento").map((i) => i.texto)).toEqual(["TV", "Rádio", "Ar-condicionado", "Água quente"]);
    expect(m.diaria.map((i) => i.etapa)).toEqual([
      ...Array(4).fill("limpeza"), ...Array(4).fill("enxoval"), ...Array(2).fill("controles"),
    ]);
    expect(m.diaria.some((i) => i.etapa === "equipamento")).toBe(false);
    expect(m.diaria[3].texto).toBe("Amenidades repostas");
    expect(m.camareiraLancaFrigobar).toBe(false);
  });

  test("item desativado não aparece", async () => {
    const antes = await obterModelos(ctx);
    await ctx.db.updateTable("checklist_itens").set({ ativo: 0 }).where("id", "=", antes.saida[0].id).execute();
    const depois = await obterModelos(ctx);
    expect(depois.saida).toHaveLength(antes.saida.length - 1);
    expect(depois.saida.some((i) => i.id === antes.saida[0].id)).toBe(false);
    expect(depois.diaria).toHaveLength(antes.diaria.length);
  });

  test("produtos de frigobar = produtos com setor frigobar", async () => {
    const base = { unidade: "un", grupo: "bebidas", tipo: "produto" as const, precoCentavos: 500 };
    await criarProduto(ctx, { ...base, codigo: "AGUA", nome: "Agua", setores: ["frigobar", "bar"] }, "u1");
    await criarProduto(ctx, { ...base, codigo: "CERV", nome: "Cerveja", setores: ["bar"] }, "u1");
    await criarProduto(ctx, { ...base, codigo: "SUCO", nome: "Suco", setores: ["frigobar"] }, "u1");
    const m = await obterModelos(ctx);
    expect(m.produtosFrigobar.map((p) => p.codigo)).toEqual(["AGUA", "SUCO"]);
  });

  test("opção camareiraLancaFrigobar é persistida", async () => {
    await salvarConfig(ctx, { camareiraLancaFrigobar: true }, "u1");
    expect((await obterConfig(ctx)).camareiraLancaFrigobar).toBe(true);
    expect((await obterModelos(ctx)).camareiraLancaFrigobar).toBe(true);
  });

  test("configuração antiga, sem camareiraLancaFrigobar, carrega como falso", async () => {
    const legado = { ...CONFIG_PADRAO } as Partial<typeof CONFIG_PADRAO>;
    delete legado.camareiraLancaFrigobar;
    await ctx.db.insertInto("config_pousada").values({ id: 1, dados: JSON.stringify(legado) }).onConflict((oc) => oc.column("id").doUpdateSet({ dados: JSON.stringify(legado) })).execute();
    expect(JSON.parse((await ctx.db.selectFrom("config_pousada").select("dados").executeTakeFirstOrThrow()).dados)).not.toHaveProperty("camareiraLancaFrigobar");
    expect((await obterConfig(ctx)).camareiraLancaFrigobar).toBe(false);
  });

  test("sujo → bloqueado é permitido", async () => {
    const cat = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 2, maxCriancas: 0, comodidades: [] }, "u1")).id;
    const q = await criarQuarto(ctx, { numero: "1", categoriaId: cat }, "u1");
    await ctx.db.updateTable("quartos").set({ situacao: "sujo" }).where("id", "=", q.id).execute();
    await mudarSituacaoQuarto(ctx, q.id, "bloqueado", "u1", "Vazamento");
    expect((await obterQuarto(ctx, q.id)).situacao).toBe("bloqueado");
  });

  test("GET /api/checklists/modelos: governança 200, sem sessão 401", async () => {
    const app = criarApp(ctx);
    const h = await entrarComo(ctx, "governanca");
    const ok = await app.inject({ method: "GET", url: "/api/checklists/modelos", headers: h });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().saida).toHaveLength(16);
    expect(ok.json().diaria).toHaveLength(10);
    expect(ok.json().camareiraLancaFrigobar).toBe(false);
    const sem = await app.inject({ method: "GET", url: "/api/checklists/modelos" });
    expect(sem.statusCode).toBe(401);
  });

  test("PUT /api/config aceita camareiraLancaFrigobar só para quem tem config.gerenciar", async () => {
    const app = criarApp(ctx);
    const gov = await entrarComo(ctx, "governanca");
    const negado = await app.inject({ method: "PUT", url: "/api/config", headers: gov, payload: { camareiraLancaFrigobar: true } });
    expect(negado.statusCode).toBe(403);
    const admin = await entrarComo(ctx, "admin");
    const ruim = await app.inject({ method: "PUT", url: "/api/config", headers: admin, payload: { camareiraLancaFrigobar: "sim" } });
    expect(ruim.statusCode).toBe(400);
    const ok = await app.inject({ method: "PUT", url: "/api/config", headers: admin, payload: { camareiraLancaFrigobar: true } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().camareiraLancaFrigobar).toBe(true);
    const m = await app.inject({ method: "GET", url: "/api/checklists/modelos", headers: gov });
    expect(m.json().camareiraLancaFrigobar).toBe(true);
  });
  test("nomeEstabelecimento: padrão vazio, round-trip pelo PUT/GET e qualquer sessão lê", async () => {
    const app = criarApp(ctx);
    const gov = await entrarComo(ctx, "governanca");
    const antes = await app.inject({ method: "GET", url: "/api/config", headers: gov });
    expect(antes.json().nomeEstabelecimento).toBe("");
    const admin = await entrarComo(ctx, "admin");
    const ruim = await app.inject({ method: "PUT", url: "/api/config", headers: admin, payload: { nomeEstabelecimento: 3 } });
    expect(ruim.statusCode).toBe(400);
    const negado = await app.inject({ method: "PUT", url: "/api/config", headers: gov, payload: { nomeEstabelecimento: "X" } });
    expect(negado.statusCode).toBe(403);
    const ok = await app.inject({ method: "PUT", url: "/api/config", headers: admin, payload: { nomeEstabelecimento: "Pousada Vista Alegre" } });
    expect(ok.statusCode).toBe(200);
    const depois = await app.inject({ method: "GET", url: "/api/config", headers: gov });
    expect(depois.json().nomeEstabelecimento).toBe("Pousada Vista Alegre");
  });
});
