import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../../shared/contexto.js";
import { FaturamentoService } from "../servicos/faturamento.js";
import { data, exigirFinanceiro, usuarioDe, uuid } from "./comum.js";

const corpoGerar = z.object({ faturamento_id: uuid, forma: z.enum(["boleto", "pix", "deposito"]) });

const corpoFechar = z.object({ forma: z.enum(["boleto", "pix", "deposito"]), data_vencimento: data });

export function registrarRotasFaturamento(app: FastifyInstance, ctx: Contexto): void {
  app.get("/api/financeiro/faturamentos", async (req) => {
    exigirFinanceiro(req);
    return new FaturamentoService(ctx).listar(z.object({ local_id: uuid }).parse(req.query).local_id);
  });

  // Fecha a fatura: gera o documento e envia o valor para Contas a Receber.
  app.post("/api/financeiro/faturamentos/:id/fechar", async (req) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = corpoFechar.parse(req.body);
    const f = await new FaturamentoService(ctx).fechar(id, c.forma, new Date(`${c.data_vencimento}T12:00:00.000Z`), usuarioDe(req));
    return { ...f, valor_original: f.valor_original.centavos, valor_liquido: f.valor_liquido.centavos };
  });

  app.post("/api/financeiro/faturamento/gerar-cobranca", async (req) => {
    exigirFinanceiro(req);
    const c = corpoGerar.parse(req.body);
    const f = await new FaturamentoService(ctx).gerarCobranca(c.faturamento_id, c.forma, usuarioDe(req));
    return { ...f, valor_original: f.valor_original.centavos, valor_liquido: f.valor_liquido.centavos };
  });
}
