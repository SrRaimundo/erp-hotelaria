import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../nucleo/permissoes.js";
import type { Contexto } from "../shared/contexto.js";
import { configurarQuartos, estadoAssistente, pularEquipe } from "./assistente.js";

const centavos = z.number().int().min(0);
const corpoQuartos = z.object({
  categorias: z
    .array(
      z
        .object({
          nome: z.string().trim().min(1, "Campo obrigatório"),
          maxAdultos: z.number().int().min(1),
          maxCriancas: z.number().int().min(0),
          porAdultos: z.object({ 1: centavos, 2: centavos, 3: centavos }),
          adultoExtra: centavos,
          de: z.number().int().min(0),
          ate: z.number().int().min(0),
          bloco: z.string().optional(),
        })
        .refine((c) => c.de <= c.ate, { message: "O número final deve ser maior ou igual ao inicial", path: ["ate"] }),
    )
    .min(1, "Informe ao menos uma categoria"),
});

export function registrarRotasRetaguarda(app: FastifyInstance, ctx: Contexto): void {
  app.get("/api/assistente", async (req) => {
    exigirPermissao(req.usuario, "config.gerenciar");
    return estadoAssistente(ctx);
  });
  app.post("/api/assistente/quartos", async (req, res) => {
    exigirPermissao(req.usuario, "config.gerenciar");
    return res.status(201).send(await configurarQuartos(ctx, corpoQuartos.parse(req.body), req.usuario.id));
  });
  app.post("/api/assistente/pular-equipe", async (req) => {
    exigirPermissao(req.usuario, "config.gerenciar");
    return pularEquipe(ctx, req.usuario.id);
  });
}
