import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../../shared/contexto.js";
import { FaturamentoService } from "../servicos/faturamento.js";
import { data, exigirFinanceiro, idempotente, usuarioDe, uuid } from "./comum.js";


const corpoFechar = z.object({ forma: z.enum(["boleto", "pix", "deposito"]), data_vencimento: data });
const corpoFecharGrupo = corpoFechar.extend({ ids: z.array(uuid).min(1, "Escolha ao menos um fechamento.") });

export function registrarRotasFaturamento(app: FastifyInstance, ctx: Contexto): void {
  app.get("/api/financeiro/faturamentos", async (req) => {
    exigirFinanceiro(req);
    return new FaturamentoService(ctx).listar(z.object({ local_id: uuid }).parse(req.query).local_id);
  });

  // Extrato da cobrança (tela e impressão): cada fechamento agrupado na fatura.
  app.get("/api/financeiro/faturamentos/extrato", async (req) => {
    exigirFinanceiro(req);
    const q = z.object({ local_id: uuid, numero: z.string().trim().min(1) }).parse(req.query);
    return new FaturamentoService(ctx).extrato(q.local_id, q.numero);
  });

  // Fecha UMA fatura com vários fechamentos do mesmo cliente: um documento, uma conta a receber pela soma.
  app.post("/api/financeiro/faturamentos/fechar-grupo", async (req, res) => {
    exigirFinanceiro(req);
    const c = corpoFecharGrupo.parse(req.body);
    return idempotente(ctx, req, res, async () => {
      const f = await new FaturamentoService(ctx).fecharGrupo(c.ids, c.forma, new Date(`${c.data_vencimento}T12:00:00.000Z`), usuarioDe(req));
      return { status: 200, corpo: { ...f, valor_original: f.valor_original.centavos, valor_liquido: f.valor_liquido.centavos } };
    });
  });

  // Fecha a fatura: gera o documento e envia o valor para Contas a Receber.
  app.post("/api/financeiro/faturamentos/:id/fechar", async (req) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = corpoFechar.parse(req.body);
    const f = await new FaturamentoService(ctx).fechar(id, c.forma, new Date(`${c.data_vencimento}T12:00:00.000Z`), usuarioDe(req));
    return { ...f, valor_original: f.valor_original.centavos, valor_liquido: f.valor_liquido.centavos };
  });
}
