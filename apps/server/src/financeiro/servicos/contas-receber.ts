import { sql } from "kysely";
import { auditar } from "../../infra/auditoria.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { ErroDominio } from "../../shared/erros.js";
import { novoId, type UUID } from "../../shared/ids.js";
import type { ContaReceber } from "../modelos/conta-receber.js";
import type { Lançamento } from "../modelos/lançamento.js";
import { CaixaBancoService } from "./caixa-banco.js";
import { FaturamentoService } from "./faturamento.js";
import { LançamentoService } from "./lançamentos.js";
import type { Usuario } from "./locais.js";

const FORMA_LANCAMENTO: Record<ContaReceber["forma_pagamento"], Lançamento["forma_pagamento"]> = {
  boleto: "boleto",
  pix: "pix",
  deposito: "transferencia",
  dinheiro: "dinheiro",
  transferencia: "transferencia",
};

function paraContaReceber(c: any): ContaReceber {
  const original = Dinheiro.de(c.valor_original);
  const recebido = Dinheiro.de(c.valor_recebido);
  return {
    id: c.id,
    local_id: c.local_id,
    cliente_id: c.cliente_id,
    numero_documento: c.numero_documento,
    valor_original: original,
    valor_recebido: recebido,
    valor_pendente: original.menos(recebido),
    data_emissao: new Date(c.criado_em),
    data_vencimento: new Date(c.data_vencimento),
    forma_pagamento: c.forma_pagamento,
    conta_destino_id: c.conta_destino_id ?? undefined,
    status: c.status,
    lançamentos_id: c.lançamentos_id ? JSON.parse(c.lançamentos_id) : [],
  };
}

/** Documento da fatura: as parcelas de saldo levam o sufixo -P1, -P2... sobre o número do documento original. */
export const numeroBase = (numero: string): string => numero.replace(/-P\d+$/, "");

/**
 * Situação da fatura a partir de todas as parcelas do documento: paga só quando todas estão quitadas.
 * Cobre o documento agrupado (vários fechamentos com o mesmo número).
 */
export async function atualizarFaturaDoDocumento(tx: Contexto, local_id: UUID, base: string): Promise<void> {
  const linhas = (await tx.db
    .selectFrom("fin_conta_receber")
    .select(["status", "valor_recebido", "lançamentos_id"])
    .where("local_id", "=", local_id)
    .where((eb) => eb.or([eb("numero_documento", "=", base), eb("numero_documento", "like", `${base}-P%`)]))
    .where("status", "!=", "cancelado")
    .execute()) as any[];
  if (linhas.length === 0) return;
  const todos = linhas.every((l) => l.status === "recebido");
  const algum = linhas.some((l) => l.valor_recebido > 0);
  const lancamentos = linhas.flatMap((l) => (l["lançamentos_id"] ? (JSON.parse(l["lançamentos_id"]) as string[]) : []));
  await tx.db
    .updateTable("fin_faturamento")
    .set({ status: todos ? "pago" : algum ? "parcialmente_pago" : "aberto", "lançamentos_id": JSON.stringify(lancamentos) })
    .where("local_id", "=", local_id)
    .where("numero_documento", "=", base)
    .execute();
}

export const CATEGORIAS_RECEBER = ["servico", "aluguel", "evento", "convenio", "outros"] as const;
const MSG_HOSPEDAGEM = "Esta conta a receber veio da hospedagem (fatura). Corrija na hospedagem: o Financeiro não a altera nem a cancela.";
const MSG_PENDENTE = "Só é possível enquanto a conta está pendente, sem nenhum recebimento nem parcela de saldo em andamento.";

export type DadosManual = { cliente_id: UUID; numero_documento: string; valor: number; vencimento: Date; categoria: (typeof CATEGORIAS_RECEBER)[number]; observacao?: string; forma_pagamento?: "boleto" | "pix" | "deposito" | "dinheiro" };

export class ContasReceberService {
  constructor(private ctx: Contexto) {}

