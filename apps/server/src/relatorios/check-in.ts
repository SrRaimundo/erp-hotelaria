import { ESTADOS_ATIVOS, type EstadoReserva } from "../hospedagem/estados.js";
import type { Contexto } from "../shared/contexto.js";
import { dataOuHoje, filtroData, reservasParaRelatorio, rotuloEstado, saldosDeContas } from "./consulta.js";
import { dataBR } from "./formato.js";
import { definir, type Coluna, type Relatorio } from "./modelo.js";

export const COLUNAS_MOVIMENTO: Coluna[] = [
  { chave: "codigo", titulo: "Código", tipo: "numero" },
  { chave: "hospede", titulo: "Hóspede", tipo: "texto" },
  { chave: "telefone", titulo: "Telefone", tipo: "texto" },
  { chave: "quarto", titulo: "Quarto", tipo: "texto" },
  { chave: "categoria", titulo: "Categoria", tipo: "texto" },
  { chave: "pessoas", titulo: "Pessoas", tipo: "numero" },
  { chave: "noites", titulo: "Noites", tipo: "numero" },
  { chave: "saldo", titulo: "Saldo", tipo: "dinheiro" },
  { chave: "situacao", titulo: "Situação", tipo: "texto" },
];

/** Check-in e check-out diferem só no lado da data (chegada ou saída) e nos textos. */
export async function listaDeMovimento(
  ctx: Contexto,
  p: { id: string; titulo: string; lado: "chegada" | "saida"; rotuloTotal: string; data: string | undefined },
): Promise<Relatorio> {
  const data = await dataOuHoje(ctx, p.data);
  // Saídas incluem as já finalizadas no dia ("Saiu"), depois das pendentes: é a lista completa de partidas da data.
  const estados: EstadoReserva[] = p.lado === "saida" ? [...ESTADOS_ATIVOS, "finalizada"] : ESTADOS_ATIVOS;
  const reservas = (await reservasParaRelatorio(ctx, estados, { [p.lado]: data })).sort(
    (a, b) => Number(a.estado === "finalizada") - Number(b.estado === "finalizada"),
  );
  const saldos = await saldosDeContas(ctx, reservas.map((r) => r.contaId));
  const linhas = reservas.map((r) => ({
    codigo: r.codigo, hospede: r.hospede, telefone: r.telefone, quarto: r.quarto, categoria: r.categoria,
    pessoas: r.adultos + r.criancas, noites: r.noites, saldo: saldos.get(r.contaId) ?? 0, situacao: r.estado === "finalizada" ? "Saiu" : rotuloEstado(r.estado),
  }));
  return {
    id: p.id,
    titulo: p.titulo,
    subtitulo: `${p.lado === "chegada" ? "Chegadas" : "Saídas"} em ${dataBR(data)}`,
    geradoEm: ctx.relogio.agora().toISOString(),
    resumo: [
      { rotulo: p.rotuloTotal, valor: String(linhas.length) },
      { rotulo: "Pessoas", valor: String(linhas.reduce((t, l) => t + l.pessoas, 0)) },
    ],
    secoes: [{ colunas: COLUNAS_MOVIMENTO, linhas }],
  };
}

export const relatorioCheckIn = definir({
  id: "check-in",
  permissao: "reservas.gerenciar",
  filtros: filtroData,
  gerar: (ctx, f) => listaDeMovimento(ctx, { id: "check-in", titulo: "Lista de check-in", lado: "chegada", rotuloTotal: "Chegadas", data: f.data }),
});
