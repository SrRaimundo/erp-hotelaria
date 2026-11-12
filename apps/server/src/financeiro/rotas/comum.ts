import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { exigirPermissao } from "../../nucleo/permissoes.js";
import { data } from "../../http/validacao.js";
import type { Usuario } from "../servicos/locais.js";
import type { UUID } from "../../shared/ids.js";

export const PERMISSAO_FINANCEIRO = "caixa.operar";

/** Exige sessão (já garantida pelo hook de autenticação em /api) com permissão financeira. */
export function exigirFinanceiro(req: FastifyRequest): void {
  exigirPermissao(req.usuario, PERMISSAO_FINANCEIRO);
}

export function usuarioDe(req: FastifyRequest): Usuario {
  return { id: req.usuario.id, email: req.usuario.nome, dispositivo: "web" };
}

export const uuid = z.string().trim().min(1, "Campo obrigatório").transform((s) => s as UUID);
export const centavos = z.number().int().positive("Valor deve ser positivo");
export const credencialSupervisor = z.object({ login: z.string().trim().min(1), senha: z.string() });

/** Data AAAA-MM-DD → início do dia (UTC). */
export const inicioDoDia = (d: string) => new Date(`${d}T00:00:00.000Z`);
/** Data AAAA-MM-DD → fim do dia (UTC). */
export const fimDoDia = (d: string) => new Date(`${d}T23:59:59.999Z`);
export { data };
