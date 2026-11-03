import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { CaixaBancoService } from "../servicos/caixa-banco.js";
import { centavos, data, exigirFinanceiro, idempotente, fimDoDia, usuarioDe, uuid } from "./comum.js";

const querySaldo = z.object({ conta_id: uuid, data: data.optional() });
const corpoTransferencia = z.object({ origem: uuid, destino: uuid, valor: centavos });

export function registrarRotasCaixaBanco(app: FastifyInstance, ctx: Contexto): void {
  app.get("/api/financeiro/caixa-banco/saldo", async (req) => {
    exigirFinanceiro(req);
    const q = querySaldo.parse(req.query);
    const ate = q.data ? await fimDoDia(ctx, q.data) : ctx.relogio.agora();
    const saldo = await new CaixaBancoService(ctx).obterSaldo(q.conta_id, ate);
    return { conta_id: q.conta_id, data: ate.toISOString(), saldo: saldo.centavos };
  });

  app.post("/api/financeiro/caixa-banco/transferencia", async (req, res) => {
    exigirFinanceiro(req);
    const c = corpoTransferencia.parse(req.body);
    return idempotente(ctx, req, res, async () => {
      const r = await new CaixaBancoService(ctx).transferir(c.origem, c.destino, Dinheiro.de(c.valor), usuarioDe(req));
      const mov = (m: typeof r.mov_origem) => ({
        ...m, valor: m.valor.centavos, saldo_anterior: m.saldo_anterior.centavos, saldo_posterior: m.saldo_posterior.centavos,
      });
      return { status: 201, corpo: { mov_origem: mov(r.mov_origem), mov_destino: mov(r.mov_destino) } };
    });
  });
}
