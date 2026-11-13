import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { CATEGORIAS_RECEBER, ContasReceberService } from "../servicos/contas-receber.js";
import { autorizarSupervisor } from "../../nucleo/supervisor.js";
import { centavos, credencialSupervisor, data, exigirFinanceiro, idempotente, usuarioDe, uuid } from "./comum.js";

const corpoConfirmar = z.object({ valor: centavos, conta_bancaria_id: uuid, novo_vencimento: data.optional() });

const corpoManual = z.object({
  cliente_id: uuid,
  numero_documento: z.string().trim().min(1, "Informe o número do documento."),
  valor: centavos,
  vencimento: data,
  categoria: z.enum(CATEGORIAS_RECEBER),
  observacao: z.string().trim().max(500).optional(),
  forma_pagamento: z.enum(["boleto", "pix", "deposito", "dinheiro"]).optional(),
});
const paraDados = (c: Partial<z.infer<typeof corpoManual>>) => ({ ...c, vencimento: c.vencimento ? new Date(`${c.vencimento}T12:00:00.000Z`) : undefined });
const saida = (r: Awaited<ReturnType<ContasReceberService["obter"]>>) => ({ ...r, valor_original: r.valor_original.centavos, valor_recebido: r.valor_recebido.centavos, valor_pendente: r.valor_pendente?.centavos });

export function registrarRotasContasReceber(app: FastifyInstance, ctx: Contexto): void {
  // Conta a receber lançada à mão (espelho de Contas a Pagar).
  app.post("/api/financeiro/contas-receber", async (req, res) => {
    exigirFinanceiro(req);
    const c = corpoManual.extend({ local_id: uuid }).parse(req.body);
    return idempotente(ctx, req, res, async () => {
      const r = await new ContasReceberService(ctx).criarManual(c.local_id, paraDados(c) as never, usuarioDe(req));
      return { status: 201, corpo: { ...saida(r), origem: "manual", categoria: c.categoria, observacao: c.observacao ?? null } };
    });
  });

  app.put("/api/financeiro/contas-receber/:id", async (req) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return saida(await new ContasReceberService(ctx).editarManual(id, paraDados(corpoManual.partial().parse(req.body)) as never, usuarioDe(req)));
  });

  app.post("/api/financeiro/contas-receber/:id/cancelar", async (req) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = z.object({ motivo: z.string().trim().min(1, "Informe o motivo."), supervisor: credencialSupervisor.optional() }).parse(req.body);
    const aut = await autorizarSupervisor(ctx, c.supervisor, c.motivo);
    return saida(await new ContasReceberService(ctx).cancelarManual(id, { motivo: aut.motivo, supervisorId: aut.supervisorId }, usuarioDe(req)));
  });

  app.put("/api/financeiro/contas-receber/:id/confirmar-pagamento", async (req, res) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = corpoConfirmar.parse(req.body);
    return idempotente(ctx, req, res, async () => {
      const r = await new ContasReceberService(ctx).confirmarPagamento(id, Dinheiro.de(c.valor), c.conta_bancaria_id, usuarioDe(req), c.novo_vencimento ? new Date(`${c.novo_vencimento}T12:00:00.000Z`) : undefined);
      return {
        status: 200,
        corpo: { ...r, valor_original: r.valor_original.centavos, valor_recebido: r.valor_recebido.centavos, valor_pendente: r.valor_pendente?.centavos },
      };
    });
  });
}
