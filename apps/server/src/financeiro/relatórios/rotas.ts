import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../../shared/contexto.js";
import { data, exigirFinanceiro, uuid } from "../rotas/comum.js";
import { posicaoCartao } from "./cartao.js";
import { consolidadoPorLocal } from "./consolidado.js";
import { posicaoContasReceber } from "./contas-receber.js";
import { fluxoCaixaDiario } from "./fluxo-caixa.js";
import { movimentoPorConta } from "./movimento-conta.js";

const dia = data;

export function registrarRotasRelatorios(app: FastifyInstance, ctx: Contexto): void {
  const get = <T extends z.ZodType>(caminho: string, schema: T, fn: (q: z.infer<T>) => Promise<unknown>) => {
    app.get(`/api/financeiro/relatorios/${caminho}`, async (req) => {
      exigirFinanceiro(req);
      return fn(schema.parse(req.query));
    });
  };
  get("fluxo-caixa", z.object({ local_id: uuid, data: dia }), (q) => fluxoCaixaDiario(ctx, q.local_id, q.data));
  get("contas-receber", z.object({ local_id: uuid }), (q) => posicaoContasReceber(ctx, q.local_id));
  get("movimento", z.object({ conta_id: uuid, data_inicio: dia, data_fim: dia }), (q) =>
    movimentoPorConta(ctx, q.conta_id, q.data_inicio, q.data_fim));
  get("consolidado", z.object({ data_inicio: dia, data_fim: dia }), (q) => consolidadoPorLocal(ctx, q.data_inicio, q.data_fim));
  get("cartao", z.object({ local_id: uuid }), (q) => posicaoCartao(ctx, q.local_id));
}
