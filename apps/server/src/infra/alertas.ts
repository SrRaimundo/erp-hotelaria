import type { Contexto } from "../shared/contexto.js";
import { novoId } from "../shared/ids.js";

export type Alerta = {
  id: string;
  tipo: string;
  alvoTipo: string;
  alvoId: string;
  mensagem: string;
  criadoEm: string;
};

/** Cria um alerta aberto; se já existe um aberto com o mesmo tipo e alvo, devolve o id dele. */
export async function criarAlerta(
  tx: Contexto,
  a: { tipo: string; alvoTipo: string; alvoId: string; mensagem: string },
): Promise<string> {
  const existente = await tx.db
    .selectFrom("alertas")
    .select("id")
    .where("tipo", "=", a.tipo)
    .where("alvo_id", "=", a.alvoId)
    .where("resolvido_em", "is", null)
    .executeTakeFirst();
  if (existente) return existente.id;
  const id = novoId();
  await tx.db
    .insertInto("alertas")
    .values({
      id,
      tipo: a.tipo,
      alvo_tipo: a.alvoTipo,
      alvo_id: a.alvoId,
      mensagem: a.mensagem,
      criado_em: tx.relogio.agora().toISOString(),
      resolvido_em: null,
      resolvido_por: null,
    })
    .execute();
  return id;
}

export async function resolverAlerta(tx: Contexto, id: string, usuarioId: string): Promise<void> {
  await tx.db
    .updateTable("alertas")
    .set({ resolvido_em: tx.relogio.agora().toISOString(), resolvido_por: usuarioId })
    .where("id", "=", id)
    .where("resolvido_em", "is", null)
    .execute();
}

export async function alertasAbertos(ctx: Contexto): Promise<Alerta[]> {
  const linhas = await ctx.db
    .selectFrom("alertas")
    .selectAll()
    .where("resolvido_em", "is", null)
    .orderBy("criado_em")
    .orderBy("id")
    .execute();
  return linhas.map((l) => ({
    id: l.id,
    tipo: l.tipo,
    alvoTipo: l.alvo_tipo,
    alvoId: l.alvo_id,
    mensagem: l.mensagem,
    criadoEm: l.criado_em,
  }));
}
