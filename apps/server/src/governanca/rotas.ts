import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../nucleo/permissoes.js";
import type { Contexto } from "../shared/contexto.js";
import { emTransacao } from "../shared/contexto.js";
import { abrirChamado, avisarControleFaltando, cancelarAvisoControle, cancelarChamado, listarChamados, resolverChamado } from "./chamados.js";
import { obterModelos } from "./modelos.js";

export function registrarRotasGovernanca(app: FastifyInstance, ctx: Contexto): void {
  app.get("/api/checklists/modelos", async (req) => {
    exigirPermissao(req.usuario, "quartos.situacao");
    return obterModelos(ctx);
  });

  const idParam = z.object({ id: z.string().min(1) });
  const corpoItem = z.object({ itemId: z.string().min(1, "Campo obrigatório") });
  const corpoChamado = corpoItem.extend({ observacao: z.string().optional() });
  const corpoResolver = z.object({ observacao: z.string().optional() }).default({});
  const queryChamados = z.object({
    situacao: z.enum(["aberto", "resolvido", "cancelado"]).optional(),
    quartoId: z.string().min(1).optional(),
  });

  app.post("/api/quartos/:id/chamados", async (req) => {
    exigirPermissao(req.usuario, "quartos.situacao");
    const { id } = idParam.parse(req.params);
    const corpo = corpoChamado.parse(req.body);
    return emTransacao(ctx, (tx) => abrirChamado(tx, { quartoId: id, ...corpo }, req.usuario));
  });
  app.post("/api/chamados/:id/cancelar", async (req) => {
    exigirPermissao(req.usuario, "quartos.situacao");
    await cancelarChamado(ctx, idParam.parse(req.params).id, req.usuario);
    return { ok: true };
  });
  app.post("/api/chamados/:id/resolver", async (req) => {
    exigirPermissao(req.usuario, "quartos.manutencao");
    return resolverChamado(ctx, idParam.parse(req.params).id, corpoResolver.parse(req.body ?? {}).observacao, req.usuario);
  });
  app.get("/api/chamados", async (req) => {
    exigirPermissao(req.usuario, "quartos.manutencao");
    return listarChamados(ctx, queryChamados.parse(req.query));
  });
  app.post("/api/quartos/:id/avisos-controle", async (req) => {
    exigirPermissao(req.usuario, "quartos.situacao");
    const { id } = idParam.parse(req.params);
    const { itemId } = corpoItem.parse(req.body);
    const alertaId = await emTransacao(ctx, (tx) => avisarControleFaltando(tx, { quartoId: id, itemId }, req.usuario));
    return { alertaId };
  });
  app.post("/api/avisos-controle/:id/cancelar", async (req) => {
    exigirPermissao(req.usuario, "quartos.situacao");
    await cancelarAvisoControle(ctx, idParam.parse(req.params).id, req.usuario);
    return { ok: true };
  });
}