  async criarRecebivel(
    faturamento_id: UUID,
    cliente_id: UUID,
    local_id: UUID,
    numero_documento: string,
    valor_original: Dinheiro,
    data_vencimento: Date,
    usuario: Usuario,
  ): Promise<ContaReceber> {
    if (!Number.isInteger(valor_original.centavos) || valor_original.centavos <= 0) {
      throw new ErroDominio("VALIDACAO_FALHOU", "Valor deve ser positivo.");
    }
    if (!numero_documento?.trim()) throw new ErroDominio("VALIDACAO_FALHOU", "Número do documento é obrigatório.");
    return emTransacao(this.ctx, async (tx) => {
      const fat = await new FaturamentoService(tx).obter(faturamento_id);
      if (fat.local_id !== local_id || fat.cliente_id !== cliente_id) {
        throw new ErroDominio("VALIDACAO_FALHOU", "Faturamento não pertence ao local/cliente informado.");
      }
      if (fat.status === "cancelado") throw new ErroDominio("ESTADO_INVALIDO", "Faturamento cancelado.");
      if (fat.numero_documento !== numero_documento) {
        throw new ErroDominio("VALIDACAO_FALHOU", "Número do documento não confere com o faturamento.");
      }
      const dup = await tx.db
        .selectFrom("fin_conta_receber")
        .select("id")
        .where("local_id", "=", local_id)
        .where("numero_documento", "=", numero_documento)
        .where("status", "!=", "cancelado")
        .executeTakeFirst();
      if (dup) throw new ErroDominio("ESTADO_INVALIDO", "Já existe recebível para este documento.");
      const id = novoId();
      await tx.db
        .insertInto("fin_conta_receber")
        .values({
          id,
          local_id,
          cliente_id,
          numero_documento,
          valor_original: valor_original.centavos,
          valor_recebido: 0,
          data_vencimento: data_vencimento.toISOString(),
          forma_pagamento: fat.forma_cobranca,
          status: "pendente",
          conta_destino_id: null,
          lançamentos_id: JSON.stringify([]),
          criado_em: tx.relogio.agora().toISOString(),
        })
        .execute();
      const criado = await new ContasReceberService(tx).obter(id);
      await auditar(tx, {
        ator: usuario.email,
        acao: "fin_conta_receber.criar",
        alvoTipo: "fin_conta_receber",
        alvoId: id,
        dados: { faturamento_id, numero_documento, valor_original: valor_original.centavos },
      });
      return criado;
    });
  }

