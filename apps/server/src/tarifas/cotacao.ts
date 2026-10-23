import { obterConfig } from "../nucleo/pousada.js";
import type { Contexto } from "../shared/contexto.js";
import type { Centavos } from "../shared/dinheiro.js";
import { ErroDominio } from "../shared/erros.js";
import { diaDaSemana, noites, type Data } from "../shared/tempo.js";
import { calcularNoite } from "./calculo.js";
import { ocupacaoCategoria } from "./ocupacao.js";
import {
  listarCanais, listarFaixasCrianca, listarFaixasOcupacao, listarPacotes, listarPercentuaisDiaSemana,
  listarTabelasBase, listarTemporadas,
} from "./regras.js";
import { verificarRestricoes, type Violacao } from "./restricoes.js";
import type { Hospedes, RegrasNoite, ValorNoite } from "./tipos.js";

export type PedidoCotacao = {
  categoriaId: string;
  chegada: Data;
  saida: Data;
  hospedes: Hospedes;
  canal: string;
  ignorarReservaId?: string;
};

export type Cotacao = { noites: ValorNoite[]; total: Centavos; violacoes: Violacao[] };

export async function cotar(ctx: Contexto, p: PedidoCotacao): Promise<Cotacao> {
  const base = (await listarTabelasBase(ctx)).find((t) => t.categoriaId === p.categoriaId);
  if (!base) {
    throw new ErroDominio(
      "TABELA_BASE_AUSENTE",
      "Esta categoria não tem tabela de preços. Cadastre a tabela base em Tarifas.",
      { categoriaId: p.categoriaId },
    );
  }
  const canal = (await listarCanais(ctx)).find((c) => c.nome === p.canal);
  if (!canal) {
    throw new ErroDominio("CANAL_INEXISTENTE", `O canal "${p.canal}" não está cadastrado. Escolha um canal existente.`, { canal: p.canal });
  }

  const config = await obterConfig(ctx);
  const temporadas = (await listarTemporadas(ctx)).sort((a, b) => b.prioridade - a.prioridade || a.id.localeCompare(b.id));
  const diaSemana = new Map((await listarPercentuaisDiaSemana(ctx)).map((x) => [x.dia, x.percentual]));
  const faixasOcupacao = await listarFaixasOcupacao(ctx);
  const faixasCrianca = await listarFaixasCrianca(ctx);
  const datas = noites(p.chegada, p.saida);

  // Pacote: ativo, da categoria e com noites da estadia dentro da janela ≥ mínimo; vale só nas noites cobertas.
  const pacote = (await listarPacotes(ctx)).find((k) => {
    if (!k.ativo || k.categoriaId !== p.categoriaId) return false;
    return datas.filter((d) => d >= k.inicio && d <= k.fim).length >= k.minNoites;
  });

  const resultado: ValorNoite[] = [];
  for (const data of datas) {
    const temp = temporadas.find((t) => data >= t.inicio && data <= t.fim);
    const tabelaTemp = temp?.tabelas.find((t) => t.categoriaId === p.categoriaId);
    const regras: RegrasNoite = {
      tabelaPadrao: { porAdultos: base.porAdultos, adultoExtra: base.adultoExtra },
      canal: { nome: canal.nome, percentual: canal.percentual },
      faixasOcupacao,
      ocupacaoPct: await ocupacaoCategoria(ctx, p.categoriaId, data, p.ignorarReservaId),
      faixasCrianca,
      limiteCriancasGratis: config.limiteCriancasGratis,
      idadeAdulto: config.idadeAdulto,
      arredondamento: config.arredondamento,
    };
    if (temp) {
      regras.temporada = { nome: temp.nome };
      if (temp.percentual !== null) regras.temporada.percentual = temp.percentual;
      if (tabelaTemp) regras.temporada.tabela = { porAdultos: tabelaTemp.porAdultos, adultoExtra: tabelaTemp.adultoExtra };
    }
    const pctDia = diaSemana.get(diaDaSemana(data));
    if (pctDia !== undefined) regras.percentualDiaSemana = pctDia;
    if (base.piso !== null) regras.piso = base.piso;
    if (base.teto !== null) regras.teto = base.teto;
    if (pacote && data >= pacote.inicio && data <= pacote.fim) {
      regras.pacote = { nome: pacote.nome, valorNoite: pacote.valorNoite };
    }
    resultado.push(calcularNoite(data, p.chegada, p.hospedes, regras));
  }

  return {
    noites: resultado,
    total: resultado.reduce((s, n) => s + n.valor, 0),
    violacoes: await verificarRestricoes(ctx, p.categoriaId, p.chegada, p.saida),
  };
}
