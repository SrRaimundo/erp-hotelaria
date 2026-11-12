import { auditar } from "../../infra/auditoria.js";
import { obterConfig } from "../../nucleo/pousada.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { ErroDominio } from "../../shared/erros.js";
import { novoId, type UUID } from "../../shared/ids.js";
import { dataLocal, diasEntre, somarDias } from "../../shared/tempo.js";
import type { Lançamento } from "../modelos/lançamento.js";
import { CaixaBancoService } from "./caixa-banco.js";
import { LançamentoService } from "./lançamentos.js";
import type { Usuario } from "./locais.js";

export const TIPOS_CARTAO = ["credito", "debito", "voucher"] as const;
export type TipoCartao = (typeof TIPOS_CARTAO)[number];

export type MovimentoCartao = {
  id: UUID;
  local_id: UUID;
  data: string;
  adquirente: string;
  bandeira: string;
  tipo: TipoCartao;
  valor_bruto: number;
  /** Cópia da condição na criação do movimento: mudar o cadastro depois não altera o histórico. */
  taxa_percentual: number;
  prazo_dias: number;
  valor_taxa: number;
  valor_liquido: number;
  previsao: string;
  status: "a_receber" | "baixado" | "cancelado";
  lancamento_id: UUID;
  condicao_id: UUID | null;
  /** 1 = entrou sem condição de cobrança cadastrada (ou ambígua): precisa de revisão antes da baixa. */
  revisar: number;
  conta_destino_id: UUID | null;
  baixado_em: string | null;
};

export type CondicaoCartao = {
  id: UUID; local_id: UUID; adquirente: string; bandeira: string; tipo: TipoCartao; prazo_dias: number; taxa_percentual: number; ativo: boolean;
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

const paraCondicao = (c: any): CondicaoCartao => ({ ...c, ativo: !!c.ativo });

/** Cadastro Cobrança: condições do cartão por adquirente, bandeira e tipo (prazo D+N e taxa negociados). */
export class CondicoesCartaoService {
  constructor(private ctx: Contexto) {}

  async listar(local_id: UUID): Promise<CondicaoCartao[]> {
    const l = (await this.ctx.db.selectFrom("fin_condicao_cartao").selectAll().where("local_id", "=", local_id).orderBy("adquirente").orderBy("bandeira").orderBy("tipo").orderBy("id").execute()) as any[];
    return l.map(paraCondicao);
  }

  async obter(id: UUID): Promise<CondicaoCartao> {
    const c = await this.ctx.db.selectFrom("fin_condicao_cartao").selectAll().where("id", "=", id).executeTakeFirst();
    if (!c) throw new ErroDominio("NAO_ENCONTRADO", "Condição de cobrança não encontrada.");
    return paraCondicao(c);
  }

  async criar(p: Omit<CondicaoCartao, "id" | "ativo">, usuario: Usuario): Promise<CondicaoCartao> {
    return emTransacao(this.ctx, async (tx) => {
      const l = await tx.db.selectFrom("fin_local").select("id").where("id", "=", p.local_id).executeTakeFirst();
      if (!l) throw new ErroDominio("NAO_ENCONTRADO", "Local não encontrado.");
      const id = novoId();
      await tx.db.insertInto("fin_condicao_cartao").values({ id, ...p, ativo: 1, criado_em: tx.relogio.agora().toISOString() }).execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_condicao_cartao.criar", alvoTipo: "fin_condicao_cartao", alvoId: id, dados: p });
      return new CondicoesCartaoService(tx).obter(id);
    });
  }

  async atualizar(id: UUID, d: Partial<Pick<CondicaoCartao, "adquirente" | "bandeira" | "tipo" | "prazo_dias" | "taxa_percentual" | "ativo">>, usuario: Usuario): Promise<CondicaoCartao> {
    return emTransacao(this.ctx, async (tx) => {
      const antes = await new CondicoesCartaoService(tx).obter(id);
      const depois = { ...antes, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) } as CondicaoCartao;
      await tx.db.updateTable("fin_condicao_cartao").set({
        adquirente: depois.adquirente, bandeira: depois.bandeira, tipo: depois.tipo, prazo_dias: depois.prazo_dias, taxa_percentual: depois.taxa_percentual, ativo: depois.ativo ? 1 : 0,
      }).where("id", "=", id).execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_condicao_cartao.atualizar", alvoTipo: "fin_condicao_cartao", alvoId: id, dados: { antes, depois } });
      return depois;
    });
  }
}

