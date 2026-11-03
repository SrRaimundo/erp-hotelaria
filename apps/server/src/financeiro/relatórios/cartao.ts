import type { Contexto } from "../../shared/contexto.js";
import type { UUID } from "../../shared/ids.js";

export type SituacaoCartao = "aberto" | "fechado" | "liquidado";

export type PosicaoCartao = Record<SituacaoCartao, { quantidade: number; valor: number }> & { local_id: UUID };

/**
 * Posição do cartão a partir dos movimentos de cartão (crédito, débito e voucher), em valor líquido:
 * aberto = a receber com previsão futura; fechado = a receber já na data prevista (pronto para baixar); liquidado = baixado.
 * Cancelados ficam fora.
 */
export async function posicaoCartao(ctx: Contexto, local_id: UUID): Promise<PosicaoCartao> {
  const hoje = ctx.relogio.agora().toISOString().slice(0, 10);
  const linhas = (await ctx.db
    .selectFrom("fin_cartao_movimento")
    .select(["status", "previsao", "valor_liquido"])
    .where("local_id", "=", local_id)
    .where("status", "!=", "cancelado")
    .execute()) as any[];
  const r: PosicaoCartao = { local_id, aberto: { quantidade: 0, valor: 0 }, fechado: { quantidade: 0, valor: 0 }, liquidado: { quantidade: 0, valor: 0 } };
  for (const l of linhas) {
    const s: SituacaoCartao = l.status === "baixado" ? "liquidado" : l.previsao <= hoje ? "fechado" : "aberto";
    r[s].quantidade++;
    r[s].valor += l.valor_liquido;
  }
  return r;
}
