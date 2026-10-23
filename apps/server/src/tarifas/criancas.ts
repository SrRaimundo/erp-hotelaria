import { ErroDominio } from "../shared/erros.js";
import { idadeEm, type Data } from "../shared/tempo.js";
import type { FaixaCrianca, Hospedes } from "./tipos.js";

export type CriancaClassificada = { idade: number; faixa: FaixaCrianca };

/**
 * Idade medida na data de chegada. Quem tem `idadeAdulto` ou mais vira adulto;
 * crianças grátis além do limite passam à primeira faixa pagante.
 */
export function classificarCriancas(
  h: Hospedes,
  chegada: Data,
  faixas: FaixaCrianca[],
  idadeAdulto: number,
  limiteGratis: number,
): { adultosEfetivos: number; criancas: CriancaClassificada[] } {
  let adultosEfetivos = h.adultos;
  const criancas: CriancaClassificada[] = [];
  const primeiraPagante = faixas
    .filter((f) => f.tipo !== "gratis")
    .sort((a, b) => a.idadeMin - b.idadeMin)[0];
  let gratisUsadas = 0;

  for (const nascimento of h.criancasNascimento) {
    const idade = idadeEm(nascimento, chegada);
    if (idade >= idadeAdulto) {
      adultosEfetivos++;
      continue;
    }
    let faixa = faixas.find((f) => idade >= f.idadeMin && idade <= f.idadeMax);
    if (!faixa) {
      throw new ErroDominio(
        "FAIXA_CRIANCA_INEXISTENTE",
        `Não há faixa de preço cadastrada para criança de ${idade} anos. Cadastre a faixa nas configurações de tarifas.`,
        { idade },
      );
    }
    if (faixa.tipo === "gratis") {
      if (gratisUsadas >= limiteGratis && primeiraPagante) faixa = primeiraPagante;
      else gratisUsadas++;
    }
    criancas.push({ idade, faixa });
  }
  return { adultosEfetivos, criancas };
}
