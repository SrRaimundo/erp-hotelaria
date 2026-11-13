import { sql } from "kysely";
import { auditar } from "../../infra/auditoria.js";
import { obterConfig } from "../../nucleo/pousada.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { ErroDominio } from "../../shared/erros.js";
import { novoId, type UUID } from "../../shared/ids.js";
import { dataLocal } from "../../shared/tempo.js";
import type { Lançamento } from "../modelos/lançamento.js";
import { CATEGORIAS_PAGAR } from "./contas-pagar.js";
import { CATEGORIAS_RECEBER } from "./contas-receber.js";
import { LançamentoService } from "./lançamentos.js";
import type { Usuario } from "./locais.js";
import { rotuloParcela, validarParcelas, type Intervalo, type ParcelaPlano } from "./parcelamento.js";
import { reverterLancamento } from "./reversao.js";

export type ParamsTitulo = {
  tipo: "pagar" | "receber";
  local_id: UUID;
  documento: string;
  valor_total: number;
  intervalo: Intervalo;
  categoria: string;
  fornecedor_id?: UUID;
  cliente_id?: UUID;
  forma_pagamento?: string;
  observacao?: string;
  parcelas: ParcelaPlano[];
};

export type ParcelaTitulo = {
  id: UUID; numero: number; total: number; rotulo: string; vencimento_dia: string; valor: number; pago: number; restante: number;
  situacao: "pendente" | "parcial" | "pago" | "cancelado"; saldo_de: UUID | null;
};
export type TituloDetalhe = {
  id: UUID; tipo: "pagar" | "receber"; local_id: UUID; documento: string; valor_total: number; num_parcelas: number; intervalo: Intervalo;
  status: "ativo" | "cancelado"; pago: number; restante: number; parcelas: ParcelaTitulo[];
  historico: { instante: string; ator: string; acao: string; motivo: string | null }[];
};

const meioDia = (d: string) => new Date(`${d}T12:00:00.000Z`);

/**
 * Título: um documento com várias parcelas. Cada parcela é uma conta própria (lançamento a pagar ou conta a receber manual),
 * paga, recebida e revertida sozinha pelas regras de sempre; o título só agrupa, soma e cancela o que ainda está pendente.
 */
export class TituloService {
  constructor(private ctx: Contexto) {}

