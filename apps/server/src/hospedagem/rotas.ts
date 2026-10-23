import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../nucleo/permissoes.js";
import type { Contexto } from "../shared/contexto.js";
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
}
