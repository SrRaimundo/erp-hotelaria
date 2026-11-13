import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { CATEGORIAS_PAGAR, ContasPagarService } from "../servicos/contas-pagar.js";
import { centavos, data, exigirFinanceiro, idempotente, usuarioDe, uuid } from "./comum.js";

const FORMAS = ["dinheiro", "pix", "debito", "credito", "cheque", "boleto", "transferencia"] as const;
const corpoCriar = z.object({
  local_id: uuid,
  descricao: z.string().trim().min(1, "Informe a descrição."),
  categoria: z.enum(CATEGORIAS_PAGAR),
  valor: centavos,
  vencimento: data,
  fornecedor_id: uuid.optional(),
  forma_pagamento: z.enum(FORMAS).optional(),
});
const corpoBaixar = z.object({ conta_id: uuid, forma_pagamento: z.enum(FORMAS).optional(), valor: centavos.optional(), novo_vencimento: data.optional() });

export function registrarRotasContasPagar(app: FastifyInstance, ctx: Contexto): void {
  app.post("/api/financeiro/contas-a-pagar", async (req, res) => {
    exigirFinanceiro(req);
    const c = corpoCriar.parse(req.body);
    return idempotente(ctx, req, res, async () => {
      const l = await new ContasPagarService(ctx).criar(
        { ...c, valor: Dinheiro.de(c.valor), vencimento: new Date(`${c.vencimento}T12:00:00.000Z`) },
        usuarioDe(req),
      );
      return { status: 201, corpo: { ...l, valor: l.valor.centavos } };
    });
  });

  app.put("/api/financeiro/contas-a-pagar/:id/baixar", async (req) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = corpoBaixar.parse(req.body);
    const l = await new ContasPagarService(ctx).baixar(id, c.conta_id, c.forma_pagamento, usuarioDe(req), {
      valor: c.valor === undefined ? undefined : Dinheiro.de(c.valor),
      novo_vencimento: c.novo_vencimento ? new Date(`${c.novo_vencimento}T12:00:00.000Z`) : undefined,
    });
    return { ...l, valor: l.valor.centavos };
  });
}