export type ParamsMovimentoCartao = {
  local_id: UUID;
  data: string; // AAAA-MM-DD
  valor: number;
  informado: "bruto" | "liquido";
  /** Condição cadastrada (preferida) ou, sem ela, bandeira, tipo, taxa e prazo (ou previsão) informados na hora. */
  condicao_id?: UUID;
  adquirente?: string;
  bandeira?: string;
  tipo?: TipoCartao;
  taxa_percentual?: number;
  prazo_dias?: number;
  previsao?: string;
};

/** Cartão (crédito, débito, voucher) vindo do PDV: a receber da operadora até a baixa no Caixa/Banco. */
export class CartaoService {
  constructor(private ctx: Contexto) {}

  /**
   * Lançamento já existente (pagamento da hospedagem) passa a esperar a operadora. A hospedagem só informa débito ou crédito:
   * com exatamente uma condição ativa do tipo no local, usa essa; sem condição (ou com mais de uma) entra SINALIZADO para revisão,
   * sem taxa nem prazo inventados.
   */
  async registrarDeLancamento(l: Lançamento, tipo: TipoCartao): Promise<MovimentoCartao> {
    return emTransacao(this.ctx, async (tx) => {
      const id = novoId();
      const dia = dataLocal(l.data, (await obterConfig(tx)).fuso);
      const conds = (await tx.db.selectFrom("fin_condicao_cartao").selectAll().where("local_id", "=", l.local_id).where("tipo", "=", tipo).where("ativo", "=", 1).execute()) as any[];
      const c = conds.length === 1 ? conds[0] : null;
      const taxa = c ? c.taxa_percentual : 0;
      const v = calcularCartao(l.valor.centavos, "bruto", taxa);
      await tx.db.insertInto("fin_cartao_movimento").values({
        id, local_id: l.local_id, data: dia, adquirente: c?.adquirente ?? "", bandeira: c?.bandeira ?? "Não informada", tipo,
        valor_bruto: v.bruto, taxa_percentual: taxa, prazo_dias: c?.prazo_dias ?? 0, valor_taxa: v.taxa, valor_liquido: v.liquido,
        previsao: somarDias(dia, c?.prazo_dias ?? 0), status: "a_receber", lancamento_id: l.id, condicao_id: c?.id ?? null, revisar: c ? 0 : 1,
        conta_destino_id: null, baixado_em: null, criado_em: tx.relogio.agora().toISOString(),
      }).execute();
      return new CartaoService(tx).obter(id);
    });
  }

