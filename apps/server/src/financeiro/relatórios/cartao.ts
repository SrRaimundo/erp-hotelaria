import type { Contexto } from "../../shared/contexto.js";
import type { UUID } from "../../shared/ids.js";

export type SituacaoCartao = "aberto" | "fechado" | "liquidado";

export type PosicaoCartao = Record<SituacaoCartao, { quantidade: number; valor: number }> & { local_id: UUID };

/**
 * Posição de cartão de crédito a partir dos lançamentos com forma_pagamento "credito"
 * (não há tabela própria de cartão): pendente=aberto, confirmado=fechado, liquidado=liquidado. Cancelados ficam fora.
 */
export async function posicaoCartao(ctx: Contexto, local_id: UUID): Promise<PosicaoCartao> {
  const linhas = (await ctx.db
    .selectFrom("fin_lancamento")
    .select(["status", "valor"])
    .where("local_id", "=", local_id)
    .where("forma_pagamento", "=", "credito")
    .where("status", "!=", "cancelado")
    .execute()) as any[];
  const mapa: Record<string, SituacaoCartao> = { pendente: "aberto", confirmado: "fechado", liquidado: "liquidado" };
  const r: PosicaoCartao = { local_id, aberto: { quantidade: 0, valor: 0 }, fechado: { quantidade: 0, valor: 0 }, liquidado: { quantidade: 0, valor: 0 } };
  for (const l of linhas) {
    const s = mapa[l.status];
    if (!s) continue;
    r[s].quantidade++;
    r[s].valor += l.valor;
  }
  return r;
}