  /**
   * Registra recebimento: cria Lançamento, movimenta a conta (crédito → saldo) e atualiza a conta a receber e a fatura.
   * Pagamento parcial exige `novoVencimento`: a conta original fica quitada pela parte paga e nasce uma nova parcela
   * (vinculada, com o saldo e o novo vencimento). A soma das parcelas é sempre o valor original.
   */
  async confirmarPagamento(recebivel_id: UUID, valor: Dinheiro, conta_bancaria_id: UUID, usuario: Usuario, novoVencimento?: Date): Promise<ContaReceber> {
    if (!Number.isInteger(valor.centavos) || valor.centavos <= 0) {
      throw new ErroDominio("VALIDACAO_FALHOU", "Valor deve ser positivo.");
    }
    return emTransacao(this.ctx, async (tx) => {
      const svc = new ContasReceberService(tx);
      const rec = await svc.obter(recebivel_id);
      if (rec.status === "recebido" || rec.status === "cancelado") {
        throw new ErroDominio("ESTADO_INVALIDO", `Recebível ${rec.status}.`);
      }
      if (valor.ehMaior(rec.valor_pendente!)) {
        throw new ErroDominio("VALIDACAO_FALHOU", "Valor excede o saldo pendente.");
      }
      const conta = await tx.db
        .selectFrom("fin_conta_bancaria")
        .select("id")
        .where("id", "=", conta_bancaria_id)
        .where("local_id", "=", rec.local_id)
        .executeTakeFirst();
      if (!conta) throw new ErroDominio("NAO_ENCONTRADO", "Conta bancária não encontrada.");
      const raw = (await tx.db.selectFrom("fin_conta_receber").select(["origem", "categoria", "observacao"]).where("id", "=", recebivel_id).executeTakeFirst()) as any;
      const parcial = valor.centavos < rec.valor_pendente!.centavos;
      if (parcial && (!novoVencimento || Number.isNaN(novoVencimento.getTime()))) {
        throw new ErroDominio("VALIDACAO_FALHOU", "Para receber só uma parte, informe a nova data de vencimento do saldo.");
      }

      const lanc = await new LançamentoService(tx).criar({
        local_id: rec.local_id,
        data: tx.relogio.agora(),
        tipo: "recebimento",
        origem: "hospedagem",
        valor,
        forma_pagamento: FORMA_LANCAMENTO[rec.forma_pagamento],
        referencia_id: rec.id,
        referencia_tipo: "conta_receber",
        usuario,
      });
      await new CaixaBancoService(tx).criarMovimento(lanc, conta_bancaria_id, usuario);

      const recebido = rec.valor_recebido.mais(valor);
      const lancamentos = [...rec.lançamentos_id, lanc.id];
      const base = numeroBase(rec.numero_documento);
      if (parcial) {
        const resto = rec.valor_pendente!.menos(valor);
        const n = await tx.db.selectFrom("fin_conta_receber").select(sql<number>`count(*)`.as("n")).where("local_id", "=", rec.local_id).where("numero_documento", "like", `${base}-P%`).executeTakeFirst();
        const filhaId = novoId();
        await tx.db
          .insertInto("fin_conta_receber")
          .values({
            id: filhaId, local_id: rec.local_id, cliente_id: rec.cliente_id, numero_documento: `${base}-P${Number(n?.n ?? 0) + 1}`,
            valor_original: resto.centavos, valor_recebido: 0, data_vencimento: novoVencimento!.toISOString(), forma_pagamento: rec.forma_pagamento,
            status: "pendente", conta_destino_id: null, lançamentos_id: JSON.stringify([]), parcela_de: rec.id, valor_total: null,
            origem: raw.origem, categoria: raw.categoria, observacao: raw.observacao,
            criado_em: tx.relogio.agora().toISOString(),
          })
          .execute();
        await tx.db
          .updateTable("fin_conta_receber")
          .set({
            valor_original: recebido.centavos, valor_total: rec.valor_original.centavos, valor_recebido: recebido.centavos, status: "recebido",
            conta_destino_id: conta_bancaria_id, lançamentos_id: JSON.stringify(lancamentos),
          })
          .where("id", "=", recebivel_id)
          .execute();
        await auditar(tx, { ator: usuario.email, acao: "fin_conta_receber.parcela_saldo", alvoTipo: "fin_conta_receber", alvoId: filhaId, dados: { parcela_de: rec.id, valor: resto.centavos, vencimento: novoVencimento!.toISOString() } });
      } else {
        const quitado = recebido.eh(rec.valor_original);
        await tx.db
          .updateTable("fin_conta_receber")
          .set({
            valor_recebido: recebido.centavos,
            status: quitado ? "recebido" : "parcialmente_recebido",
            conta_destino_id: conta_bancaria_id,
            lançamentos_id: JSON.stringify(lancamentos),
          })
          .where("id", "=", recebivel_id)
          .execute();
      }
      await atualizarFaturaDoDocumento(tx, rec.local_id, base);

      await auditar(tx, {
        ator: usuario.email,
        acao: "fin_conta_receber.confirmar_pagamento",
        alvoTipo: "fin_conta_receber",
        alvoId: recebivel_id,
        dados: { valor: valor.centavos, conta_bancaria_id, lancamento_id: lanc.id, parcial },
      });
      return svc.obter(recebivel_id);
    });
  }

  private async exigirManualEditavel(tx: Contexto, id: UUID): Promise<any> {
    const raw = (await tx.db.selectFrom("fin_conta_receber").selectAll().where("id", "=", id).executeTakeFirst()) as any;
    if (!raw) throw new ErroDominio("NAO_ENCONTRADO", "Recebível não encontrado.");
    if (raw.origem !== "manual") throw new ErroDominio("ESTADO_INVALIDO", MSG_HOSPEDAGEM);
    const filha = await tx.db.selectFrom("fin_conta_receber").select("id").where("parcela_de", "=", id).where("status", "!=", "cancelado").executeTakeFirst();
    if (raw.status !== "pendente" || raw.valor_recebido > 0 || raw.valor_total != null || filha) throw new ErroDominio("ESTADO_INVALIDO", MSG_PENDENTE);
    return raw;
  }

  private async validarManual(tx: Contexto, local_id: UUID, d: { cliente_id: UUID; numero_documento: string; valor: number }, exceto?: UUID): Promise<void> {
    if (!Number.isInteger(d.valor) || d.valor <= 0) throw new ErroDominio("VALIDACAO_FALHOU", "Valor deve ser positivo.");
    if (!d.numero_documento.trim()) throw new ErroDominio("VALIDACAO_FALHOU", "Número do documento é obrigatório.");
    const c = await tx.db.selectFrom("fin_cliente").select("id").where("id", "=", d.cliente_id).where("local_id", "=", local_id).executeTakeFirst();
    if (!c) throw new ErroDominio("NAO_ENCONTRADO", "Cliente não encontrado neste local.");
    let q = tx.db.selectFrom("fin_conta_receber").select("id").where("local_id", "=", local_id).where("numero_documento", "=", d.numero_documento.trim()).where("status", "!=", "cancelado");
    if (exceto) q = q.where("id", "!=", exceto);
    if (await q.executeTakeFirst()) throw new ErroDominio("VALIDACAO_FALHOU", "Já existe uma conta a receber com este número de documento neste local.");
  }

