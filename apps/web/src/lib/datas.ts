const DIAS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

function emUtc(d: string): number {
  const [a, m, dia] = d.split("-").map(Number);
  return Date.UTC(a!, m! - 1, dia!);
}

/** "2026-11-20" -> "20/11" (ou "20/11/2026" com ano). */
export function formatarData(d: string, comAno = false): string {
  const [a, m, dia] = d.split("-");
  return comAno ? `${dia}/${m}/${a}` : `${dia}/${m}`;
}

export function somarDiasIso(d: string, n: number): string {
  return new Date(emUtc(d) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Número de dias de `a` até `b` (negativo se b < a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((emUtc(b) - emUtc(a)) / 86_400_000);
}

export function nomeDiaSemana(d: string): string {
  return DIAS[new Date(emUtc(d)).getUTCDay()]!;
}
