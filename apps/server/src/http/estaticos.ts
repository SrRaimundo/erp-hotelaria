import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { ehRotaDaApi } from "./autenticacao.js";

/**
 * Serve a interface (build do web) em `/`. Qualquer GET fora de `/api` que não seja um arquivo
 * devolve `index.html` (a navegação é feita no navegador). Sem build, o servidor segue só com a API.
 */
export function registrarEstaticos(app: FastifyInstance, webDir: string): void {
  if (!existsSync(join(webDir, "index.html"))) return;
  app.register(fastifyStatic, { root: webDir });
  app.setNotFoundHandler(async (req, res) => {
    if ((req.method === "GET" || req.method === "HEAD") && !ehRotaDaApi(req.url)) {
      return res.type("text/html; charset=utf-8").sendFile("index.html");
    }
    return res.status(404).send({ codigo: "NAO_ENCONTRADO", mensagem: "Rota não encontrada." });
  });
}
