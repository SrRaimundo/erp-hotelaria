/** YYYY-MM-DD → dd/mm/aaaa (só para textos do servidor, como o subtítulo). */
export const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export const TRACO = "—";

/** Percentual com uma casa ("66,7%"); sem base (divisão por zero) mostra "—". */
export const percentual = (parte: number, total: number) => (total > 0 ? `${((parte / total) * 100).toFixed(1).replace(".", ",")}%` : TRACO);

/** Razão arredondada em centavos inteiros; sem base mostra "—". */
export const razaoCentavos = (valor: number, base: number): number | string => (base > 0 ? Math.round(valor / base) : TRACO);
