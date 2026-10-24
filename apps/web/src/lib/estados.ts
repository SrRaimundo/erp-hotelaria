export type EstadoReservaId = "pre_reserva" | "confirmada" | "hospedada" | "finalizada" | "cancelada" | "no_show";
export type TomEtiqueta = "neutro" | "verde" | "terracota" | "amarelo";

/** Rótulo e cor de cada estado de reserva, compartilhados entre a gaveta e a lista. */
export const ESTADOS_RESERVA: Record<EstadoReservaId, { rotulo: string; tom: TomEtiqueta }> = {
  pre_reserva: { rotulo: "pré-reserva", tom: "amarelo" },
  confirmada: { rotulo: "confirmada", tom: "verde" },
  hospedada: { rotulo: "hospedada", tom: "verde" },
  finalizada: { rotulo: "finalizada", tom: "neutro" },
  cancelada: { rotulo: "cancelada", tom: "terracota" },
  no_show: { rotulo: "no-show", tom: "terracota" },
};
