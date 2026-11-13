import type { UUID } from "../../shared/ids.js";
import type { Dinheiro } from "../../shared/dinheiro.js";

export type Movimento = {
  id: UUID;
  local_id: UUID;

  conta_id: UUID;
  lancamento_id: UUID;

  tipo: "credito" | "debito" | "transferencia_out" | "transferencia_in";

  valor: Dinheiro;
  saldo_anterior: Dinheiro;
  saldo_posterior: Dinheiro; // calculado na criação (anterior ± valor)

  data: Date;
  criado_em: Date;
};

export type Saldo = {
  id: UUID;
  conta_id: UUID;
  data: Date;
  saldo: Dinheiro; // calculado a partir da soma dos Movimentos
  criado_em?: Date;
};
