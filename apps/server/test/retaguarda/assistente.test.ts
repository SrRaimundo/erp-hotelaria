import { beforeEach, describe, expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { configurarQuartos, estadoAssistente, pularEquipe } from "../../src/retaguarda/assistente.js";
import { salvarConfig } from "../../src/nucleo/pousada.js";
import { criarUsuario } from "../../src/nucleo/usuarios.js";
import { ErroDominio } from "../../src/shared/erros.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;

const erro = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroDominio) return e;
    throw e;
  }
  throw new Error("esperava ErroDominio");
};
const cat = (nome: string, de: number, ate: number, extra = {}) => ({
  nome, maxAdultos: 3, maxCriancas: 1, porAdultos: { 1: 15000, 2: 20000, 3: 25000 } as Record<1 | 2 | 3, number>, adultoExtra: 5000, de, ate, ...extra,
});
const nQuartos = async () => (await ctx.db.selectFrom("quartos").select("id").execute()).length;
const nCategorias = async () => (await ctx.db.selectFrom("categorias").select("id").execute()).length;
const nTabelas = async () => (await ctx.db.selectFrom("tabelas_base").select("categoria_id").execute()).length;

beforeEach(async () => {
  ctx = await criarContextoTeste();
});

describe("assistente", () => {
  test("base vazia: nenhum passo concluído", async () => {
    expect(await estadoAssistente(ctx)).toMatchObject({ pousada: false, quartos: false, equipe: false });
    await salvarConfig(ctx, { razaoSocial: "Pousada X" }, "usuario-admin");
    expect((await estadoAssistente(ctx)).pousada).toBe(true);
  });

  test("configurar quartos cria categorias, tabela base e quartos atomicamente", async () => {
    const antesCat = await nCategorias();
    const antesTab = await nTabelas();
    const e = await configurarQuartos(ctx, { categorias: [cat("Standard", 101, 103, { bloco: "A" }), cat("Luxo", 201, 202)] }, "usuario-admin");
    expect(e.quartos).toBe(true);
    const std = e.categorias.find((c) => c.nome === "Standard")!;
    expect(std.quartos).toEqual(["101", "102", "103"]);
    expect(e.categorias.find((c) => c.nome === "Luxo")!.quartos).toEqual(["201", "202"]);
    expect(await nCategorias()).toBe(antesCat + 2);
    expect(await nTabelas()).toBe(antesTab + 2);
    const tb = await ctx.db.selectFrom("tabelas_base").selectAll().where("categoria_id", "=", std.id).executeTakeFirstOrThrow();
    expect(JSON.parse(tb.por_adultos)).toEqual({ 1: 15000, 2: 20000, 3: 25000 });
    expect(tb.adulto_extra).toBe(5000);
    expect((await ctx.db.selectFrom("quartos").select("bloco").where("numero", "=", "101").executeTakeFirstOrThrow()).bloco).toBe("A");
    expect(await ctx.db.selectFrom("auditoria").select("id").where("acao", "=", "assistente.quartos").execute()).toHaveLength(1);
  });

  test("falha no meio (quarto existente na 2a faixa) desfaz categorias e tabelas da 1a", async () => {
    await configurarQuartos(ctx, { categorias: [cat("Base", 301, 301)] }, "usuario-admin");
    const antesCat = await nCategorias();
    const antesTab = await nTabelas();
    const antesQ = await nQuartos();
    const e = await erro(configurarQuartos(ctx, { categorias: [cat("Nova", 401, 402), cat("Outra", 300, 302)] }, "usuario-admin"));
    expect(e.codigo).toBe("NUMERO_QUARTO_DUPLICADO");
    expect((e.detalhes as { numeros: string[] }).numeros).toEqual(["301"]);
    expect(await nCategorias()).toBe(antesCat);
    expect(await nTabelas()).toBe(antesTab);
    expect(await nQuartos()).toBe(antesQ);
  });

  test("Review Focus 2: faixas sobrepostas entre categorias → NUMERO_QUARTO_DUPLICADO e nada gravado", async () => {
    const antesCat = await nCategorias();
    const antesQ = await nQuartos();
    const e = await erro(configurarQuartos(ctx, { categorias: [cat("A", 101, 105), cat("B", 104, 108)] }, "usuario-admin"));
    expect(e.codigo).toBe("NUMERO_QUARTO_DUPLICADO");
    expect((e.detalhes as { numeros: string[] }).numeros).toEqual(["104", "105"]);
    expect(await nCategorias()).toBe(antesCat);
    expect(await nQuartos()).toBe(antesQ);
  });

  test("Review Focus 5: estado após quartos mostra as categorias existentes; nova chamada com a mesma categoria → CATEGORIA_DUPLICADA", async () => {
    await configurarQuartos(ctx, { categorias: [cat("Standard", 101, 102)] }, "usuario-admin");
    const e = await estadoAssistente(ctx);
    expect(e.categorias.map((c) => ({ nome: c.nome, quartos: c.quartos }))).toContainEqual({ nome: "Standard", quartos: ["101", "102"] });
    const antesQ = await nQuartos();
    expect((await erro(configurarQuartos(ctx, { categorias: [cat("  standárd ", 110, 111)] }, "usuario-admin"))).codigo).toBe("CATEGORIA_DUPLICADA");
    expect((await erro(configurarQuartos(ctx, { categorias: [cat("Nova", 120, 121), cat("NOVA", 130, 131)] }, "usuario-admin"))).codigo).toBe("CATEGORIA_DUPLICADA");
    expect(await nQuartos()).toBe(antesQ);
  });

  test("categoria desativada também conta como nome existente", async () => {
    await configurarQuartos(ctx, { categorias: [cat("Standard", 101, 101)] }, "usuario-admin");
    await ctx.db.updateTable("categorias").set({ ativo: 0 }).where("nome", "=", "Standard").execute();
    expect((await erro(configurarQuartos(ctx, { categorias: [cat("Standard", 110, 111)] }, "usuario-admin"))).codigo).toBe("CATEGORIA_DUPLICADA");
  });

  test("pular equipe marca o passo (auditado); usuário ativo novo também conclui", async () => {
    expect((await estadoAssistente(ctx)).equipe).toBe(false);
    expect((await pularEquipe(ctx, "usuario-admin")).equipe).toBe(true);
    expect(await ctx.db.selectFrom("auditoria").select("id").where("acao", "=", "pousada.config").execute()).toHaveLength(1);
    await ctx.db.updateTable("config_pousada").set({ dados: "{}" }).execute();
    expect((await estadoAssistente(ctx)).equipe).toBe(false);
    const ana = await criarUsuario(ctx, { nome: "Ana", login: "ana", senha: "senha-ana", perfil: "recepcao" }, "usuario-admin");
    expect((await estadoAssistente(ctx)).equipe).toBe(true);
    await ctx.db.updateTable("usuarios").set({ ativo: 0 }).where("id", "=", ana.id).execute();
    expect((await estadoAssistente(ctx)).equipe).toBe(false);
  });
});

