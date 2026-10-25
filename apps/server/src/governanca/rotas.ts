import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../nucleo/permissoes.js";
import type { Contexto } from "../shared/contexto.js";
import { emTransacao } from "../shared/contexto.js";
import { abrirChamado, avisarControleFaltando, cancelarAvisoControle, cancelarChamado, listarChamados, resolverChamado } from "./chamados.js";
import { concluirChecklist } from "./checklists.js";
import { lancarFrigobar } from "./frigobar.js";
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

  const quantidade = z.number().int("Informe um número inteiro").min(0, "Não pode ser negativo").max(999, "No máximo 999");
  const textoId = z.string().min(1, "Campo obrigatório");
  const corpoResposta = z.object({
    itemId: textoId,
    simNao: z.boolean().optional(),
    quantidade: quantidade.optional(),
    equipamento: z.enum(["funciona", "nao_funciona", "nao_se_aplica"]).optional(),
    presenca: z.enum(["presente", "faltando", "nao_se_aplica"]).optional(),
    observacao: z.string().optional(),
    chamadoId: z.string().min(1).optional(),
    alertaId: z.string().min(1).optional(),
  });
  const corpoChecklist = z.object({
    tipo: z.enum(["saida", "diaria"]),
    iniciadoEm: z.string().min(1, "Campo obrigatório"),
    respostas: z.array(corpoResposta),
    frigobar: z.array(z.object({ produtoId: textoId, quantidade })).optional(),
    resultado: z.enum(["liberado", "bloqueado"]).optional(),
    motivo: z.string().optional(),
  });
  const corpoFrigobar = z.object({ reservaId: textoId, itens: z.array(z.object({ produtoId: textoId, quantidade })) });

  app.post("/api/quartos/:id/checklists", async (req) => {
    exigirPermissao(req.usuario, "quartos.situacao");
    const { id } = idParam.parse(req.params);
    return concluirChecklist(ctx, id, corpoChecklist.parse(req.body), req.usuario);
  });
  app.post("/api/contas/:id/frigobar", async (req) => {
    exigirPermissao(req.usuario, "conta.lancar");
    const { id } = idParam.parse(req.params);
    return lancarFrigobar(ctx, id, corpoFrigobar.parse(req.body), req.usuario);
  });
}