  async criar(p: ParamsMovimentoCartao, usuario: Usuario): Promise<MovimentoCartao> {
    return emTransacao(this.ctx, async (tx) => {
      let adquirente = p.adquirente?.trim() ?? "";
      let bandeira = p.bandeira?.trim() ?? "";
      let tipo = p.tipo;
      let taxa = p.taxa_percentual;
      let prazo = p.prazo_dias;
      let condicao: UUID | null = null;
      if (p.condicao_id) {
        const c = await new CondicoesCartaoService(tx).obter(p.condicao_id);
        if (c.local_id !== p.local_id) throw new ErroDominio("VALIDACAO_FALHOU", "A condição de cobrança é de outro local.");
        if (!c.ativo) throw new ErroDominio("ESTADO_INVALIDO", "A condição de cobrança está desativada.");
        ({ adquirente, bandeira, tipo, taxa_percentual: taxa, prazo_dias: prazo } = c);
        condicao = c.id;
      }
      if (!bandeira) throw new ErroDominio("VALIDACAO_FALHOU", "Bandeira é obrigatória.");
      if (!tipo || taxa === undefined) throw new ErroDominio("VALIDACAO_FALHOU", "Informe a condição de cobrança ou o tipo e a taxa.");
      if (prazo === undefined && !p.previsao) throw new ErroDominio("VALIDACAO_FALHOU", "Informe o prazo ou a previsão de recebimento.");
      const previsao = p.previsao ?? somarDias(p.data, prazo!);
      prazo = prazo ?? diasEntre(p.data, previsao);
      const v = calcularCartao(p.valor, p.informado, taxa);
      const lanc = await new LançamentoService(tx).criar({
        local_id: p.local_id, data: new Date(`${p.data}T12:00:00.000Z`), tipo: "recebimento", origem: "manual", valor: Dinheiro.de(v.bruto),
        forma_pagamento: tipo, descricao: `Cartão ${bandeira}`, referencia_tipo: "cartao", usuario,
      });
      const id = novoId();
      await tx.db.insertInto("fin_cartao_movimento").values({
        id, local_id: p.local_id, data: p.data, adquirente, bandeira, tipo, valor_bruto: v.bruto, taxa_percentual: taxa, prazo_dias: prazo,
        valor_taxa: v.taxa, valor_liquido: v.liquido, previsao, status: "a_receber", lancamento_id: lanc.id, condicao_id: condicao, revisar: 0,
        conta_destino_id: null, baixado_em: null, criado_em: tx.relogio.agora().toISOString(),
      }).execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_cartao.criar", alvoTipo: "fin_cartao_movimento", alvoId: id, dados: { ...p, ...v, taxa, prazo, previsao } });
      return new CartaoService(tx).obter(id);
    });
  }

  /** Baixa: o líquido entra na conta escolhida e o lançamento de origem fica liquidado; a taxa vira despesa só de registro. */
  async baixar(id: UUID, conta_id: UUID, o: { taxa_percentual?: number; condicao_id?: UUID }, usuario: Usuario): Promise<MovimentoCartao> {
    return emTransacao(this.ctx, async (tx) => {
      const svc = new CartaoService(tx);
      const m = await svc.obter(id);
      if (m.status !== "a_receber") throw new ErroDominio("ESTADO_INVALIDO", m.status === "baixado" ? "Movimento já baixado." : "Movimento cancelado.");
      const conta = await tx.db.selectFrom("fin_conta_bancaria").select("id").where("id", "=", conta_id).where("local_id", "=", m.local_id).executeTakeFirst();
      if (!conta) throw new ErroDominio("NAO_ENCONTRADO", "Conta não encontrada neste local.");
      let { adquirente, bandeira, prazo_dias, previsao } = m;
      let taxa = o.taxa_percentual ?? m.taxa_percentual;
      let condicao = m.condicao_id;
      if (o.condicao_id) {
        const c = await new CondicoesCartaoService(tx).obter(o.condicao_id);
        if (c.local_id !== m.local_id) throw new ErroDominio("VALIDACAO_FALHOU", "A condição de cobrança é de outro local.");
        if (c.tipo !== m.tipo) throw new ErroDominio("VALIDACAO_FALHOU", "A condição escolhida é de outro tipo de cartão.");
        ({ adquirente, bandeira, prazo_dias } = c);
        taxa = c.taxa_percentual;
        condicao = c.id;
        previsao = somarDias(m.data, c.prazo_dias);
      } else if (m.revisar && o.taxa_percentual === undefined) {
        throw new ErroDominio("ESTADO_INVALIDO", "Este movimento entrou sem condição de cobrança cadastrada. Escolha a condição (ou informe a taxa) antes de baixar.");
      }
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
          status: "liquidado", descricao: `Taxa do cartão ${bandeira} (${m.tipo})`, categoria: "taxa_cartao",
          referencia_id: m.id, referencia_tipo: "taxa_cartao", usuario,
        });
      }
      await tx.db.updateTable("fin_lancamento").set({ status: "liquidado", atualizado_por: usuario.email, atualizado_em: agora.toISOString() }).where("id", "=", m.lancamento_id).execute();
      await tx.db.updateTable("fin_cartao_movimento").set({
        status: "baixado", adquirente, bandeira, prazo_dias, previsao, condicao_id: condicao, revisar: 0, taxa_percentual: taxa, valor_taxa: v.taxa,
        valor_liquido: v.liquido, conta_destino_id: conta_id, baixado_em: agora.toISOString(),
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
