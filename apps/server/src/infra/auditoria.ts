import type { Contexto } from "../shared/contexto.js";
import { novoId } from "../shared/ids.js";

export const ATOR_SISTEMA = "Sistema";

export async function auditar(
  tx: Contexto,
  a: { ator: string; acao: string; alvoTipo: string; alvoId: string; motivo?: string; supervisorId?: string; dados?: object },
): Promise<void> {
  await tx.db
    .insertInto("auditoria")
    .values({
      id: novoId(),
      instante: tx.relogio.agora().toISOString(),
      ator: a.ator,
      acao: a.acao,
      alvo_tipo: a.alvoTipo,
      alvo_id: a.alvoId,
      motivo: a.motivo ?? null,
      supervisor_id: a.supervisorId ?? null,
      dados: JSON.stringify(a.dados ?? {}),
    })
    .execute();
}
