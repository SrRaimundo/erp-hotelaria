function agruparMilhares(inteiro: string): string {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Centavos inteiros -> "R$ 1.234,56" (negativos: "−R$ 12,00"). */
export function formatarReais(centavos: number): string {
  const negativo = centavos < 0;
  const abs = Math.abs(Math.round(centavos));
  const reais = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${negativo ? "−" : ""}R$ ${agruparMilhares(String(reais))},${cents}`;
}

/** Texto digitado em reais -> centavos inteiros; inválido/vazio -> null. */
export function lerReais(texto: string): number | null {
  const t = texto.trim().replace(/^R\$\s*/i, "").replace(/\s+/g, "");
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const reais = Number(m[1]!.replace(/\./g, ""));
  const cents = m[2] === undefined ? 0 : Number(m[2].padEnd(2, "0"));
  const total = reais * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}
