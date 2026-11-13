import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../../shared/contexto.js";
import { CartaoService, CondicoesCartaoService, TIPOS_CARTAO } from "../servicos/cartao.js";
import { autorizarSupervisor } from "../../nucleo/supervisor.js";
import { centavos, credencialSupervisor, data, exigirFinanceiro, idempotente, usuarioDe, uuid } from "./comum.js";

const taxa = z.number().min(0, "A taxa não pode ser negativa.").max(99.99, "A taxa deve ser menor que 100%.");
const prazo = z.number().int("O prazo é em dias inteiros.").min(0, "O prazo não pode ser negativo.").max(3650, "Prazo longo demais.");

const corpoCriar = z
  .object({
    local_id: uuid,
    data,
    valor: centavos,
    informado: z.enum(["bruto", "liquido"]),
    condicao_id: uuid.optional(),
    adquirente: z.string().trim().optional(),
    bandeira: z.string().trim().optional(),
    tipo: z.enum(TIPOS_CARTAO).optional(),
    taxa_percentual: taxa.optional(),
    prazo_dias: prazo.optional(),
    previsao: data.optional(),
  })
  .refine((c) => !!c.condicao_id || (!!c.bandeira && !!c.tipo && c.taxa_percentual !== undefined && (c.prazo_dias !== undefined || !!c.previsao)), {
    message: "Escolha uma condição de cobrança ou informe bandeira, tipo, taxa e prazo.",
  });
const corpoBaixar = z.object({ conta_id: uuid, taxa_percentual: taxa.optional(), condicao_id: uuid.optional() });

const corpoCondicao = z.object({
  local_id: uuid,
  adquirente: z.string().trim().min(1, "Informe o adquirente."),
  bandeira: z.string().trim().min(1, "Informe a bandeira."),
  tipo: z.enum(TIPOS_CARTAO),
  prazo_dias: prazo,
  taxa_percentual: taxa,
});
const corpoCondicaoEditar = z.object({
  adquirente: z.string().trim().min(1, "Informe o adquirente.").optional(),
  bandeira: z.string().trim().min(1, "Informe a bandeira.").optional(),
  tipo: z.enum(TIPOS_CARTAO).optional(),
  prazo_dias: prazo.optional(),
  taxa_percentual: taxa.optional(),
  ativo: z.boolean().optional(),
});

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
    return new CartaoService(ctx).baixar(id, c.conta_id, { taxa_percentual: c.taxa_percentual, condicao_id: c.condicao_id }, usuarioDe(req));
  });

  // Estorna só a baixa: o cartão volta a "a receber" e pode ser baixado de novo na conta certa.
  app.post("/api/financeiro/cartao/movimentos/:id/estornar-baixa", async (req) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = z.object({ motivo: z.string(), supervisor: credencialSupervisor.optional() }).parse(req.body ?? {});
    const aut = await autorizarSupervisor(ctx, c.supervisor, c.motivo);
    return new CartaoService(ctx).estornarBaixa(id, { motivo: aut.motivo, supervisorId: aut.supervisorId }, usuarioDe(req));
  });

  // Cadastro Cobrança: condições do cartão por adquirente.
  app.get("/api/financeiro/cobranca/condicoes", async (req) => {
    exigirFinanceiro(req);
    return new CondicoesCartaoService(ctx).listar(z.object({ local_id: uuid }).parse(req.query).local_id);
  });
  app.post("/api/financeiro/cobranca/condicoes", async (req, res) => {
    exigirFinanceiro(req);
    const c = corpoCondicao.parse(req.body);
    return idempotente(ctx, req, res, async () => ({ status: 201, corpo: await new CondicoesCartaoService(ctx).criar(c, usuarioDe(req)) }));
  });
  app.put("/api/financeiro/cobranca/condicoes/:id", async (req) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return new CondicoesCartaoService(ctx).atualizar(id, corpoCondicaoEditar.parse(req.body), usuarioDe(req));
  });
}
