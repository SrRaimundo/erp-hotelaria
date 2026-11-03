import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../../shared/contexto.js";
import { CartaoService, TIPOS_CARTAO } from "../servicos/cartao.js";
import { centavos, data, exigirFinanceiro, idempotente, usuarioDe, uuid } from "./comum.js";

const taxa = z.number().min(0, "A taxa não pode ser negativa.").max(99.99, "A taxa deve ser menor que 100%.");
const corpoCriar = z.object({
  local_id: uuid,
  data,
  bandeira: z.string().trim().min(1, "Informe a bandeira."),
  tipo: z.enum(TIPOS_CARTAO),
  valor: centavos,
  informado: z.enum(["bruto", "liquido"]),
  taxa_percentual: taxa.default(0),
  previsao: data.optional(),
});
const corpoBaixar = z.object({ conta_id: uuid, taxa_percentual: taxa.optional() });

export function registrarRotasCartao(app: FastifyInstance, ctx: Contexto): void {
  app.get("/api/financeiro/cartao/movimentos", async (req) => {
    exigirFinanceiro(req);
    return new CartaoService(ctx).listar(z.object({ local_id: uuid }).parse(req.query).local_id);
  });

  app.post("/api/financeiro/cartao/movimentos", async (req, res) => {
    exigirFinanceiro(req);
    const c = corpoCriar.parse(req.body);
    return idempotente(ctx, req, res, async () => ({ status: 201, corpo: await new CartaoService(ctx).criar(c, usuarioDe(req)) }));
  });

  app.put("/api/financeiro/cartao/movimentos/:id/baixar", async (req) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = corpoBaixar.parse(req.body);
    return new CartaoService(ctx).baixar(id, c.conta_id, c.taxa_percentual, usuarioDe(req));
  });
}
