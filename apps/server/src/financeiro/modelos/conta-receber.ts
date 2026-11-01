import type { UUID } from "../../shared/ids.js";
import type { Dinheiro } from "../../shared/dinheiro.js";

export type ContaReceber = {
  id: UUID;
  local_id: UUID;
  cliente_id: UUID;

  numero_documento: string;
  tipo_documento?: string;

  // Valores
  valor_original: Dinheiro;
  valor_recebido: Dinheiro; // soma dos lançamentos vinculados
  valor_pendente?: Dinheiro; // calculado: valor_original - valor_recebido (não persistido)

  // Datas
  data_emissao: Date;
  data_vencimento: Date;
  data_recebimento?: Date;

  forma_pagamento: "boleto" | "pix" | "deposito" | "dinheiro" | "transferencia";
  conta_destino_id?: UUID;

  status: "pendente" | "parcialmente_recebido" | "recebido" | "cancelado";

  lançamentos_id: UUID[];
};