  /** Lançamento manual de conta a receber (serviço, aluguel, evento...): espelho de Contas a Pagar. */
  async criarManual(local_id: UUID, d: DadosManual, usuario: Usuario): Promise<ContaReceber> {
    return emTransacao(this.ctx, async (tx) => {
      const l = await tx.db.selectFrom("fin_local").select("id").where("id", "=", local_id).executeTakeFirst();
      if (!l) throw new ErroDominio("NAO_ENCONTRADO", "Local não encontrado.");
      await this.validarManual(tx, local_id, d);
      const id = novoId();
      await tx.db.insertInto("fin_conta_receber").values({
        id, local_id, cliente_id: d.cliente_id, numero_documento: d.numero_documento.trim(), valor_original: d.valor, valor_recebido: 0,
        data_vencimento: d.vencimento.toISOString(), forma_pagamento: d.forma_pagamento ?? "boleto", status: "pendente", conta_destino_id: null,
        lançamentos_id: JSON.stringify([]), origem: "manual", categoria: d.categoria, observacao: d.observacao?.trim() || null,
        criado_em: tx.relogio.agora().toISOString(),
      }).execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_conta_receber.criar_manual", alvoTipo: "fin_conta_receber", alvoId: id, dados: { ...d, vencimento: d.vencimento.toISOString() } });
      return new ContasReceberService(tx).obter(id);
    });
  }

  /** Edita a conta manual enquanto pendente e intocada. */
  async editarManual(id: UUID, d: Partial<DadosManual>, usuario: Usuario): Promise<ContaReceber> {
    return emTransacao(this.ctx, async (tx) => {
      const raw = await this.exigirManualEditavel(tx, id);
      const depois = {
        cliente_id: d.cliente_id ?? raw.cliente_id, numero_documento: (d.numero_documento ?? raw.numero_documento).trim(), valor: d.valor ?? raw.valor_original,
      };
      await this.validarManual(tx, raw.local_id, depois, id);
      await tx.db.updateTable("fin_conta_receber").set({
        cliente_id: depois.cliente_id, numero_documento: depois.numero_documento, valor_original: depois.valor,
        data_vencimento: d.vencimento ? d.vencimento.toISOString() : raw.data_vencimento, categoria: d.categoria ?? raw.categoria,
        observacao: d.observacao === undefined ? raw.observacao : d.observacao.trim() || null, forma_pagamento: d.forma_pagamento ?? raw.forma_pagamento,
      }).where("id", "=", id).execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_conta_receber.editar_manual", alvoTipo: "fin_conta_receber", alvoId: id, dados: { antes: raw, depois: { ...d, vencimento: d.vencimento?.toISOString() } } });
      return new ContasReceberService(tx).obter(id);
    });
  }

  /** Cancela a conta manual pendente e intocada. */
  async cancelarManual(id: UUID, o: { motivo: string; supervisorId?: string }, usuario: Usuario): Promise<ContaReceber> {
    if (!o.motivo?.trim()) throw new ErroDominio("VALIDACAO_FALHOU", "Motivo é obrigatório.");
    return emTransacao(this.ctx, async (tx) => {
      await this.exigirManualEditavel(tx, id);
      await tx.db.updateTable("fin_conta_receber").set({ status: "cancelado" }).where("id", "=", id).execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_conta_receber.cancelar_manual", alvoTipo: "fin_conta_receber", alvoId: id, motivo: o.motivo, supervisorId: o.supervisorId });
      return new ContasReceberService(tx).obter(id);
    });
  }

  async obter(id: UUID): Promise<ContaReceber> {
    const c = await this.ctx.db.selectFrom("fin_conta_receber").selectAll().where("id", "=", id).executeTakeFirst();
    if (!c) throw new ErroDominio("NAO_ENCONTRADO", "Recebível não encontrado.");
    return paraContaReceber(c);
  }
}
