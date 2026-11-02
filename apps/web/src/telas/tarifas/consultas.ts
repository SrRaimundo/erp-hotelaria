import { useQuery, type QueryClient } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import type { Canal, Categoria } from "../../api/tipos";

export type PorAdultos = { 1: number; 2: number; 3: number };
export type TabelaPreco = { porAdultos: PorAdultos; adultoExtra: number };
export type TabelaBaseCat = TabelaPreco & { categoriaId: string; piso: number | null; teto: number | null };
export type Temporada = { id: string; nome: string; inicio: string; fim: string; prioridade: number; percentual: number | null; tabelas: (TabelaPreco & { categoriaId: string })[] };
export type DiaSemana = { dia: number; percentual: number };
export type FaixaOcupacao = { acimaDe: number; percentual: number };
export type TipoFaixaCrianca = "gratis" | "percentual_adicional" | "fixo";
export type FaixaCrianca = { idadeMin: number; idadeMax: number; tipo: TipoFaixaCrianca; valor: number };
export type Pacote = { id: string; nome: string; categoriaId: string; inicio: string; fim: string; minNoites: number; valorNoite: PorAdultos; ativo: boolean };
export type Restricao = { categoriaId: string; data: string; minNoites: number | null; fechadoChegada: boolean; fechadoSaida: boolean; fechadoVenda: boolean };

/** Leitura de uma lista de regras; sai da cache quando qualquer aba de tarifas salva. */
export const useRegra = <T,>(nome: string, caminho: string, extra: unknown[] = [], ativo = true) =>
  useQuery({ queryKey: ["tarifas", nome, ...extra], queryFn: () => chamarApi<T>("GET", caminho), refetchInterval: false, enabled: ativo });

export const useCategoriasTarifa = () =>
  useQuery({ queryKey: ["categorias", "tarifas"], queryFn: () => chamarApi<Categoria[]>("GET", "/api/categorias"), refetchInterval: false });

export const useCanais = () =>
  useQuery({ queryKey: ["canais"], queryFn: () => chamarApi<Canal[]>("GET", "/api/tarifas/canais"), staleTime: 300_000, refetchInterval: false });

/** Depois de salvar uma regra: refaz as listas de tarifas, os canais e as cotações em cache. */
export async function aposSalvarTarifa(cliente: QueryClient): Promise<void> {
  await Promise.all([
    cliente.invalidateQueries({ queryKey: ["tarifas"] }),
    cliente.invalidateQueries({ queryKey: ["canais"] }),
    cliente.invalidateQueries({ queryKey: ["cotacao"] }),
  ]);
}
