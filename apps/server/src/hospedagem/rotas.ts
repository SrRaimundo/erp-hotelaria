import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../nucleo/permissoes.js";
import type { Contexto } from "../shared/contexto.js";
import { alterarReserva, cancelarReserva, marcarNoShow, previaAlteracao, prorrogarSinal, type Mudanca } from "./alteracao.js";
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
}
