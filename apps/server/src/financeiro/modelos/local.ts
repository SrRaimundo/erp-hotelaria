import type { UUID } from "../../shared/ids.js";

export type Local = {
  id: UUID;
  pousada_id: UUID;
  nome: string;
  ativo: boolean;
  parametros: {
    local_padrao_hospedagem: UUID;
    local_padrao_reserva: UUID;
  };
};
