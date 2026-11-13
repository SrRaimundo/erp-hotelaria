import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { autorizarSupervisor } from "../../nucleo/supervisor.js";
import type { Contexto } from "../../shared/contexto.js";
import { TituloService } from "../servicos/titulos.js";
import { centavos, credencialSupervisor, data, exigirFinanceiro, idempotente, usuarioDe, uuid } from "./comum.js";

const FORMAS = ["dinheiro", "pix", "debito", "credito", "cheque", "boleto", "transferencia", "deposito"] as const;
const corpoCriar = z.object({
  tipo: z.enum(["pagar", "receber"]),
  local_id: uuid,
  documento: z.string().trim().min(1, "Informe o documento (ou a descrição) do título."),
  valor_total: centavos,
  intervalo: z.enum(["30_dias", "mensal", "livre"]),
  categoria: z.string().trim().min(1),
  fornecedor_id: uuid.optional(),
  cliente_id: uuid.optional(),
  forma_pagamento: z.enum(FORMAS).optional(),
  observacao: z.string().trim().max(500).optional(),
  parcelas: z.array(z.object({ vencimento: data, valor: centavos })).max(200),
});

export function registrarRotasTitulos(app: FastifyInstance, ctx: Contexto): void {
  app.post("/api/financeiro/titulos", async (req, res) => {
    exigirFinanceiro(req);
    const c = corpoCriar.parse(req.body);
    return idempotente(ctx, req, res, async () => ({ status: 201, corpo: await new TituloService(ctx).criar(c, usuarioDe(req)) }));
  });

  app.get("/api/financeiro/titulos/:id", async (req) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return new TituloService(ctx).obter(id);
  });

  app.post("/api/financeiro/titulos/:id/cancelar", async (req) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = z.object({ motivo: z.string().trim().min(1, "Informe o motivo."), supervisor: credencialSupervisor.optional() }).parse(req.body);
    const aut = await autorizarSupervisor(ctx, c.supervisor, c.motivo);
    return new TituloService(ctx).cancelar(id, { motivo: aut.motivo, supervisorId: aut.supervisorId }, usuarioDe(req));
  });
}
