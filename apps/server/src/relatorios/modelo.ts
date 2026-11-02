import type { z } from "zod";
import type { Permissao, UsuarioSessao } from "../nucleo/permissoes.js";
import type { Contexto } from "../shared/contexto.js";

export type Coluna = { chave: string; titulo: string; tipo: "texto" | "numero" | "dinheiro" | "data" | "em-branco" };
export type Secao = {
  titulo?: string;
  colunas: Coluna[];
  /** Dinheiro em centavos, datas em YYYY-MM-DD; a formatação é da tela. */
  linhas: Record<string, string | number | null>[];
  totais?: Record<string, string | number>;
};
export type Relatorio = {
  id: string;
  titulo: string;
  subtitulo: string;
  geradoEm: string;
  /** Únicos valores já formatados para leitura (ex.: "R$ 1.234,56"). */
  resumo: { rotulo: string; valor: string }[];
  secoes: Secao[];
};

/** Um relatório do catálogo: para criar outro, basta uma entrada em REGISTRO (rotas.ts). */
export type DefinicaoRelatorio<F = unknown> = {
  id: string;
  permissao: Permissao;
  filtros: z.ZodType<F, unknown>;
  gerar: (ctx: Contexto, filtros: F, usuario: UsuarioSessao) => Promise<Relatorio>;
};

/** Mantém o tipo do filtro amarrado entre `filtros` e `gerar`, apagando-o para o registro. */
export function definir<F>(d: DefinicaoRelatorio<F>): DefinicaoRelatorio {
  return d as unknown as DefinicaoRelatorio;
}

export const A_DEFINIR = "a definir";
