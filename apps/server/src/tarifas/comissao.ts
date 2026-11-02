import { arredondarCentavos, type Centavos } from "../shared/dinheiro.js";

/** Percentual com até duas casas em centésimos de ponto (12,5% -> 1250): a conta de dinheiro fica em inteiros. */
export const centesimosDePercentual = (pct: number): number => Math.round(pct * 100);

/** Comissão em centavos inteiros: receita × percentual, arredondada para o centavo mais próximo (meio para longe do zero). */
export function calcularComissao(receita: Centavos, comissaoPercentual: number): Centavos {
  return arredondarCentavos((receita * centesimosDePercentual(comissaoPercentual)) / 10_000);
}