  async criar(p: ParamsTitulo, usuario: Usuario): Promise<TituloDetalhe> {
    const documento = p.documento.trim();
    if (!documento) throw new ErroDominio("VALIDACAO_FALHOU", "Informe o documento (ou a descrição) do título.");
    if (!Number.isInteger(p.valor_total) || p.valor_total <= 0) throw new ErroDominio("VALIDACAO_FALHOU", "Valor deve ser positivo.");
    const motivos = validarParcelas(p.valor_total, p.parcelas);
    if (motivos.length) throw new ErroDominio("VALIDACAO_FALHOU", motivos.join(" "));
    return emTransacao(this.ctx, async (tx) => {
      const local = await tx.db.selectFrom("fin_local").select("id").where("id", "=", p.local_id).executeTakeFirst();
      if (!local) throw new ErroDominio("NAO_ENCONTRADO", "Local não encontrado.");
      if (p.tipo === "pagar") {
        if (!(CATEGORIAS_PAGAR as readonly string[]).includes(p.categoria)) throw new ErroDominio("VALIDACAO_FALHOU", "Tipo da conta inválido.");
        if (p.fornecedor_id) {
          const f = await tx.db.selectFrom("fin_fornecedor").select("id").where("id", "=", p.fornecedor_id).where("local_id", "=", p.local_id).executeTakeFirst();
          if (!f) throw new ErroDominio("NAO_ENCONTRADO", "Fornecedor não encontrado neste local.");
        }
      } else {
        if (!(CATEGORIAS_RECEBER as readonly string[]).includes(p.categoria)) throw new ErroDominio("VALIDACAO_FALHOU", "Categoria inválida.");
        const c = p.cliente_id && (await tx.db.selectFrom("fin_cliente").select("id").where("id", "=", p.cliente_id).where("local_id", "=", p.local_id).executeTakeFirst());
        if (!c) throw new ErroDominio("NAO_ENCONTRADO", "Cliente não encontrado neste local.");
        const dup = await tx.db.selectFrom("fin_conta_receber").select("id").where("local_id", "=", p.local_id).where("numero_documento", "=", documento).where("status", "!=", "cancelado").executeTakeFirst();
        if (dup) throw new ErroDominio("VALIDACAO_FALHOU", "Já existe uma conta a receber com este número de documento neste local.");
      }
      const id = novoId();
      const agora = tx.relogio.agora().toISOString();
      const n = p.parcelas.length;
      await tx.db.insertInto("fin_titulo").values({
        id, local_id: p.local_id, tipo: p.tipo, documento, valor_total: p.valor_total, num_parcelas: n, intervalo: p.intervalo, status: "ativo", criado_por: usuario.email, criado_em: agora,
      }).execute();
      for (const [i, parcela] of p.parcelas.entries()) {
        if (p.tipo === "pagar") {
          await new LançamentoService(tx).criar({
            local_id: p.local_id, data: tx.relogio.agora(), tipo: "pagamento", origem: "manual", valor: Dinheiro.de(parcela.valor),
            forma_pagamento: (p.forma_pagamento ?? "boleto") as Lançamento["forma_pagamento"], status: "pendente", descricao: documento, categoria: p.categoria,
            vencimento: meioDia(parcela.vencimento), fornecedor_id: p.fornecedor_id, referencia_tipo: "conta_pagar", titulo_id: id, parcela_num: i + 1, parcela_total: n, usuario,
          });
        } else {
          await tx.db.insertInto("fin_conta_receber").values({
            id: novoId(), local_id: p.local_id, cliente_id: p.cliente_id!, numero_documento: documento, valor_original: parcela.valor, valor_recebido: 0,
            data_vencimento: meioDia(parcela.vencimento).toISOString(), forma_pagamento: p.forma_pagamento ?? "boleto", status: "pendente", conta_destino_id: null,
            lançamentos_id: JSON.stringify([]), origem: "manual", categoria: p.categoria, observacao: p.observacao?.trim() || null, criado_em: agora,
            titulo_id: id, parcela_num: i + 1, parcela_total: n,
          }).execute();
        }
      }
      await auditar(tx, {
        ator: usuario.email, acao: "fin_titulo.criar", alvoTipo: "fin_titulo", alvoId: id,
        dados: { tipo: p.tipo, documento, valor_total: p.valor_total, intervalo: p.intervalo, parcelas: p.parcelas },
      });
      return new TituloService(tx).obter(id);
    });
  }

