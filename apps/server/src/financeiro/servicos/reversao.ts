import { auditar } from "../../infra/auditoria.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { ErroDominio } from "../../shared/erros.js";
import type { UUID } from "../../shared/ids.js";
import type { Lançamento } from "../modelos/lançamento.js";
import { CaixaBancoService } from "./caixa-banco.js";
import { atualizarFaturaDoDocumento, numeroBase } from "./contas-receber.js";
import { LançamentoService } from "./lançamentos.js";
import type { Usuario } from "./locais.js";

export type OpcoesReversao = {
  /** cancelar: o lançamento passa a "cancelado"; estornar: gera o lançamento oposto e o original fica como está. */
  modo: "cancelar" | "estornar";
  motivo: string;
  supervisorId?: string;
  usuario: Usuario;
  /** Reversão disparada pelo próprio sistema (estorno da hospedagem, remoção da taxa de cartão): dispensa a trava de registros automáticos. */
  interno?: boolean;
};

/**
 * Regra única de reversão (cancelar e estornar passam por aqui; nunca duas vezes no mesmo lançamento):
 * 1. devolve ao Caixa/Banco o efeito líquido dos movimentos do lançamento;
 * 2. recebimento de conta a receber: devolve valor recebido, situação e fatura ao estado anterior;
 * 3. cartão: o movimento passa a cancelado (ainda a receber ou já baixado) e a taxa registrada some.
 */
export async function reverterLancamento(ctx: Contexto, id: UUID, o: OpcoesReversao): Promise<Lançamento> {
  if (!o.motivo?.trim()) throw new ErroDominio("VALIDACAO_FALHOU", "Motivo é obrigatório.");
  return emTransacao(ctx, async (tx) => {
    const lancs = new LançamentoService(tx);
    const l = await lancs.obter(id);
    if (l.referencia_tipo === "estorno") throw new ErroDominio("ESTADO_INVALIDO", "Estorno não pode ser estornado.");
    if (l.referencia_tipo === "taxa_cartao" && !o.interno) {
      throw new ErroDominio("ESTADO_INVALIDO", "A taxa do cartão é um registro automático: ela some quando a baixa do cartão for estornada.");
    }
    if (!o.interno) {
      if (l.referencia_tipo === "hospedagem_pagamento") {
        throw new ErroDominio("ESTADO_INVALIDO", "Este pagamento veio da hospedagem. Estorne-o na hospedagem (conta do hóspede): o Financeiro acompanha sozinho.");
      }
      const cm = (await tx.db.selectFrom("fin_cartao_movimento").select("status").where("lancamento_id", "=", id).executeTakeFirst()) as { status: string } | undefined;
      if (cm?.status === "baixado") {
        throw new ErroDominio("ESTADO_INVALIDO", "Este cartão já foi baixado. Use \"Estornar baixa\" em Cartão de Crédito para devolvê-lo a \"a receber\".");
      }
    }
    if (l.status === "cancelado") throw new ErroDominio("ESTADO_INVALIDO", "Lançamento já cancelado.");
    const jaEstornado = await tx.db.selectFrom("fin_lancamento").select("id").where("referencia_id", "=", id).where("referencia_tipo", "=", "estorno").executeTakeFirst();
    if (jaEstornado) throw new ErroDominio("ESTADO_INVALIDO", "Lançamento já estornado.");
    if (l.referencia_tipo === "conta_pagar") return reverterContaPagar(tx, l, o);

    const agora = tx.relogio.agora().toISOString();
    let destino: UUID = id;
    let resultado: UUID = id;
    if (o.modo === "cancelar") {
      await tx.db
        .updateTable("fin_lancamento")
        .set({ status: "cancelado", motivo_cancelamento: o.motivo, atualizado_por: o.usuario.email, atualizado_em: agora })
        .where("id", "=", id)
        .execute();
    } else {
      const oposto = l.tipo === "recebimento" ? "pagamento" : l.tipo === "pagamento" ? "recebimento" : l.tipo;
      const novo = await lancs.criar({
        local_id: l.local_id, data: tx.relogio.agora(), tipo: oposto, origem: l.origem, valor: l.valor, forma_pagamento: l.forma_pagamento,
        referencia_id: id, referencia_tipo: "estorno", usuario: o.usuario,
      });
      await tx.db.updateTable("fin_lancamento").set({ motivo_cancelamento: o.motivo }).where("id", "=", novo.id).execute();
      destino = novo.id;
      resultado = novo.id;
    }

    await new CaixaBancoService(tx).reverterMovimentos(id, destino, o.usuario);
    if (l.referencia_tipo === "conta_receber" && l.referencia_id) await desfazerRecebimento(tx, l, o);
    await desfazerCartao(tx, id, o);

    await auditar(tx, {
      ator: o.usuario.email,
      acao: o.modo === "cancelar" ? "fin_lancamento.cancelar" : "fin_lancamento.estornar",
      alvoTipo: "fin_lancamento",
      alvoId: id,
      motivo: o.motivo,
      supervisorId: o.supervisorId,
      dados: { motivo: o.motivo, dispositivo: o.usuario.dispositivo, ...(o.modo === "estornar" ? { estorno_id: destino } : {}) },
    });
    return lancs.obter(resultado);
  });
}

