import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../../shared/contexto.js";
import { FaturamentoService } from "../servicos/faturamento.js";
import { exigirFinanceiro, usuarioDe, uuid } from "./comum.js";

const corpoGerar = z.object({ faturamento_id: uuid, forma: z.enum(["boleto", "pix", "deposito"]) });

export function registrarRotasFaturamento(app: FastifyInstance, ctx: Contexto): void {
  app.post("/api/financeiro/faturamento/gerar-cobranca", async (req) => {
    exigirFinanceiro(req);
    const c = corpoGerar.parse(req.body);
    const f = await new FaturamentoService(ctx).gerarCobranca(c.faturamento_id, c.forma, usuarioDe(req));
    return { ...f, valor_original: f.valor_original.centavos, valor_liquido: f.valor_liquido.centavos };
  });
}
