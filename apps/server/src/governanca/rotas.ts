import type { FastifyInstance } from "fastify";
import { exigirPermissao } from "../nucleo/permissoes.js";
import type { Contexto } from "../shared/contexto.js";
import { obterModelos } from "./modelos.js";

export function registrarRotasGovernanca(app: FastifyInstance, ctx: Contexto): void {
  app.get("/api/checklists/modelos", async (req) => {
    exigirPermissao(req.usuario, "quartos.situacao");
    return obterModelos(ctx);
  });
}