async function parcelaTocada(tx: Contexto, tabela: "fin_conta_receber" | "fin_lancamento", f: any): Promise<boolean> {
  if (f.status !== "pendente" || (f.valor_recebido ?? 0) > 0) return true;
  const neta = await tx.db.selectFrom(tabela).select("id").where("parcela_de", "=", f.id).where("status", "!=", "cancelado").executeTakeFirst();
  return !!neta;
}

const RECUSA_PARCELA = "A parcela do saldo deste pagamento parcial já teve movimento (pagamento, recebimento ou nova divisão). Estorne antes o que foi feito nela e tente de novo.";

async function desfazerRecebimento(tx: Contexto, l: Lançamento, o: OpcoesReversao): Promise<void> {
  const rec = (await tx.db.selectFrom("fin_conta_receber").selectAll().where("id", "=", l.referencia_id!).executeTakeFirst()) as any;
  if (!rec) return;
  let valorOriginal: number = rec.valor_original;
  let valorTotal: number | null = rec.valor_total ?? null;
  if (valorTotal !== null) {
    // Pagamento parcial: a parcela do saldo só some se ninguém mexeu nela.
    const filhas = (await tx.db.selectFrom("fin_conta_receber").selectAll().where("parcela_de", "=", rec.id).where("status", "!=", "cancelado").execute()) as any[];
    for (const f of filhas) if (await parcelaTocada(tx, "fin_conta_receber", f)) throw new ErroDominio("ESTADO_INVALIDO", RECUSA_PARCELA);
    for (const f of filhas) {
      await tx.db.updateTable("fin_conta_receber").set({ status: "cancelado" }).where("id", "=", f.id).execute();
      await auditar(tx, { ator: o.usuario.email, acao: "fin_conta_receber.cancelar_parcela", alvoTipo: "fin_conta_receber", alvoId: f.id, motivo: o.motivo });
    }
    valorOriginal = valorTotal;
    valorTotal = null;
  }
  const recebido = Math.max(0, rec.valor_recebido - l.valor.centavos);
  const lista = (rec["lançamentos_id"] ? (JSON.parse(rec["lançamentos_id"]) as string[]) : []).filter((x) => x !== l.id);
  await tx.db
    .updateTable("fin_conta_receber")
    .set({
      valor_original: valorOriginal, valor_total: valorTotal, valor_recebido: recebido,
      status: recebido === 0 ? "pendente" : recebido >= valorOriginal ? "recebido" : "parcialmente_recebido", "lançamentos_id": JSON.stringify(lista),
    })
    .where("id", "=", rec.id)
    .execute();
  await atualizarFaturaDoDocumento(tx, rec.local_id, numeroBase(rec.numero_documento));
}

/**
 * Conta a pagar: estornar/cancelar a conta PAGA desfaz o pagamento (o dinheiro volta) e a conta volta a pendente com o valor cheio original;
 * num pagamento parcial a parcela do saldo é removida (se intocada) e seu valor volta ao original. Conta ainda pendente só se cancela.
 */
