import type { Contexto } from "../shared/contexto.js";
import { novoId } from "../shared/ids.js";
import type { Evento } from "./barramento.js";

/** Grava o evento no outbox (na transação) e o agenda para publicação após o commit. */
export async function registrarEvento(
  tx: Contexto,
  tipo: string,
  payload: object,
): Promise<{ id: string; seq: number }> {
  const id = novoId();
  const criadoEm = tx.relogio.agora().toISOString();
  // Escritas no SQLite são serializadas; ler o máximo dentro da transação garante seq crescente.
  const ultimo = await tx.db.selectFrom("outbox").select((eb) => eb.fn.max("seq").as("m")).executeTakeFirst();
  const seq = Number(ultimo?.m ?? 0) + 1;
  await tx.db
    .insertInto("outbox")
    .values({ id, seq, tipo, payload: JSON.stringify(payload), criado_em: criadoEm, enviado_em: null })
    .execute();
  const evento: Evento = { id, seq, tipo, payload, criadoEm };
  tx.eventosPendentes.push(evento);
  return { id, seq };
}
