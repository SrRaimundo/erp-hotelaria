import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { ContasReceberService } from "../servicos/contas-receber.js";
import { centavos, exigirFinanceiro, idempotente, usuarioDe, uuid } from "./comum.js";

const corpoConfirmar = z.object({ valor: centavos, conta_bancaria_id: uuid });

export function registrarRotasContasReceber(app: FastifyInstance, ctx: Contexto): void {
  app.put("/api/financeiro/contas-receber/:id/confirmar-pagamento", async (req, res) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = corpoConfirmar.parse(req.body);
    return idempotente(ctx, req, res, async () => {
      const r = await new ContasReceberService(ctx).confirmarPagamento(id, Dinheiro.de(c.valor), c.conta_bancaria_id, usuarioDe(req));
      return {
        status: 200,
        corpo: { ...r, valor_original: r.valor_original.centavos, valor_recebido: r.valor_recebido.centavos, valor_pendente: r.valor_pendente?.centavos },
      };
    });
  });
}
