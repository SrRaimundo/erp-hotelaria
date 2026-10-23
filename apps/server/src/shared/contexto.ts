import type { Kysely } from "kysely";
import type { Relogio } from "./relogio.js";

export interface Barramento {
  publicar(e: unknown): void;
}

export interface Contexto {
  db: Kysely<any>;
  relogio: Relogio;
  barramento: Barramento;
  /** Eventos publicados durante a transação; despachados só após o commit. */
  eventosPendentes: unknown[];
}

/**
 * Executa fn em transação. Eventos acumulados em tx.eventosPendentes são
 * despachados no barramento somente após o commit; em caso de erro são descartados.
 * Se ctx já está numa transação, reaproveita-a (os eventos saem no commit da externa).
 */
export async function emTransacao<T>(ctx: Contexto, fn: (tx: Contexto) => Promise<T>): Promise<T> {
  if (ctx.db.isTransaction) return fn(ctx);
  const pendentes: unknown[] = [];
  const resultado = await ctx.db.transaction().execute((trx) =>
    fn({ ...ctx, db: trx, eventosPendentes: pendentes }),
  );
  for (const e of pendentes) ctx.barramento.publicar(e);
  return resultado;
}
