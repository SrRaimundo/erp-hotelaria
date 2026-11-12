import type { UUID } from "../../shared/ids.js";
import type { Dinheiro } from "../../shared/dinheiro.js";

export type Lançamento = {
  id: UUID;
  local_id: UUID;
  data: Date;
  hora?: string;

  // Classification
  tipo: "recebimento" | "pagamento" | "transferencia" | "ajuste";
  origem: "hospedagem" | "reserva" | "bar" | "lavanderia" | "rh" | "manual";
  categoria?: string;
  vencimento?: Date;
  fornecedor_id?: UUID;
  /** Parcela de saldo de um pagamento parcial: o lançamento de origem. */
  parcela_de?: UUID;
  /** Pagamento parcial: valor que o lançamento tinha antes de ser dividido (soma das parcelas). */
  valor_total?: number;

  // Values
  valor: Dinheiro;
  forma_pagamento: "dinheiro" | "pix" | "debito" | "credito" | "cheque" | "boleto" | "transferencia" | "voucher";
  descricao: string;

  // Status
  status: "pendente" | "confirmado" | "liquidado" | "cancelado";

  // Traceability
  referencia_id?: UUID;
  referencia_tipo?: string;

  // Audit
  auditoria: {
    criado_por: string;
    data_criacao: Date;
    dispositivo: string;
    atualizado_por?: string;
    data_atualizacao?: Date;
    motivo_cancelamento?: string;
    supervisor_autorizou?: boolean;
  };
};
