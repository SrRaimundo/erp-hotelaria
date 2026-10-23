export type Centavos = number;

/** Acrescenta pct% a v, sem arredondar (arredonde só no final com arredondarCentavos). */
export function aplicarPercentual(v: number, pct: number): number {
  return v * (1 + pct / 100);
}

function meioParaLongeDoZero(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v)) || 0; // || 0 evita -0
}

export function arredondarCentavos(v: number): Centavos {
  return meioParaLongeDoZero(v);
}

/** Arredonda para o real inteiro mais próximo (múltiplo de 100 centavos). */
export function arredondarReal(v: Centavos): Centavos {
  return meioParaLongeDoZero(v / 100) * 100;
}

export function formatarBRL(v: Centavos): string {
  const abs = Math.abs(v);
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cent = String(abs % 100).padStart(2, "0");
  return `${v < 0 ? "-" : ""}R$ ${reais},${cent}`;
}
