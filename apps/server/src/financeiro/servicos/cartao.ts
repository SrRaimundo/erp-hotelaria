import { obterConfig } from "../../nucleo/pousada.js";
import { dataLocal, somarDias } from "../../shared/tempo.js";
import { auditar } from "../../infra/auditoria.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { ErroDominio } from "../../shared/erros.js";
import { novoId, type UUID } from "../../shared/ids.js";
import type { Lançamento } from "../modelos/lançamento.js";
import { CaixaBancoService } from "./caixa-banco.js";
import { LançamentoService } from "./lançamentos.js";
import type { Usuario } from "./locais.js";

export const TIPOS_CARTAO = ["credito", "debito", "voucher"] as const;
export type TipoCartao = (typeof TIPOS_CARTAO)[number];
/** Dias até o dinheiro cair, quando a operadora não informa a previsão. */
export const PRAZO_PREVISAO: Record<TipoCartao, number> = { credito: 30, debito: 1, voucher: 30 };

export type MovimentoCartao = {
  id: UUID;
  local_id: UUID;
  data: string;
  bandeira: string;
  tipo: TipoCartao;
  valor_bruto: number;
  taxa_percentual: number;
  valor_taxa: number;
  valor_liquido: number;
  previsao: string;
  status: "a_receber" | "baixado" | "cancelado";
  lancamento_id: UUID;
  conta_destino_id: UUID | null;
  baixado_em: string | null;
};

/** Valores em centavos a partir do que a operadora informou: o total é bruto ou já líquido da taxa. */
export function calcularCartao(valor: number, informado: "bruto" | "liquido", taxa_percentual: number): { bruto: number; taxa: number; liquido: number } {
  if (!Number.isInteger(valor) || valor <= 0) throw new ErroDominio("VALIDACAO_FALHOU", "Valor deve ser positivo.");
  if (!(taxa_percentual >= 0 && taxa_percentual < 100)) throw new ErroDominio("VALIDACAO_FALHOU", "Taxa deve estar entre 0% e 100%.");
  if (informado === "bruto") {
    const taxa = Math.round((valor * taxa_percentual) / 100);
    return { bruto: valor, taxa, liquido: valor - taxa };
  }
  const bruto = Math.round(valor / (1 - taxa_percentual / 100));
  return { bruto, taxa: bruto - valor, liquido: valor };
}


export type ParamsMovimentoCartao = {
  local_id: UUID;
  data: string; // AAAA-MM-DD
  bandeira: string;
  tipo: TipoCartao;
  valor: number;
  informado: "bruto" | "liquido";
  taxa_percentual: number;
  previsao?: string;
};

/** Cartão (crédito, débito, voucher) vindo do PDV: a receber da operadora até a baixa no Caixa/Banco. */
export class CartaoService {
  constructor(private ctx: Contexto) {}

  /** Lançamento já existente (ex.: pagamento da hospedagem) passa a esperar a operadora. */
  async registrarDeLancamento(l: Lançamento, tipo: TipoCartao, bandeira: string): Promise<MovimentoCartao> {
    return emTransacao(this.ctx, async (tx) => {
      const id = novoId();
      const dia = dataLocal(l.data, (await obterConfig(tx)).fuso);
      await tx.db.insertInto("fin_cartao_movimento").values({
        id, local_id: l.local_id, data: dia, bandeira, tipo, valor_bruto: l.valor.centavos, taxa_percentual: 0, valor_taxa: 0,
        valor_liquido: l.valor.centavos, previsao: somarDias(dia, PRAZO_PREVISAO[tipo]), status: "a_receber",
        lancamento_id: l.id, conta_destino_id: null, baixado_em: null, criado_em: tx.relogio.agora().toISOString(),
      }).execute();
      return new CartaoService(tx).obter(id);
    });
  }

