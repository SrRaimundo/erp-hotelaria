import { vi } from "vitest";

type Rota = unknown | ((corpo: any, url: URL) => unknown);
export type ChamadaFalsa = { metodo: string; caminho: string; corpo: unknown };

/** Chamadas feitas desde a última `instalarApiFalsa` (mesmo array, reaproveitado). */
export const chamadas: ChamadaFalsa[] = [];

/** Rotas chamadas sem estarem previstas; o afterEach de setup.ts reprova o teste se houver alguma. */
export const rotasNaoPrevistas: string[] = [];

export function verificarRotasNaoPrevistas(): void {
  if (rotasNaoPrevistas.length === 0) return;
  const lista = rotasNaoPrevistas.join(", ");
  rotasNaoPrevistas.length = 0;
  throw new Error(`API falsa: rota(s) não prevista(s) no teste: ${lista}`);
}

export function instalarApiFalsa(rotas: Record<string, Rota>): void {
  chamadas.length = 0;
  rotasNaoPrevistas.length = 0;
  vi.stubGlobal("fetch", async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const metodo = (init?.method ?? "GET").toUpperCase();
    const url = new URL(String(entrada), "http://localhost");
    const caminho = url.pathname + url.search;
    const corpo = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    chamadas.push({ metodo, caminho, corpo });
    const chave = `${metodo} ${url.pathname}`;
    if (!(chave in rotas)) {
      // Não lança: o cliente transformaria a exceção em SEM_CONEXAO e esconderia o motivo.
      rotasNaoPrevistas.push(`${metodo} ${caminho}`);
      const mensagem = `API falsa: rota não prevista no teste: ${metodo} ${caminho}`;
      return new Response(JSON.stringify({ codigo: "API_FALSA_ROTA_NAO_PREVISTA", mensagem }), { status: 599 });
    }
    const definicao = rotas[chave];
    const valor = typeof definicao === "function" ? (definicao as (c: unknown, u: URL) => unknown)(corpo, url) : definicao;
    const status = typeof valor === "object" && valor !== null && "__status" in valor ? Number((valor as { __status: number }).__status) : 200;
    let envio = valor;
    if (status !== 200 && typeof valor === "object" && valor !== null) {
      const { __status: _, ...resto } = valor as Record<string, unknown>;
      envio = resto;
    }
    return new Response(envio === undefined ? null : JSON.stringify(envio), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
}
