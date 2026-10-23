import type { ErroApiDados } from "./tipos";

export const CHAVE_TOKEN = "erp.token";
export const EVENTO_SESSAO_EXPIRADA = "erp:sessao-expirada";

export class ErroApi extends Error {
  status: number;
  codigo: string;
  detalhes?: unknown;
  constructor(status: number, codigo: string, mensagem: string, detalhes?: unknown) {
    super(mensagem);
    this.name = "ErroApi";
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export function definirToken(token: string | null): void {
  if (token === null) localStorage.removeItem(CHAVE_TOKEN);
  else localStorage.setItem(CHAVE_TOKEN, token);
}

export async function chamarApi<T>(metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", caminho: string, corpo?: unknown): Promise<T> {
  const cabecalhos: Record<string, string> = { Accept: "application/json" };
  const token = localStorage.getItem(CHAVE_TOKEN);
  if (token) cabecalhos["Authorization"] = `Bearer ${token}`;
  const init: RequestInit = { method: metodo, headers: cabecalhos };
  if (corpo !== undefined) {
    cabecalhos["Content-Type"] = "application/json";
    init.body = JSON.stringify(corpo);
  }

  let resposta: Response;
  try {
    resposta = await fetch(caminho, init);
  } catch {
    throw new ErroApi(0, "SEM_CONEXAO", "Sem conexão com o servidor da pousada.");
  }

  const texto = await resposta.text();
  let dados: unknown = undefined;
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      dados = undefined;
    }
  }

  if (!resposta.ok) {
    if (resposta.status === 401) window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    const e = (dados ?? {}) as Partial<ErroApiDados>;
    throw new ErroApi(
      resposta.status,
      e.codigo ?? "ERRO_DESCONHECIDO",
      e.mensagem ?? "Algo deu errado. Tente de novo.",
      e.detalhes,
    );
  }
  return dados as T;
}
