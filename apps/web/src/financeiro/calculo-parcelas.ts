/** Cálculo do parcelamento na tela (a mesma regra do servidor, que confere de novo ao salvar). Datas AAAA-MM-DD, valores em centavos. */
export const MAX_PARCELAS = 60;
export type Intervalo = "30_dias" | "mensal" | "livre";
export type ParcelaEditavel = { vencimento: string; valor: number | null };

const DIA_MS = 86_400_000;
const utc = (d: string) => {
  const [a, m, dia] = d.split("-").map(Number) as [number, number, number];
  return Date.UTC(a, m - 1, dia);
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dataExiste = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && iso(utc(d)) === d;

/** As sobras de centavos vão todas para a PRIMEIRA parcela (1000,00 / 3 = 333,34 + 333,33 + 333,33). */
export function dividirValor(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const parcelas = Array<number>(n).fill(base);
  parcelas[0] = base + (total - base * n);
  return parcelas;
}

/** "30_dias" conta da primeira data (1ª, +30, +60...); "mensal" repete o dia, ajustando ao último dia do mês. "livre" sugere de 30 em 30 dias. */
export function gerarDatas(primeira: string, n: number, intervalo: Intervalo): string[] {
  const [a, m, d] = primeira.split("-").map(Number) as [number, number, number];
  return Array.from({ length: n }, (_, i) => {
    if (intervalo !== "mensal") return iso(utc(primeira) + i * 30 * DIA_MS);
    const alvo = m - 1 + i;
    const ano = a + Math.floor(alvo / 12);
    const mes = alvo % 12;
    const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
  });
}

const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+,)/g, ".")}`;

/** Motivos pelos quais o parcelamento não pode ser salvo; vazio = válido. */
export function validarParcelas(total: number, parcelas: ParcelaEditavel[]): string[] {
  const m: string[] = [];
  if (parcelas.length < 2) m.push("Parcelado precisa de pelo menos 2 parcelas.");
  if (parcelas.length > MAX_PARCELAS) m.push(`Parcelado aceita no máximo ${MAX_PARCELAS} parcelas.`);
  if (parcelas.some((p) => p.valor === null || p.valor <= 0)) m.push("Cada parcela precisa ter valor maior que zero.");
  if (parcelas.some((p) => !dataExiste(p.vencimento))) m.push("Há parcela sem data, ou com data que não existe no calendário.");
  else if (parcelas.some((p, i) => i > 0 && p.vencimento <= parcelas[i - 1]!.vencimento)) m.push("As datas precisam estar em ordem crescente, sem repetir.");
  const soma = parcelas.reduce((s, p) => s + (p.valor ?? 0), 0);
  if (soma !== total) m.unshift(`A soma das parcelas (${reais(soma)}) precisa ser igual ao total (${reais(total)}). Diferença: ${reais(Math.abs(total - soma))}.`);
  return m;
}
