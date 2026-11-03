import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
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

type Resposta = { status: number; corpo: unknown };
const emVoo = new Map<string, Promise<Resposta>>();

/**
 * Ação de dinheiro (ou cadastro) protegida contra envio duplicado: com `chave` no corpo, a segunda chamada devolve a resposta da
 * primeira em vez de repetir o efeito, inclusive quando as duas chegam ao mesmo tempo. Falhas não gravam a chave (a nova tentativa vale).
 */
export async function idempotente(ctx: Contexto, req: FastifyRequest, res: FastifyReply, fn: () => Promise<Resposta>): Promise<FastifyReply> {
  const chave = (req.body as { chave?: unknown } | null | undefined)?.chave;
  if (typeof chave !== "string" || !chave.trim()) {
    const r = await fn();
    return res.status(r.status).send(r.corpo);
  }
  const k = `${req.method} ${req.routeOptions.url} ${chave.trim()}`;
  const gravada = await ctx.db.selectFrom("fin_idempotencia").select(["status", "resposta"]).where("chave", "=", k).executeTakeFirst();
  if (gravada) return res.status(gravada.status).send(JSON.parse(gravada.resposta));
  let p = emVoo.get(k);
  if (!p) {
    p = (async () => {
      const r = await fn();
      await ctx.db.insertInto("fin_idempotencia").values({ chave: k, status: r.status, resposta: JSON.stringify(r.corpo ?? null), criado_em: ctx.relogio.agora().toISOString() }).onConflict((oc) => oc.doNothing()).execute();
      return r;
    })().finally(() => emVoo.delete(k));
    emVoo.set(k, p);
  }
  const r = await p;
  return res.status(r.status).send(r.corpo);
}
