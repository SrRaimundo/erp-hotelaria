import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";

export type CodigoForma = "dinheiro" | "pix" | "debito" | "credito" | "faturado";
export type FormaPagamento = { id: string; codigo: CodigoForma; nome: string; ativa: boolean };

function paraForma(l: any): FormaPagamento {
  return { id: l.id, codigo: l.codigo, nome: l.nome, ativa: l.ativa === 1 };
}

/** Ordem fixa: dinheiro, pix, débito, crédito, faturado. */
export async function listarFormas(ctx: Contexto, apenasAtivas = true): Promise<FormaPagamento[]> {
  let q = ctx.db.selectFrom("formas_pagamento").selectAll();
  if (apenasAtivas) q = q.where("ativa", "=", 1);
  return (await q.orderBy("ordem").execute()).map(paraForma);
}

export async function ativarForma(ctx: Contexto, codigo: CodigoForma, ativa: boolean, ator: string): Promise<FormaPagamento> {
  return emTransacao(ctx, async (tx) => {
    const atual = await tx.db.selectFrom("formas_pagamento").selectAll().where("codigo", "=", codigo).executeTakeFirst();
    if (!atual) throw new ErroDominio("FORMA_NAO_ENCONTRADA", "Forma de pagamento não encontrada.");
    await tx.db.updateTable("formas_pagamento").set({ ativa: ativa ? 1 : 0 }).where("codigo", "=", codigo).execute();
    await auditar(tx, { ator, acao: "forma_pagamento.ativar", alvoTipo: "forma_pagamento", alvoId: atual.id, dados: { codigo, ativa } });
    await registrarEvento(tx, "nucleo.FormaPagamentoAlterada", { codigo, ativa });
    return { ...paraForma(atual), ativa };
  });
}
