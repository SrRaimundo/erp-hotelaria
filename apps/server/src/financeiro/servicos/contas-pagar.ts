import { auditar } from "../../infra/auditoria.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import type { Dinheiro } from "../../shared/dinheiro.js";
import { ErroDominio } from "../../shared/erros.js";
import type { UUID } from "../../shared/ids.js";
import type { Lançamento } from "../modelos/lançamento.js";
import { CaixaBancoService } from "./caixa-banco.js";
import { LançamentoService } from "./lançamentos.js";
import type { Usuario } from "./locais.js";

export const CATEGORIAS_PAGAR = ["fornecedor", "servico", "funcionario", "contrato"] as const;
export type CategoriaPagar = (typeof CATEGORIAS_PAGAR)[number];

export type ParamsContaPagar = {
  local_id: UUID;
  descricao: string;
  categoria: CategoriaPagar;
  valor: Dinheiro;
  vencimento: Date;
  fornecedor_id?: UUID;
  forma_pagamento?: Lançamento["forma_pagamento"];
};

/** Contas a Pagar: lançamento de pagamento que nasce pendente e vira confirmado (com débito no Caixa/Banco) ao ser baixado. */
export class ContasPagarService {
  constructor(private ctx: Contexto) {}

  async criar(p: ParamsContaPagar, usuario: Usuario): Promise<Lançamento> {
    if (!p.descricao.trim()) throw new ErroDominio("VALIDACAO_FALHOU", "Descrição é obrigatória.");
    return emTransacao(this.ctx, async (tx) => {
      if (p.fornecedor_id) {
        const f = await tx.db.selectFrom("fin_fornecedor").select("id").where("id", "=", p.fornecedor_id).where("local_id", "=", p.local_id).executeTakeFirst();
        if (!f) throw new ErroDominio("NAO_ENCONTRADO", "Fornecedor não encontrado neste local.");
      }
      return new LançamentoService(tx).criar({
        local_id: p.local_id,
        data: tx.relogio.agora(),
        tipo: "pagamento",
        origem: "manual",
        valor: p.valor,
        forma_pagamento: p.forma_pagamento ?? "boleto",
        status: "pendente",
        descricao: p.descricao.trim(),
        categoria: p.categoria,
        vencimento: p.vencimento,
        fornecedor_id: p.fornecedor_id,
        referencia_tipo: "conta_pagar",
        usuario,
      });
    });
  }

  /** Baixa o pagamento: confirma o lançamento e debita a conta escolhida. */
  async baixar(id: UUID, conta_id: UUID, forma: Lançamento["forma_pagamento"] | undefined, usuario: Usuario): Promise<Lançamento> {
    return emTransacao(this.ctx, async (tx) => {
      const lancs = new LançamentoService(tx);
      const l = await lancs.obter(id);
      if (l.referencia_tipo !== "conta_pagar") throw new ErroDominio("ESTADO_INVALIDO", "Este lançamento não é uma conta a pagar.");
      if (l.status !== "pendente") throw new ErroDominio("ESTADO_INVALIDO", l.status === "cancelado" ? "Conta a pagar cancelada." : "Conta a pagar já paga.");
      const conta = await tx.db.selectFrom("fin_conta_bancaria").select("id").where("id", "=", conta_id).where("local_id", "=", l.local_id).executeTakeFirst();
      if (!conta) throw new ErroDominio("NAO_ENCONTRADO", "Conta não encontrada neste local.");
      const agora = tx.relogio.agora();
      await tx.db
        .updateTable("fin_lancamento")
        .set({ status: "confirmado", data: agora.toISOString(), forma_pagamento: forma ?? l.forma_pagamento, atualizado_por: usuario.email, atualizado_em: agora.toISOString() })
        .where("id", "=", id)
        .execute();
      const pago = await lancs.obter(id);
      await new CaixaBancoService(tx).criarMovimento(pago, conta_id, usuario);
      await auditar(tx, { ator: usuario.email, acao: "fin_conta_pagar.baixar", alvoTipo: "fin_lancamento", alvoId: id, dados: { conta_id, valor: pago.valor.centavos } });
      return pago;
    });
  }
}
