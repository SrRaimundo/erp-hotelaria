import { ErroDominio } from "../shared/erros.js";

export type EstadoReserva = "pre_reserva" | "confirmada" | "hospedada" | "finalizada" | "cancelada" | "no_show";

/** Estados em que a reserva ocupa quarto/categoria. */
export const ESTADOS_ATIVOS: EstadoReserva[] = ["pre_reserva", "confirmada", "hospedada"];

const TRANSICOES: Record<EstadoReserva, EstadoReserva[]> = {
  pre_reserva: ["confirmada", "cancelada"],
  confirmada: ["hospedada", "cancelada", "no_show"],
  hospedada: ["finalizada"],
  finalizada: [],
  cancelada: [],
  no_show: [],
};

export function transicionar(de: EstadoReserva, para: EstadoReserva): void {
  if (!TRANSICOES[de].includes(para)) {
    throw new ErroDominio(
      "TRANSICAO_RESERVA_INVALIDA",
      `A reserva não pode passar de "${de}" para "${para}" (TRANSICAO_RESERVA_INVALIDA).`,
      { de, para },
    );
  }
}
