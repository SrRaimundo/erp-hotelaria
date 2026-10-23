import type { FastifyInstance } from "fastify";
import type { Contexto } from "../shared/contexto.js";
import { sessaoPorToken } from "../nucleo/sessoes.js";
import type { UsuarioSessao } from "../nucleo/permissoes.js";

declare module "fastify" {
  interface FastifyRequest {
    usuario: UsuarioSessao;
    token: string;
  }
}

/** Verdadeiro se o caminho (decodificado, sem maiúsculas, barras repetidas unidas) cai em /api; na dúvida, conta como API. */
function caminhoEhApi(bruto: string): boolean {
  let caminho = bruto.split("?")[0]!;
  try {
    caminho = decodeURIComponent(caminho);
  } catch {
    return true;
  }
  caminho = caminho.toLowerCase().replace(/\/{2,}/g, "/");
  return caminho === "/api" || caminho.startsWith("/api/");
}

/**
 * Falha fechada: é API se a URL crua, o pathname interpretado como URL (forma absoluta, ex.: GET http://h/api/x)
 * ou a rota que o roteador casou indicam /api. A isenção de autenticação exige que nenhum dos três indique.
 */
export function ehRotaDaApi(url: string, rotaCasada?: string): boolean {
  if (caminhoEhApi(url)) return true;
  if (rotaCasada !== undefined && caminhoEhApi(rotaCasada)) return true;
  try {
    return caminhoEhApi(new URL(url, "http://x").pathname);
  } catch {
    return true;
  }
}

export function registrarAutenticacao(app: FastifyInstance, ctx: Contexto): void {
  app.decorateRequest("usuario");
  app.decorateRequest("token");
  app.addHook("onRequest", async (req, res) => {
    if (req.method === "POST" && req.url.split("?")[0] === "/api/sessoes") return;
    // Arquivos da interface são públicos; tudo sob /api exige sessão.
    if ((req.method === "GET" || req.method === "HEAD") && !ehRotaDaApi(req.url, req.routeOptions.url)) return;
    const cab = req.headers.authorization ?? "";
    const token = cab.startsWith("Bearer ") ? cab.slice(7).trim() : "";
    const usuario = token ? await sessaoPorToken(ctx, token) : undefined;
    if (!usuario) {
      return res.status(401).send({ codigo: "NAO_AUTENTICADO", mensagem: "Entre no sistema para continuar." });
    }
    req.usuario = usuario;
    req.token = token;
  });
}
