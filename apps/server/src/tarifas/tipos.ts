import type { Centavos } from "../shared/dinheiro.js";
import type { Data } from "../shared/tempo.js";

export type TabelaBase = { porAdultos: Record<1 | 2 | 3, Centavos>; adultoExtra: Centavos };

/** `percentual_adicional` = % do `adultoExtra` da tabela vigente. */
export type FaixaCrianca = {
  idadeMin: number;
  idadeMax: number;
  tipo: "gratis" | "percentual_adicional" | "fixo";
  valor: number;
};

export type RegrasNoite = {
  tabelaPadrao: TabelaBase;
  temporada?: { nome: string; tabela?: TabelaBase; percentual?: number };
  percentualDiaSemana?: number;
  canal: { nome: string; percentual: number };
  faixasOcupacao: { acimaDe: number; percentual: number }[];
  ocupacaoPct: number;
  piso?: Centavos;
  teto?: Centavos;
  pacote?: { nome: string; valorNoite: Record<1 | 2 | 3, Centavos> };
  faixasCrianca: FaixaCrianca[];
  limiteCriancasGratis: number;
  idadeAdulto: number;
  arredondamento: "nenhum" | "real";
};

export type Hospedes = { adultos: number; criancasNascimento: Data[] };

export type ValorNoite = {
  data: Data;
  valor: Centavos;
  passos: { rotulo: string; valor: Centavos }[];
};
