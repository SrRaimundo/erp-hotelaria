import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../../nucleo/permissoes.js";
import { autorizarSupervisor } from "../../nucleo/supervisor.js";
import type { Contexto } from "../../shared/contexto.js";
import { aplicarCorrecao, estadoFila, ignorarEvento, processarPendentes } from "../consumidores-eventos/fila.js";
import { credencialSupervisor } from "./comum.js";

/** Fila do Financeiro: administração (permissão de configuração, não a financeira). */
export function registrarRotasFila(app: FastifyInstance, ctx: Contexto): void {
  app.get("/api/financeiro/fila", async (req) => {
    exigirPermissao(req.usuario, "config.gerenciar");
    return estadoFila(ctx);
  });

  app.post("/api/financeiro/fila/tentar-novamente", async (req) => {
    exigirPermissao(req.usuario, "config.gerenciar");
    return processarPendentes(ctx);
  });

  app.post("/api/financeiro/fila/ignorar", async (req) => {
    exigirPermissao(req.usuario, "config.gerenciar");
    const c = z.object({ seq: z.number().int().positive(), motivo: z.string().trim().min(1, "Informe o motivo."), supervisor: credencialSupervisor.optional() }).parse(req.body);
    const aut = await autorizarSupervisor(ctx, c.supervisor, c.motivo);
    await ignorarEvento(ctx, c.seq, { motivo: aut.motivo, supervisorId: aut.supervisorId, ator: req.usuario.id });
    return { fila: await processarPendentes(ctx), estado: await estadoFila(ctx) };
  });

  // Correção de evento ignorado: só aqui a regra de origem é dispensada (supervisor + motivo, auditado, uma vez).
  app.post("/api/financeiro/fila/ignorados/:seq/aplicar-correcao", async (req) => {
    exigirPermissao(req.usuario, "config.gerenciar");
    const { seq } = z.object({ seq: z.coerce.number().int().positive() }).parse(req.params);
    const c = z.object({ motivo: z.string().trim().min(1, "Informe o motivo."), supervisor: credencialSupervisor.optional() }).parse(req.body);
    const aut = await autorizarSupervisor(ctx, c.supervisor, c.motivo);
    await aplicarCorrecao(ctx, seq, { motivo: aut.motivo, supervisorId: aut.supervisorId, ator: req.usuario.id });
    return estadoFila(ctx);
  });
}
