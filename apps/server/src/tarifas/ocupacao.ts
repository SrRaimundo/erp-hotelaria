import type { Contexto } from "../shared/contexto.js";
import type { Data } from "../shared/tempo.js";

/**
 * % de ocupação da categoria na noite de `data`: reservas ativas cobrindo a noite
 * (chegada <= data < saída) sobre os quartos que não estão em manutenção/bloqueados.
 * Sem quartos disponíveis, a categoria está esgotada: 100.
 */
export async function ocupacaoCategoria(
  ctx: Contexto,
  categoriaId: string,
  data: Data,
  ignorarReservaId?: string,
): Promise<number> {
  const quartos = await ctx.db
    .selectFrom("quartos")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("categoria_id", "=", categoriaId)
    .where("situacao", "not in", ["em_manutencao", "bloqueado"])
    .executeTakeFirstOrThrow();
  if (quartos.n === 0) return 100;

  let q = ctx.db
    .selectFrom("reservas")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("categoria_id", "=", categoriaId)
    .where("estado", "in", ["pre_reserva", "confirmada", "hospedada"])
    .where("chegada", "<=", data)
    .where("saida", ">", data);
  if (ignorarReservaId) q = q.where("id", "!=", ignorarReservaId);
  const reservas = await q.executeTakeFirstOrThrow();
  return (reservas.n / quartos.n) * 100;
}
