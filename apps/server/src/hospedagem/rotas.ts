import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../nucleo/permissoes.js";
import type { Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { alterarReserva, cancelarReserva, marcarNoShow, previaAlteracao, prorrogarSinal, type Mudanca } from "./alteracao.js";
import { estornarLancamento, estornarPagamento, extrato, lancar, registrarPagamento, saldo } from "./conta.js";
import { obterProdutoPorCodigo } from "../nucleo/produtos.js";
import { fazerCheckin, sugerirQuartos } from "./checkin.js";
import { criarGrupo, criarReserva, obterReserva } from "./reservas.js";

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD");
const texto = z.string().trim().min(1, "Campo obrigatório");

const corpoReserva = z.object({
  titularId: texto,
  categoriaId: texto,
  quartoId: texto.optional(),
  chegada: data,
  saida: data,
  adultos: z.number().int().min(1),
  criancasNascimento: z.array(data).default([]),
  canal: texto,
  observacoes: z.string().optional(),
  descontoPercentual: z.number().min(0).max(100).optional(),
  grupoId: texto.optional(),
  autorizacao: z.object({ motivo: z.string(), supervisor: z.object({ login: texto, senha: z.string() }) }).optional(),
});
const supervisor = z.object({ login: texto, senha: z.string() });
const corpoSensivel = z.object({ motivo: z.string(), supervisor });
const corpoAlteracao = z.object({
  quartoId: texto.nullable().optional(),
  categoriaId: texto.optional(),
  chegada: data.optional(),
  saida: data.optional(),
  adultos: z.number().int().min(1).optional(),
  criancasNascimento: z.array(data).optional(),
  precosManuais: z.array(z.object({ data, valor: z.number().int().min(0) })).optional(),
  autorizacao: corpoSensivel.optional(),
});
const queryPrevia = z.object({
  quartoId: texto.optional(),
  categoriaId: texto.optional(),
  chegada: data.optional(),
  saida: data.optional(),
  adultos: z.coerce.number().int().min(1).optional(),
  criancasNascimento: z.string().optional(), // datas separadas por vírgula
});
const corpoProrrogacao = corpoSensivel.extend({ novoPrazo: z.string().datetime() });
const corpoCheckin = z.object({
  quartoId: texto,
  acompanhantes: z.array(texto).default([]),
  cobrarEarlyCheckin: z.boolean().optional(),
  recalcularPreco: z.boolean().optional(),
});
const corpoGrupo = z.object({ titularId: texto, cobranca: z.enum(["unica", "separada"]) });

export function registrarRotasHospedagem(app: FastifyInstance, ctx: Contexto): void {
  const gerenciar = (req: { usuario: Parameters<typeof exigirPermissao>[0] }) => exigirPermissao(req.usuario, "reservas.gerenciar");

  app.post("/api/reservas", async (req) => {
    gerenciar(req);
    return criarReserva(ctx, corpoReserva.parse(req.body), req.usuario);
  });
  app.get("/api/reservas/:id", async (req) => {
    gerenciar(req);
    return obterReserva(ctx, z.object({ id: texto }).parse(req.params).id);
  });
  app.post("/api/grupos", async (req) => {
    gerenciar(req);
    return criarGrupo(ctx, corpoGrupo.parse(req.body), req.usuario);
  });
  app.get("/api/reservas/:id/previa", async (req) => {
    gerenciar(req);
    const { criancasNascimento, ...resto } = queryPrevia.parse(req.query);
    const mudanca: Mudanca = { ...resto };
    if (criancasNascimento !== undefined) {
      mudanca.criancasNascimento = criancasNascimento === "" ? [] : z.array(data).parse(criancasNascimento.split(","));
    }
    return previaAlteracao(ctx, z.object({ id: texto }).parse(req.params).id, mudanca);
  });
  app.patch("/api/reservas/:id", async (req) => {
    gerenciar(req);
    const id = z.object({ id: texto }).parse(req.params).id;
    const { autorizacao, ...mudanca } = corpoAlteracao.parse(req.body);
    return alterarReserva(ctx, id, mudanca, req.usuario, autorizacao);
  });
  app.post("/api/reservas/:id/cancelar", async (req) => {
    gerenciar(req);
    const id = z.object({ id: texto }).parse(req.params).id;
    await cancelarReserva(ctx, id, req.usuario, corpoSensivel.parse(req.body));
    return obterReserva(ctx, id);
  });
  app.post("/api/reservas/:id/no-show", async (req) => {
    gerenciar(req);
    const id = z.object({ id: texto }).parse(req.params).id;
    await marcarNoShow(ctx, id, req.usuario, corpoSensivel.parse(req.body));
    return obterReserva(ctx, id);
  });
  app.post("/api/reservas/:id/prorrogar-sinal", async (req) => {
    gerenciar(req);
    const id = z.object({ id: texto }).parse(req.params).id;
    const { novoPrazo, ...aut } = corpoProrrogacao.parse(req.body);
    await prorrogarSinal(ctx, id, novoPrazo, req.usuario, aut);
    return obterReserva(ctx, id);
  });

  app.get("/api/reservas/:id/quartos-sugeridos", async (req) => {
    exigirPermissao(req.usuario, "hospedagem.checkin");
    return sugerirQuartos(ctx, z.object({ id: texto }).parse(req.params).id);
  });
  app.post("/api/reservas/:id/checkin", async (req) => {
    exigirPermissao(req.usuario, "hospedagem.checkin");
    const id = z.object({ id: texto }).parse(req.params).id;
    await fazerCheckin(ctx, { reservaId: id, ...corpoCheckin.parse(req.body) }, req.usuario);
    return obterReserva(ctx, id);
  });

  const corpoLancamento =z.object({
    tipo: z.literal("extra"),
    produtoCodigo: texto.optional(),
    descricao: texto.optional(),
    valorUnitario: z.number().int().min(1).optional(),
    quantidade: z.number().int().min(1),
  });
  const corpoPagamento = z.object({ reservaId: texto.optional(), formaCodigo: texto, valor: z.number().int().min(1) });
  const idParam = z.object({ id: texto });

  app.get("/api/contas/:id", async (req) => {
    const id = idParam.parse(req.params).id;
    return { saldo: await saldo(ctx, id), extrato: await extrato(ctx, id) };
  });
  app.post("/api/contas/:id/lancamentos", async (req) => {
    exigirPermissao(req.usuario, "conta.lancar");
    const contaId = idParam.parse(req.params).id;
    const c = corpoLancamento.parse(req.body);
    let descricao = c.descricao;
    let valorUnitario = c.valorUnitario;
    let produtoId: string | undefined;
    if (c.produtoCodigo) {
      const p = await obterProdutoPorCodigo(ctx, c.produtoCodigo);
      produtoId = p.id;
      descricao = p.nome;
      valorUnitario = p.precoCentavos;
    }
    if (!descricao || valorUnitario === undefined) {
      throw new ErroDominio("LANCAMENTO_INCOMPLETO", "Informe o código do produto ou, então, a descrição e o valor unitário.");
    }
    const id = await lancar(ctx, { contaId, tipo: "extra", origem: "hospedagem", produtoId, descricao, quantidade: c.quantidade, valorUnitario }, req.usuario.id);
    return { id };
  });
  app.post("/api/contas/:id/pagamentos", async (req) => {
    exigirPermissao(req.usuario, "caixa.operar");
    const contaId = idParam.parse(req.params).id;
    const id = await registrarPagamento(ctx, { contaId, ...corpoPagamento.parse(req.body) }, req.usuario);
    return { id };
  });
  app.post("/api/lancamentos/:id/estornar", async (req) => {
    exigirPermissao(req.usuario, "conta.lancar");
    const id = await estornarLancamento(ctx, idParam.parse(req.params).id, req.usuario, corpoSensivel.parse(req.body));
    return { id };
  });
  app.post("/api/pagamentos/:id/estornar", async (req) => {
    exigirPermissao(req.usuario, "conta.lancar");
    const id = await estornarPagamento(ctx, idParam.parse(req.params).id, req.usuario, corpoSensivel.parse(req.body));
    return { id };
  });
}