  async obter(id: UUID): Promise<TituloDetalhe> {
    const t = (await this.ctx.db.selectFrom("fin_titulo").selectAll().where("id", "=", id).executeTakeFirst()) as any;
    if (!t) throw new ErroDominio("NAO_ENCONTRADO", "Título não encontrado.");
    const { fuso } = await obterConfig(this.ctx);
    const dia = (iso: string) => dataLocal(new Date(iso), fuso);
    let parcelas: ParcelaTitulo[];
    if (t.tipo === "pagar") {
      const linhas = (await this.ctx.db.selectFrom("fin_lancamento").selectAll().where("titulo_id", "=", id).execute()) as any[];
      parcelas = linhas.map((l) => ({
        id: l.id, numero: l.parcela_num, total: l.parcela_total, rotulo: rotuloParcela(t.documento, l.parcela_num, l.parcela_total, !!l.parcela_de), vencimento_dia: dia(l.vencimento),
        valor: l.valor, pago: l.status === "confirmado" ? l.valor : 0, restante: l.status === "pendente" ? l.valor : 0,
        situacao: l.status === "cancelado" ? "cancelado" : l.status === "pendente" ? "pendente" : "pago", saldo_de: l.parcela_de ?? null,
      }));
    } else {
      const linhas = (await this.ctx.db.selectFrom("fin_conta_receber").selectAll().where("titulo_id", "=", id).execute()) as any[];
      parcelas = linhas.map((l) => {
        const aberta = l.status === "pendente" || l.status === "parcialmente_recebido";
        return {
          id: l.id, numero: l.parcela_num, total: l.parcela_total, rotulo: rotuloParcela(t.documento, l.parcela_num, l.parcela_total, !!l.parcela_de), vencimento_dia: dia(l.data_vencimento),
          valor: l.valor_original, pago: l.valor_recebido, restante: aberta ? l.valor_original - l.valor_recebido : 0,
          situacao: l.status === "cancelado" ? "cancelado" : l.status === "recebido" ? "pago" : l.status === "parcialmente_recebido" ? "parcial" : "pendente", saldo_de: l.parcela_de ?? null,
        };
      });
    }
    parcelas.sort((a, b) => a.numero - b.numero || Number(!!a.saldo_de) - Number(!!b.saldo_de) || a.vencimento_dia.localeCompare(b.vencimento_dia));
    const alvos = [id, ...parcelas.map((p) => p.id)];
    const hist = (await this.ctx.db.selectFrom("auditoria").select(["instante", "ator", "acao", "motivo"]).where("alvo_id", "in", alvos).orderBy("instante").orderBy(sql`rowid`).execute()) as any[];
    return {
      id: t.id, tipo: t.tipo, local_id: t.local_id, documento: t.documento, valor_total: t.valor_total, num_parcelas: t.num_parcelas, intervalo: t.intervalo, status: t.status,
      pago: parcelas.reduce((s, p) => s + p.pago, 0), restante: parcelas.reduce((s, p) => s + p.restante, 0), parcelas,
      historico: hist.map((h) => ({ instante: h.instante, ator: h.ator, acao: h.acao, motivo: h.motivo ?? null })),
    };
  }

  /** Cancela só o que está pendente (e intocado); parcelas pagas ou parcialmente pagas continuam como estão. */
  async cancelar(id: UUID, o: { motivo: string; supervisorId?: string }, usuario: Usuario): Promise<TituloDetalhe> {
    if (!o.motivo?.trim()) throw new ErroDominio("VALIDACAO_FALHOU", "Motivo é obrigatório.");
    return emTransacao(this.ctx, async (tx) => {
      const t = (await tx.db.selectFrom("fin_titulo").selectAll().where("id", "=", id).executeTakeFirst()) as any;
      if (!t) throw new ErroDominio("NAO_ENCONTRADO", "Título não encontrado.");
      if (t.status === "cancelado") throw new ErroDominio("ESTADO_INVALIDO", "Este título já foi cancelado.");
      let canceladas = 0;
      if (t.tipo === "pagar") {
        const pend = (await tx.db.selectFrom("fin_lancamento").select("id").where("titulo_id", "=", id).where("status", "=", "pendente").execute()) as { id: UUID }[];
        for (const l of pend) await reverterLancamento(tx, l.id, { modo: "cancelar", motivo: o.motivo, supervisorId: o.supervisorId, usuario });
        canceladas = pend.length;
      } else {
        const pend = (await tx.db.selectFrom("fin_conta_receber").select("id").where("titulo_id", "=", id).where("status", "=", "pendente").where("valor_recebido", "=", 0).execute()) as { id: UUID }[];
        for (const r of pend) {
          await tx.db.updateTable("fin_conta_receber").set({ status: "cancelado" }).where("id", "=", r.id).execute();
          await auditar(tx, { ator: usuario.email, acao: "fin_conta_receber.cancelar_manual", alvoTipo: "fin_conta_receber", alvoId: r.id, motivo: o.motivo, supervisorId: o.supervisorId });
        }
        canceladas = pend.length;
      }
      if (canceladas === 0) throw new ErroDominio("ESTADO_INVALIDO", "Não há parcela pendente neste título: tudo já foi pago, recebido ou cancelado.");
      await tx.db.updateTable("fin_titulo").set({ status: "cancelado" }).where("id", "=", id).execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_titulo.cancelar", alvoTipo: "fin_titulo", alvoId: id, motivo: o.motivo, supervisorId: o.supervisorId, dados: { parcelas_canceladas: canceladas } });
      return new TituloService(tx).obter(id);
    });
  }
}
