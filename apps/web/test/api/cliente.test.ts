import { afterEach, describe, expect, test, vi } from "vitest";
import { chamarApi, definirToken, ErroApi } from "../../src/api/cliente";
import { chamadas, instalarApiFalsa, rotasNaoPrevistas, verificarRotasNaoPrevistas } from "../api-falsa";

afterEach(() => {
  vi.unstubAllGlobals();
  definirToken(null);
});

describe("cliente da API", () => {
  test("erro da API vira ErroApi com mensagem do servidor", async () => {
    instalarApiFalsa({ "POST /api/reservas": { __status: 422, codigo: "QUARTO_INDISPONIVEL", mensagem: "O quarto 12 já está reservado." } });
    const p = chamarApi("POST", "/api/reservas", {});
    await expect(p).rejects.toBeInstanceOf(ErroApi);
    await expect(p).rejects.toMatchObject({ status: 422, codigo: "QUARTO_INDISPONIVEL", message: "O quarto 12 já está reservado." });
  });
  test("falha de rede vira SEM_CONEXAO", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(chamarApi("GET", "/api/painel")).rejects.toMatchObject({
      status: 0,
      codigo: "SEM_CONEXAO",
      message: "Sem conexão com o servidor da pousada.",
    });
  });
  test("401 dispara erp:sessao-expirada", async () => {
    instalarApiFalsa({ "GET /api/painel": { __status: 401, codigo: "NAO_AUTENTICADO", mensagem: "Sessão expirada." } });
    const ouvinte = vi.fn();
    window.addEventListener("erp:sessao-expirada", ouvinte);
    await expect(chamarApi("GET", "/api/painel")).rejects.toMatchObject({ status: 401 });
    window.removeEventListener("erp:sessao-expirada", ouvinte);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });
  test("envia Bearer do localStorage", async () => {
    localStorage.setItem("erp.token", "abc123");
    let cabecalho: string | null = null;
    instalarApiFalsa({ "GET /api/painel": () => ({ ok: true }) });
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      cabecalho = new Headers(init.headers).get("authorization");
      return original(url, init);
    });
    await expect(chamarApi("GET", "/api/painel")).resolves.toEqual({ ok: true });
    expect(cabecalho).toBe("Bearer abc123");
  });
  test("definirToken grava e remove; corpo JSON e chamadas registradas", async () => {
    instalarApiFalsa({ "POST /api/x": (corpo: { a: number }) => ({ eco: corpo.a }) });
    definirToken("t1");
    expect(localStorage.getItem("erp.token")).toBe("t1");
    await expect(chamarApi("POST", "/api/x?q=1", { a: 7 })).resolves.toEqual({ eco: 7 });
    expect(chamadas.at(-1)).toMatchObject({ metodo: "POST", caminho: "/api/x?q=1", corpo: { a: 7 } });
    definirToken(null);
    expect(localStorage.getItem("erp.token")).toBeNull();
  });
  test("rota não prevista na API falsa dá erro claro e reprova a verificação", async () => {
    instalarApiFalsa({});
    await expect(chamarApi("GET", "/api/nada")).rejects.toMatchObject({ codigo: "API_FALSA_ROTA_NAO_PREVISTA", message: expect.stringContaining("GET /api/nada") });
    expect(rotasNaoPrevistas).toEqual(["GET /api/nada"]);
    expect(() => verificarRotasNaoPrevistas()).toThrow("GET /api/nada");
    expect(rotasNaoPrevistas).toHaveLength(0);
    expect(() => verificarRotasNaoPrevistas()).not.toThrow();
  });
  test("2xx com corpo não JSON vira RESPOSTA_INVALIDA", async () => {
    vi.stubGlobal("fetch", async () => new Response("<!doctype html><html></html>", { status: 200 }));
    await expect(chamarApi("GET", "/api/painel")).rejects.toMatchObject({ status: 200, codigo: "RESPOSTA_INVALIDA", message: "Resposta inesperada do servidor." });
  });
  test("corpo vazio (204) devolve undefined", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    await expect(chamarApi("DELETE", "/api/x")).resolves.toBeUndefined();
  });
  test("falha ao ler o corpo vira SEM_CONEXAO", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, text: async () => { throw new TypeError("terminated"); } }));
    await expect(chamarApi("GET", "/api/x")).rejects.toMatchObject({ status: 0, codigo: "SEM_CONEXAO" });
  });
});
