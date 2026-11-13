import { dataValida, somarDias, type Data } from "../../shared/tempo.js";

export const MAX_PARCELAS = 60;
export type Intervalo = "30_dias" | "mensal" | "livre";
export type ParcelaPlano = { vencimento: Data; valor: number };

/** Divide o total em n parcelas; as sobras de centavos vão todas para a PRIMEIRA (1000,00 / 3 = 333,34 + 333,33 + 333,33). */
export function dividirValor(total: number, n: number): number[] {
  if (!Number.isInteger(total) || total <= 0 || !Number.isInteger(n) || n < 1) throw new Error("Total e número de parcelas inválidos.");
  const base = Math.floor(total / n);
  if (base < 1) throw new Error("O total é pequeno demais: cada parcela precisa de pelo menos 1 centavo.");
  const parcelas = Array<number>(n).fill(base);
  parcelas[0] = base + (total - base * n);
  return parcelas;
}

function mesmoDiaNoMes(primeira: Data, meses: number): Data {
  const [a, m, d] = primeira.split("-").map(Number) as [number, number, number];
  const alvo = m - 1 + meses;
  const ano = a + Math.floor(alvo / 12);
  const mes = ((alvo % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

/** Vencimentos sugeridos: "30_dias" conta da primeira data (1ª, +30, +60...); "mensal" repete o dia, ajustando ao último dia do mês. */
export function gerarDatas(primeira: Data, n: number, intervalo: Exclude<Intervalo, "livre"> | "livre"): Data[] {
  return Array.from({ length: n }, (_, i) => (intervalo === "mensal" ? mesmoDiaNoMes(primeira, i) : somarDias(primeira, i * 30)));
}

const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+,)/g, ".")}`;

/** Motivos (em português, para o usuário) pelos quais o parcelamento não pode ser salvo; vazio = válido. */
export function validarParcelas(total: number, parcelas: ParcelaPlano[]): string[] {
  const m: string[] = [];
  if (parcelas.length < 2) m.push("Parcelado precisa de pelo menos 2 parcelas.");
  if (parcelas.length > MAX_PARCELAS) m.push(`Parcelado aceita no máximo ${MAX_PARCELAS} parcelas.`);
  if (parcelas.some((p) => !Number.isInteger(p.valor) || p.valor <= 0)) m.push("Cada parcela precisa ter valor maior que zero.");
  if (parcelas.some((p) => !dataValida(p.vencimento))) m.push("Há parcela sem data, ou com data que não existe no calendário.");
  else if (parcelas.some((p, i) => i > 0 && p.vencimento <= parcelas[i - 1]!.vencimento)) m.push("As datas precisam estar em ordem crescente, sem repetir.");
  const soma = parcelas.reduce((s, p) => s + (Number.isFinite(p.valor) ? p.valor : 0), 0);
  if (soma !== total) m.unshift(`A soma das parcelas (${reais(soma)}) precisa ser igual ao total (${reais(total)}). Diferença: ${reais(Math.abs(total - soma))}.`);
  return m;
}

/** "<documento> – parcela 2/4"; a parcela do saldo de um pagamento parcial leva "– saldo". */
export const rotuloParcela = (documento: string, n: number, total: number, saldo = false): string => `${documento} – parcela ${n}/${total}${saldo ? " – saldo" : ""}`;
