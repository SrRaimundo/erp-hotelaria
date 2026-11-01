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

  /** Registra recebimento: cria Lançamento, movimenta a conta (crédito → saldo) e atualiza status do recebível e do faturamento. */
  async confirmarPagamento(recebivel_id: UUID, valor: Dinheiro, conta_bancaria_id: UUID, usuario: Usuario): Promise<ContaReceber> {
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
      const quitado = recebido.eh(rec.valor_original);
      const lancamentos = [...rec.lançamentos_id, lanc.id];
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

      // Propaga ao faturamento de mesmo documento
      const fat = await tx.db
        .selectFrom("fin_faturamento")
        .select("id")
        .where("local_id", "=", rec.local_id)
        .where("numero_documento", "=", rec.numero_documento)
        .executeTakeFirst();
      if (fat) {
        await tx.db
          .updateTable("fin_faturamento")
          .set({ status: quitado ? "pago" : "parcialmente_pago", lançamentos_id: JSON.stringify(lancamentos) })
          .where("id", "=", fat.id)
          .execute();
      }

      await auditar(tx, {
        ator: usuario.email,
        acao: "fin_conta_receber.confirmar_pagamento",
        alvoTipo: "fin_conta_receber",
        alvoId: recebivel_id,
        dados: { valor: valor.centavos, conta_bancaria_id, lancamento_id: lanc.id },
      });
      return svc.obter(recebivel_id);
    });
  }

  async obter(id: UUID): Promise<ContaReceber> {
    const c = await this.ctx.db.selectFrom("fin_conta_receber").selectAll().where("id", "=", id).executeTakeFirst();
    if (!c) throw new ErroDominio("NAO_ENCONTRADO", "Recebível não encontrado.");
    return paraContaReceber(c);
  }
}
