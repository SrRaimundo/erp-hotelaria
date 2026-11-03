import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../../shared/contexto.js";
import { CadastrosFinanceiroService, TIPOS_CONTA } from "../servicos/cadastros.js";
import { exigirFinanceiro, idempotente, usuarioDe, uuid } from "./comum.js";

const texto = (msg: string) => z.string().trim().min(1, msg);
const corpoConta = z.object({
  local_id: uuid,
  nome: texto("Informe o nome da conta."),
  banco: z.string().trim().default(""),
  agencia: z.string().trim().default(""),
  numero: texto("Informe o número da conta."),
  tipo: z.enum(TIPOS_CONTA),
  saldo_inicial: z.number().int().default(0),
});
const corpoFornecedor = z.object({ local_id: uuid, razao_social: texto("Informe a razão social."), cnpj: z.string().trim().optional() });
const corpoCliente = z.object({
  contato: z.object({ email: z.string().trim().optional(), telefone: z.string().trim().optional(), endereco: z.string().trim().optional() }).optional(),
  politica: z
    .object({
      prazo_dias: z.number().int().min(0).max(365).optional(),
      forma_cobranca: z.enum(["boleto", "pix", "deposito"]).optional(),
      observacoes: z.string().trim().optional(),
    })
    .optional(),
});

export function registrarRotasCadastros(app: FastifyInstance, ctx: Contexto): void {
  const svc = () => new CadastrosFinanceiroService(ctx);
  const porLocal = z.object({ local_id: uuid });

  app.get("/api/financeiro/contas", async (req) => {
    exigirFinanceiro(req);
    return svc().listarContas(porLocal.parse(req.query).local_id);
  });
  app.post("/api/financeiro/contas", async (req, res) => {
    exigirFinanceiro(req);
    const c = corpoConta.parse(req.body);
    return idempotente(ctx, req, res, async () => {
      await svc().criarConta(c, usuarioDe(req));
      return { status: 201, corpo: (await svc().listarContas(c.local_id)).find((x) => x.numero === c.numero) };
    });
  });

  app.get("/api/financeiro/fornecedores", async (req) => {
    exigirFinanceiro(req);
    return svc().listarFornecedores(porLocal.parse(req.query).local_id);
  });
  app.post("/api/financeiro/fornecedores", async (req, res) => {
    exigirFinanceiro(req);
    const c = corpoFornecedor.parse(req.body);
    return idempotente(ctx, req, res, async () => ({ status: 201, corpo: await svc().criarFornecedor(c, usuarioDe(req)) }));
  });

  app.get("/api/financeiro/clientes", async (req) => {
    exigirFinanceiro(req);
    return svc().listarClientes(porLocal.parse(req.query).local_id);
  });
  app.put("/api/financeiro/clientes/:id", async (req) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    await svc().atualizarCliente(id, corpoCliente.parse(req.body), usuarioDe(req));
    return { ok: true };
  });
}
