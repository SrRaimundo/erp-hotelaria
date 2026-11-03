import { z } from "zod";
import { formatarBRL } from "../shared/dinheiro.js";
import { diasEntre, somarDias } from "../shared/tempo.js";
import { filtrosPeriodo } from "./caixa.js";
import { periodoDoMes, VENDIDAS } from "./canais.js";
import { dataBR, percentual, razaoCentavos } from "./formato.js";
import { definir, type Coluna, type Relatorio, type Secao } from "./modelo.js";

type Totais = { disponiveis: number; vendidos: number; receita: number };

const COLUNAS: Coluna[] = [
  { chave: "disponiveis", titulo: "Quartos disponíveis (noites)", tipo: "numero" },
  { chave: "vendidos", titulo: "Quartos vendidos (noites)", tipo: "numero" },
  { chave: "ocupacao", titulo: "Ocupação", tipo: "numero" },
  { chave: "receita", titulo: "Receita de quartos", tipo: "dinheiro" },
  { chave: "diariaMedia", titulo: "Diária média", tipo: "dinheiro" },
  { chave: "revpar", titulo: "RevPAR", tipo: "dinheiro" },
];

const linha = (t: Totais) => ({
  disponiveis: t.disponiveis, vendidos: t.vendidos, ocupacao: percentual(t.vendidos, t.disponiveis), receita: t.receita,
  diariaMedia: razaoCentavos(t.receita, t.vendidos), revpar: razaoCentavos(t.receita, t.disponiveis),
});
const secao = (titulo: string, t: Totais): Secao => ({ titulo, colunas: COLUNAS, linhas: [linha(t)] });
const texto = (v: number | string) => (typeof v === "number" ? formatarBRL(v) : v);

export const relatorioDesempenho = definir({
  id: "desempenho",
  permissao: "reservas.gerenciar",
  filtros: filtrosPeriodo.and(z.object({})),
  gerar: async (ctx, f): Promise<Relatorio> => {
    const { de, ate } = await periodoDoMes(ctx, f);
    const dias = diasEntre(de, somarDias(ate, 1));

    // Mesma base de quartos no período inteiro: os ativos hoje (a ativação não tem histórico).
    const ativos = await ctx.db.selectFrom("quartos").select("categoria_id").where("ativo", "=", 1).execute();
    const categorias = await ctx.db.selectFrom("categorias").select(["id", "nome"]).execute();

    // Mesmas noites do relatório "canais": reserva_noites do período de estadias vendidas (sem cancelada nem no-show).
    const nts = await ctx.db
      .selectFrom("reserva_noites as n")
      .innerJoin("reservas as r", "r.id", "n.reserva_id")
      .select(["r.categoria_id as categoriaId", "n.valor"])
      .where("n.data", ">=", de)
      .where("n.data", "<=", ate)
      .where("r.chegada", "<=", ate)
      .where("r.saida", ">", de)
      .where("r.estado", "in", [...VENDIDAS])
      .execute();

    const porCategoria = new Map<string, Totais>();
    const da = (id: string): Totais => {
      let c = porCategoria.get(id);
      if (!c) porCategoria.set(id, (c = { disponiveis: 0, vendidos: 0, receita: 0 }));
      return c;
    };
    for (const q of ativos) da(q.categoria_id).disponiveis += dias;
    for (const n of nts) {
      const c = da(n.categoriaId);
      c.vendidos += 1;
      c.receita += n.valor;
    }
    const nome = new Map(categorias.map((c) => [c.id, c.nome]));
    const lista = [...porCategoria].sort((a, b) => (nome.get(a[0]) ?? "").localeCompare(nome.get(b[0]) ?? "", "pt-BR"));
    const total = lista.reduce<Totais>(
      (t, [, c]) => ({ disponiveis: t.disponiveis + c.disponiveis, vendidos: t.vendidos + c.vendidos, receita: t.receita + c.receita }),
      { disponiveis: 0, vendidos: 0, receita: 0 },
    );

    return {
      id: "desempenho",
      titulo: "Desempenho",
      subtitulo: `Período de ${dataBR(de)} a ${dataBR(ate)} (${dias} ${dias === 1 ? "dia" : "dias"}) · quartos ativos hoje em todo o período · receita de hospedagem das noites vendidas`,
      geradoEm: ctx.relogio.agora().toISOString(),
      resumo: [
        { rotulo: "Quartos disponíveis (noites)", valor: String(total.disponiveis) },
        { rotulo: "Quartos vendidos (noites)", valor: String(total.vendidos) },
        { rotulo: "Ocupação", valor: percentual(total.vendidos, total.disponiveis) },
        { rotulo: "Receita de quartos", valor: formatarBRL(total.receita) },
        { rotulo: "Diária média", valor: texto(razaoCentavos(total.receita, total.vendidos)) },
        { rotulo: "RevPAR", valor: texto(razaoCentavos(total.receita, total.disponiveis)) },
      ],
      secoes: [secao("Total", total), ...lista.map(([id, c]) => secao(nome.get(id) ?? id, c))],
    };
  },
});
