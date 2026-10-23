import { aplicarPercentual, arredondarCentavos, arredondarReal, type Centavos } from "../shared/dinheiro.js";
import { diaDaSemana, type Data } from "../shared/tempo.js";
import { classificarCriancas, type CriancaClassificada } from "./criancas.js";
import type { Hospedes, RegrasNoite, TabelaBase, ValorNoite } from "./tipos.js";

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

function rotuloPercentual(nome: string, pct: number): string {
  const n = Number(Math.abs(pct).toFixed(4)); // sem zeros à direita
  return `${nome} ${pct < 0 ? "−" : "+"}${n}%`;
}

function custoCriancas(criancas: CriancaClassificada[], adultoExtra: Centavos): number {
  let total = 0;
  for (const { faixa } of criancas) {
    if (faixa.tipo === "percentual_adicional") total += (adultoExtra * faixa.valor) / 100;
    else if (faixa.tipo === "fixo") total += faixa.valor;
  }
  return total;
}

function valorAdultos(t: TabelaBase, adultos: number): number {
  const chave = Math.min(Math.max(adultos, 1), 3) as 1 | 2 | 3;
  return t.porAdultos[chave] + Math.max(0, adultos - 3) * t.adultoExtra;
}

function finalizar(v: number, r: RegrasNoite): Centavos {
  const c = arredondarCentavos(v);
  return r.arredondamento === "real" ? arredondarReal(c) : c;
}

export function calcularNoite(data: Data, chegada: Data, h: Hospedes, r: RegrasNoite): ValorNoite {
  const { adultosEfetivos, criancas } = classificarCriancas(
    h, chegada, r.faixasCrianca, r.idadeAdulto, r.limiteCriancasGratis,
  );

  if (r.pacote) {
    const chave = Math.min(Math.max(adultosEfetivos, 1), 3) as 1 | 2 | 3;
    const adultosPacote = r.pacote.valorNoite[chave];
    const filhos = custoCriancas(criancas, r.tabelaPadrao.adultoExtra);
    const passos = [{ rotulo: `Pacote ${r.pacote.nome}`, valor: arredondarCentavos(adultosPacote) }];
    if (filhos > 0) passos.push({ rotulo: "Crianças", valor: arredondarCentavos(filhos) });
    return { data, valor: finalizar(adultosPacote + filhos, r), passos };
  }

  const tabela = r.temporada?.tabela ?? r.tabelaPadrao;
  let v = valorAdultos(tabela, adultosEfetivos) + custoCriancas(criancas, tabela.adultoExtra);
  const passos: ValorNoite["passos"] = [{ rotulo: "Base", valor: arredondarCentavos(v) }];
  const aplicar = (rotulo: string, pct: number) => {
    v = aplicarPercentual(v, pct);
    passos.push({ rotulo: rotuloPercentual(rotulo, pct), valor: arredondarCentavos(v) });
  };

  if (r.temporada?.percentual) aplicar(r.temporada.nome, r.temporada.percentual);
  if (r.percentualDiaSemana) aplicar(DIAS[diaDaSemana(data)], r.percentualDiaSemana);
  if (r.canal.percentual !== 0) aplicar(r.canal.nome, r.canal.percentual);

  const faixa = r.faixasOcupacao
    .filter((f) => r.ocupacaoPct > f.acimaDe)
    .sort((a, b) => b.acimaDe - a.acimaDe)[0];
  if (faixa) {
    v = aplicarPercentual(v, faixa.percentual);
    passos.push({
      rotulo: rotuloPercentual(`Ocupação ${Math.round(r.ocupacaoPct)}%`, faixa.percentual),
      valor: arredondarCentavos(v),
    });
  }

  if (r.piso !== undefined && v < r.piso) {
    v = r.piso;
    passos.push({ rotulo: "Piso", valor: arredondarCentavos(v) });
  }
  if (r.teto !== undefined && v > r.teto) {
    v = r.teto;
    passos.push({ rotulo: "Teto", valor: arredondarCentavos(v) });
  }

  return { data, valor: finalizar(v, r), passos };
}
