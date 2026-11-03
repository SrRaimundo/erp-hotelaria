import { auditar } from "../../infra/auditoria.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { ErroDominio } from "../../shared/erros.js";
import type { UUID } from "../../shared/ids.js";
import type { Lançamento } from "../modelos/lançamento.js";
import { CaixaBancoService } from "./caixa-banco.js";
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
    if (l.status === "cancelado") throw new ErroDominio("ESTADO_INVALIDO", "Lançamento já cancelado.");
    const jaEstornado = await tx.db.selectFrom("fin_lancamento").select("id").where("referencia_id", "=", id).where("referencia_tipo", "=", "estorno").executeTakeFirst();
    if (jaEstornado) throw new ErroDominio("ESTADO_INVALIDO", "Lançamento já estornado.");

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
    if (l.referencia_tipo === "conta_receber" && l.referencia_id) await desfazerRecebimento(tx, l);
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

async function desfazerRecebimento(tx: Contexto, l: Lançamento): Promise<void> {
  const rec = (await tx.db.selectFrom("fin_conta_receber").selectAll().where("id", "=", l.referencia_id!).executeTakeFirst()) as any;
  if (!rec) return;
  const recebido = Math.max(0, rec.valor_recebido - l.valor.centavos);
  const lista = (rec["lançamentos_id"] ? (JSON.parse(rec["lançamentos_id"]) as string[]) : []).filter((x) => x !== l.id);
  await tx.db
    .updateTable("fin_conta_receber")
    .set({ valor_recebido: recebido, status: recebido === 0 ? "pendente" : recebido >= rec.valor_original ? "recebido" : "parcialmente_recebido", "lançamentos_id": JSON.stringify(lista) })
    .where("id", "=", rec.id)
    .execute();
  await tx.db
    .updateTable("fin_faturamento")
    .set({ status: recebido === 0 ? "aberto" : recebido >= rec.valor_original ? "pago" : "parcialmente_pago", "lançamentos_id": JSON.stringify(lista) })
    .where("local_id", "=", rec.local_id)
    .where("numero_documento", "=", rec.numero_documento)
    .execute();
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