  async criar(p: ParamsMovimentoCartao, usuario: Usuario): Promise<MovimentoCartao> {
    if (!p.bandeira.trim()) throw new ErroDominio("VALIDACAO_FALHOU", "Bandeira é obrigatória.");
    const v = calcularCartao(p.valor, p.informado, p.taxa_percentual);
    return emTransacao(this.ctx, async (tx) => {
      const data = new Date(`${p.data}T12:00:00.000Z`);
      const lanc = await new LançamentoService(tx).criar({
        local_id: p.local_id, data, tipo: "recebimento", origem: "manual", valor: Dinheiro.de(v.bruto),
        forma_pagamento: p.tipo, descricao: `Cartão ${p.bandeira.trim()}`, referencia_tipo: "cartao", usuario,
      });
      const id = novoId();
      await tx.db.insertInto("fin_cartao_movimento").values({
        id, local_id: p.local_id, data: p.data, bandeira: p.bandeira.trim(), tipo: p.tipo, valor_bruto: v.bruto,
        taxa_percentual: p.taxa_percentual, valor_taxa: v.taxa, valor_liquido: v.liquido,
        previsao: p.previsao ?? somarDias(p.data, PRAZO_PREVISAO[p.tipo]), status: "a_receber",
        lancamento_id: lanc.id, conta_destino_id: null, baixado_em: null, criado_em: tx.relogio.agora().toISOString(),
      }).execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_cartao.criar", alvoTipo: "fin_cartao_movimento", alvoId: id, dados: { ...p, ...v } });
      return new CartaoService(tx).obter(id);
    });
  }

  /** Baixa: o líquido entra na conta escolhida e o lançamento de origem fica liquidado. */
  async baixar(id: UUID, conta_id: UUID, taxa_percentual: number | undefined, usuario: Usuario): Promise<MovimentoCartao> {
    return emTransacao(this.ctx, async (tx) => {
      const svc = new CartaoService(tx);
      const m = await svc.obter(id);
      if (m.status !== "a_receber") throw new ErroDominio("ESTADO_INVALIDO", m.status === "baixado" ? "Movimento já baixado." : "Movimento cancelado.");
      const conta = await tx.db.selectFrom("fin_conta_bancaria").select("id").where("id", "=", conta_id).where("local_id", "=", m.local_id).executeTakeFirst();
      if (!conta) throw new ErroDominio("NAO_ENCONTRADO", "Conta não encontrada neste local.");
      const taxa = taxa_percentual ?? m.taxa_percentual;
      const v = calcularCartao(m.valor_bruto, "bruto", taxa);
      const agora = tx.relogio.agora();
      const lancs = new LançamentoService(tx);
      const lanc = await lancs.obter(m.lancamento_id);
      // Só o líquido entra na conta (na data da baixa); a data da venda continua no lançamento.
      await new CaixaBancoService(tx).criarMovimento(lanc, conta_id, usuario, Dinheiro.de(v.liquido), agora);
      if (v.taxa > 0) {
        // Despesa só de registro: aparece em Contas a Pagar já quitada, sem movimento de caixa (o banco já recebeu o líquido).
        await lancs.criar({
          local_id: m.local_id, data: agora, tipo: "pagamento", origem: "manual", valor: Dinheiro.de(v.taxa), forma_pagamento: "transferencia",
          status: "liquidado", descricao: `Taxa do cartão ${m.bandeira} (${m.tipo})`, categoria: "taxa_cartao",
          referencia_id: m.id, referencia_tipo: "taxa_cartao", usuario,
        });
      }
      await tx.db.updateTable("fin_lancamento").set({ status: "liquidado", atualizado_por: usuario.email, atualizado_em: agora.toISOString() }).where("id", "=", m.lancamento_id).execute();
      await tx.db.updateTable("fin_cartao_movimento").set({
        status: "baixado", taxa_percentual: taxa, valor_taxa: v.taxa, valor_liquido: v.liquido, conta_destino_id: conta_id, baixado_em: agora.toISOString(),
      }).where("id", "=", id).execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_cartao.baixar", alvoTipo: "fin_cartao_movimento", alvoId: id, dados: { conta_id, ...v } });
      return svc.obter(id);
    });
  }

  async listar(local_id: UUID): Promise<MovimentoCartao[]> {
    return (await this.ctx.db.selectFrom("fin_cartao_movimento").selectAll().where("local_id", "=", local_id).orderBy("previsao").orderBy("id").execute()) as MovimentoCartao[];
  }

  async obter(id: UUID): Promise<MovimentoCartao> {
    const m = await this.ctx.db.selectFrom("fin_cartao_movimento").selectAll().where("id", "=", id).executeTakeFirst();
    if (!m) throw new ErroDominio("NAO_ENCONTRADO", "Movimento de cartão não encontrado.");
    return m as MovimentoCartao;
  }
}
