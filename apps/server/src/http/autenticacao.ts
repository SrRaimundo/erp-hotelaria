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

export function registrarAutenticacao(app: FastifyInstance, ctx: Contexto): void {
  app.decorateRequest("usuario");
  app.decorateRequest("token");
  app.addHook("onRequest", async (req, res) => {
    if (req.method === "POST" && req.url.split("?")[0] === "/api/sessoes") return;
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