describe("rotas do assistente", () => {
  test("exigem config.gerenciar e validam o corpo", async () => {
    const app = criarApp(ctx);
    const adm = await entrarComo(ctx, "admin");
    const rec = await entrarComo(ctx, "recepcao");
    for (const [method, url] of [["GET", "/api/assistente"], ["POST", "/api/assistente/quartos"], ["POST", "/api/assistente/pular-equipe"]] as const) {
      expect((await app.inject({ method, url, headers: rec, payload: method === "POST" ? { categorias: [] } : undefined })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "GET", url: "/api/assistente", headers: adm })).statusCode).toBe(200);
    const ruim = await app.inject({ method: "POST", url: "/api/assistente/quartos", headers: adm, payload: { categorias: [cat("X", 5, 3)] } });
    expect(ruim.statusCode).toBe(400);
    const preco = await app.inject({ method: "POST", url: "/api/assistente/quartos", headers: adm, payload: { categorias: [{ ...cat("X", 1, 3), adultoExtra: -1 }] } });
    expect(preco.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/api/assistente/quartos", headers: adm, payload: { categorias: [cat("X", 1, 3)] } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().quartos).toBe(true);
    const dup = await app.inject({ method: "POST", url: "/api/assistente/quartos", headers: adm, payload: { categorias: [cat("x", 10, 12)] } });
    expect(dup.statusCode).toBe(422);
    expect(JSON.stringify(dup.json())).toContain("CATEGORIA_DUPLICADA");
    expect((await app.inject({ method: "POST", url: "/api/assistente/pular-equipe", headers: adm })).json().equipe).toBe(true);
  });
});