async function reverterContaPagar(tx: Contexto, l: Lançamento, o: OpcoesReversao): Promise<Lançamento> {
  const lancs = new LançamentoService(tx);
  const agora = tx.relogio.agora().toISOString();
  if (l.status !== "confirmado") {
    if (o.modo === "estornar") {
      throw new ErroDominio("ESTADO_INVALIDO", "Esta conta ainda não foi paga: não há pagamento para estornar. Use Cancelar se ela não é mais devida.");
    }
    await tx.db.updateTable("fin_lancamento").set({ status: "cancelado", motivo_cancelamento: o.motivo, atualizado_por: o.usuario.email, atualizado_em: agora }).where("id", "=", l.id).execute();
    await auditar(tx, { ator: o.usuario.email, acao: "fin_lancamento.cancelar", alvoTipo: "fin_lancamento", alvoId: l.id, motivo: o.motivo, supervisorId: o.supervisorId, dados: { dispositivo: o.usuario.dispositivo } });
    return lancs.obter(l.id);
  }
  await desfazerParcelaPagar(tx, l, o);
  await new CaixaBancoService(tx).reverterMovimentos(l.id, l.id, o.usuario);
  await tx.db
    .updateTable("fin_lancamento")
    .set({ status: "pendente", valor: l.valor_total ?? l.valor.centavos, valor_total: null, motivo_cancelamento: null, atualizado_por: o.usuario.email, atualizado_em: agora })
    .where("id", "=", l.id)
    .execute();
  await auditar(tx, {
    ator: o.usuario.email, acao: "fin_conta_pagar.estornar_pagamento", alvoTipo: "fin_lancamento", alvoId: l.id, motivo: o.motivo, supervisorId: o.supervisorId,
    dados: { valor_pago: l.valor.centavos, valor_devido: l.valor_total ?? l.valor.centavos },
  });
  return lancs.obter(l.id);
}

/** Pagamento parcial de conta a pagar: a parcela do saldo é removida junto, se intocada; senão, recusa. */
async function desfazerParcelaPagar(tx: Contexto, l: Lançamento, o: OpcoesReversao): Promise<void> {
  const filhas = (await tx.db.selectFrom("fin_lancamento").selectAll().where("parcela_de", "=", l.id).where("status", "!=", "cancelado").execute()) as any[];
  for (const f of filhas) if (await parcelaTocada(tx, "fin_lancamento", f)) throw new ErroDominio("ESTADO_INVALIDO", RECUSA_PARCELA);
  for (const f of filhas) {
    await tx.db.updateTable("fin_lancamento").set({ status: "cancelado", motivo_cancelamento: o.motivo, atualizado_por: o.usuario.email, atualizado_em: tx.relogio.agora().toISOString() }).where("id", "=", f.id).execute();
    await auditar(tx, { ator: o.usuario.email, acao: "fin_lancamento.cancelar_parcela", alvoTipo: "fin_lancamento", alvoId: f.id, motivo: o.motivo });
  }
}

async function desfazerCartao(tx: Contexto, lancamentoId: UUID, o: OpcoesReversao): Promise<void> {
  const mov = (await tx.db.selectFrom("fin_cartao_movimento").select("id").where("lancamento_id", "=", lancamentoId).where("status", "in", ["a_receber", "baixado"]).executeTakeFirst()) as { id: UUID } | undefined;
  if (!mov) return;
  await tx.db.updateTable("fin_cartao_movimento").set({ status: "cancelado" }).where("id", "=", mov.id).execute();
  // A taxa registrada (sem movimento de caixa) some junto com a baixa.
  const taxa = (await tx.db.selectFrom("fin_lancamento").select("id").where("referencia_tipo", "=", "taxa_cartao").where("referencia_id", "=", mov.id).where("status", "!=", "cancelado").executeTakeFirst()) as { id: UUID } | undefined;
  if (taxa) {
    await tx.db
      .updateTable("fin_lancamento")
      .set({ status: "cancelado", motivo_cancelamento: o.motivo, atualizado_por: o.usuario.email, atualizado_em: tx.relogio.agora().toISOString() })
      .where("id", "=", taxa.id)
      .execute();
  }
}
