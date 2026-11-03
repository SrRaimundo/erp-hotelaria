import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { exigirPermissao } from "../../nucleo/permissoes.js";
import { data } from "../../http/validacao.js";
import type { Usuario } from "../servicos/locais.js";
import { obterConfig } from "../../nucleo/pousada.js";
import type { Contexto } from "../../shared/contexto.js";
import type { UUID } from "../../shared/ids.js";
import { inicioDoDiaNoFuso, somarDias } from "../../shared/tempo.js";

export const PERMISSAO_FINANCEIRO = "financeiro.gerenciar";

/** Exige sessão (já garantida pelo hook de autenticação em /api) com permissão financeira. */
export function exigirFinanceiro(req: FastifyRequest): void {
  exigirPermissao(req.usuario, PERMISSAO_FINANCEIRO);
}

export function usuarioDe(req: FastifyRequest): Usuario {
  return { id: req.usuario.id, email: req.usuario.id, dispositivo: "web" };
}

export const uuid = z.string().trim().min(1, "Campo obrigatório").transform((s) => s as UUID);
export const centavos = z.number().int().positive("Valor deve ser positivo");
export const credencialSupervisor = z.object({ login: z.string().trim().min(1), senha: z.string() });

/** Data AAAA-MM-DD → início do dia no fuso da pousada. */
export const inicioDoDia = async (ctx: Contexto, d: string) => inicioDoDiaNoFuso(d, (await obterConfig(ctx)).fuso);
/** Data AAAA-MM-DD → último milissegundo do dia no fuso da pousada. */
export const fimDoDia = async (ctx: Contexto, d: string) =>
  new Date((await inicioDoDia(ctx, somarDias(d, 1))).getTime() - 1);
export { data };
