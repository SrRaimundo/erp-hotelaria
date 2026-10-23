import { describe, expect, test } from "vitest";
import { criarContextoTeste, entrarComo } from "../ajuda.js";
import { criarApp } from "../../src/http/app.js";

async function cenario() {
  const ctx = await criarContextoTeste();
  const app = criarApp(ctx);
  const admin = await entrarComo(ctx, "admin");
  return { ctx, app, admin };
}

describe("API HTTP base", () => {
  test("login e logout pela API", async () => {
    const { app } = await cenario();
    const ruim = await app.inject({ method: "POST", url: "/api/sessoes", payload: { login: "admin", senha: "x" } });
    expect(ruim.statusCode).toBe(422);
    expect(ruim.json().codigo).toBe("CREDENCIAIS_INVALIDAS");
    const ok = await app.inject({ method: "POST", url: "/api/sessoes", payload: { login: "admin", senha: "admin" } });
    expect(ok.statusCode).toBe(201);
    const { token, usuario } = ok.json();
    expect(usuario.trocarSenha).toBe(true);
    const h = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: "GET", url: "/api/config", headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/api/sessoes", headers: h })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/config", headers: h })).statusCode).toBe(401);
  });

  test("governança não cria quarto (403)", async () => {
    const { ctx, app } = await cenario();
    const h = await entrarComo(ctx, "governanca");
    const r = await app.inject({ method: "POST", url: "/api/quartos", headers: h, payload: { numero: "1", categoriaId: "x" } });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe("SEM_PERMISSAO");
  });

  test("sem token → 401; erro de domínio → 422 com codigo", async () => {
    const { app, admin } = await cenario();
    expect((await app.inject({ method: "GET", url: "/api/quartos" })).statusCode).toBe(401);
    const cat = (await app.inject({ method: "POST", url: "/api/categorias", headers: admin, payload: { nome: "Std", maxAdultos: 2, maxCriancas: 1 } })).json();
    const corpo = { numero: "12", categoriaId: cat.id };
    expect((await app.inject({ method: "POST", url: "/api/quartos", headers: admin, payload: corpo })).statusCode).toBe(201);
    const dup = await app.inject({ method: "POST", url: "/api/quartos", headers: admin, payload: corpo });
    expect(dup.statusCode).toBe(422);
    expect(dup.json()).toMatchObject({ codigo: "NUMERO_QUARTO_DUPLICADO" });
    const lista = await app.inject({ method: "GET", url: "/api/quartos", headers: admin });
    expect(lista.json()).toHaveLength(1);
  });

  test("corpo inválido → 400 DADOS_INVALIDOS", async () => {
    const { app, admin } = await cenario();
    const r = await app.inject({ method: "POST", url: "/api/quartos", headers: admin, payload: { categoriaId: "x" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().codigo).toBe("DADOS_INVALIDOS");
    expect(r.json().campos[0].campo).toBe("numero");
  });

  test("config valida horas e valores; recepção não altera", async () => {
    const { ctx, app, admin } = await cenario();
    const put = (payload: object, headers = admin) => app.inject({ method: "PUT", url: "/api/config", headers, payload });
    expect((await put({ horaCheckin: "25:00" })).statusCode).toBe(400);
    expect((await put({ sinal: { percentual: -1 } })).statusCode).toBe(400);
    const frac = await put({ earlyCheckin: { tipo: "fixo", valor: 10.5 } });
    expect(frac.statusCode).toBe(400);
    expect(frac.json().codigo).toBe("DADOS_INVALIDOS");
    const ok = await put({ horaCheckin: "15:00", sinal: { percentual: 50 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ horaCheckin: "15:00", sinal: { percentual: 50, prazoHoras: 48 } });
    expect((await put({ horaCheckin: "16:00" }, await entrarComo(ctx, "recepcao"))).statusCode).toBe(403);
  });

  test("produtos, hóspedes, formas de pagamento e usuários", async () => {
    const { ctx, app, admin } = await cenario();
    const rec = await entrarComo(ctx, "recepcao");
    const prodRuim = await app.inject({ method: "POST", url: "/api/produtos", headers: admin, payload: { codigo: "A", nome: "A", precoCentavos: 10.5, unidade: "un", grupo: "g", tipo: "produto" } });
    expect(prodRuim.statusCode).toBe(400);
    const prod = await app.inject({ method: "POST", url: "/api/produtos", headers: admin, payload: { codigo: "AGUA", nome: "Água", precoCentavos: 500, unidade: "un", grupo: "bebidas", tipo: "produto" } });
    expect(prod.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/produtos", headers: rec, payload: prod.json() })).statusCode).toBe(403);
    const lista = (await app.inject({ method: "GET", url: "/api/produtos", headers: rec })).json();
    expect(lista.map((p: any) => p.codigo)).toContain("AGUA");

    const base = { nome: "Maria Souza", documentoTipo: "cpf", documento: "529.982.247-25", nacionalidade: "Brasil" };
    expect((await app.inject({ method: "POST", url: "/api/hospedes", headers: rec, payload: { ...base, nascimento: "01/02/1990" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/hospedes", headers: rec, payload: { ...base, documentoTipo: "rg", nascimento: null } })).statusCode).toBe(400);
    const h = await app.inject({ method: "POST", url: "/api/hospedes", headers: rec, payload: { ...base, nascimento: "1990-02-01" } });
    expect(h.statusCode).toBe(201);
    const busca = await app.inject({ method: "GET", url: "/api/hospedes?q=maria", headers: rec });
    expect(busca.json()).toHaveLength(1);

    const formas = (await app.inject({ method: "GET", url: "/api/formas-pagamento", headers: rec })).json();
    expect(formas.map((f: any) => f.codigo)).toEqual(["dinheiro", "pix", "debito", "credito", "faturado"]);

    const novo = { nome: "Ana", login: "ana", senha: "s", perfil: "recepcao" };
    expect((await app.inject({ method: "POST", url: "/api/usuarios", headers: rec, payload: novo })).statusCode).toBe(403);
    const u = await app.inject({ method: "POST", url: "/api/usuarios", headers: admin, payload: novo });
    expect(u.statusCode).toBe(201);
    expect(u.json()).not.toHaveProperty("senha");
    expect((await app.inject({ method: "POST", url: "/api/sessoes", payload: { login: "ana", senha: "s" } })).statusCode).toBe(201);
  });
});
