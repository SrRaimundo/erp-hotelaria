import type { Barra, Mapa } from "../../api/tipos";
import { diasEntre, somarDiasIso } from "../../lib/datas";

/** Medidas da grade, em px; a lógica de arrastar (Tarefa 9) reaproveita as mesmas. */
export const LARGURA_COLUNA = 48;
export const ALTURA_LINHA = 40;
export const LARGURA_ROTULO = 132;

export type QuartoMapa = Mapa["quartos"][number];
export type PosicaoBarra = { coluna: number; largura: number; cortadaInicio: boolean; cortadaFim: boolean };
export type LinhaMapa = { chave: string; quarto: QuartoMapa | null; barras: Barra[] };
export type GrupoCategoria = { categoria: string; linhas: LinhaMapa[] };

export function colunasDoPeriodo(inicio: string, dias: number): string[] {
  return Array.from({ length: dias }, (_, i) => somarDiasIso(inicio, i));
}

/** Coluna 0-based da chegada; cobre as noites até `saida` (exclusiva); recortada nas bordas; null se fora do período. */
export function posicaoBarra(b: { chegada: string; saida: string }, inicio: string, dias: number): PosicaoBarra | null {
  const de = diasEntre(inicio, b.chegada);
  const ate = diasEntre(inicio, b.saida);
  if (ate <= 0 || de >= dias) return null;
  const coluna = Math.max(de, 0);
  return { coluna, largura: Math.min(ate, dias) - coluna, cortadaInicio: de < 0, cortadaFim: ate > dias };
}

/**
 * Agrupa os quartos por categoria (ordem alfabética) e acrescenta, por categoria, uma linha "sem quarto"
 * apenas quando há barra sem quarto nela. `nomesCategoria` traduz o `categoriaId` das barras para o nome
 * que os quartos carregam.
 */
export function linhaDeQuarto(quartos: QuartoMapa[], barras: Barra[], nomesCategoria: Record<string, string> = {}): GrupoCategoria[] {
  const grupos = new Map<string, LinhaMapa[]>();
  const grupo = (nome: string) => {
    if (!grupos.has(nome)) grupos.set(nome, []);
    return grupos.get(nome)!;
  };
  for (const q of quartos) {
    grupo(q.categoria).push({ chave: q.id, quarto: q, barras: barras.filter((b) => b.quartoId === q.id) });
  }
  const semQuarto = new Map<string, Barra[]>();
  for (const b of barras) {
    if (b.quartoId !== null) continue;
    const nome = nomesCategoria[b.categoriaId] ?? b.categoriaId;
    semQuarto.set(nome, [...(semQuarto.get(nome) ?? []), b]);
  }
  for (const [nome, lista] of semQuarto) grupo(nome).push({ chave: `sem-quarto:${nome}`, quarto: null, barras: lista });
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([categoria, linhas]) => ({ categoria, linhas }));
}

/** Pista (0-based) de cada item, para empilhar barras que se sobrepõem na linha "sem quarto". */
export function distribuirPistas(itens: { coluna: number; largura: number }[]): number[] {
  const fimDaPista: number[] = [];
  return itens.map((it) => {
    let p = fimDaPista.findIndex((fim) => fim <= it.coluna);
    if (p < 0) p = fimDaPista.length;
    fimDaPista[p] = it.coluna + it.largura;
    return p;
  });
}
