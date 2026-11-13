import type { UUID } from "../../shared/ids.js";
import type { Dinheiro } from "../../shared/dinheiro.js";

export type Faturamento = {
  id: UUID;
  local_id: UUID;
  cliente_id: UUID;

  // Origem (checkout da hospedagem)
  referencia_id: UUID;
  referencia_tipo: string;

  // Valores
  valor_original: Dinheiro;
  valor_liquido: Dinheiro; // valor_original - desconto

  // Cobrança
  data_vencimento: Date;
  forma_cobranca: "boleto" | "pix" | "deposito";
  numero_documento: string;

  status: "aberto" | "parcialmente_pago" | "pago" | "cancelado";

  // Lançamentos de pagamento vinculados
  lançamentos_id: UUID[];
};
