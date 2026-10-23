import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chamarApi, ErroApi } from "./cliente";
import type { ItemListaReserva, LinhaExtrato, Mapa, Painel, ReservaDetalhe, ResultadoBusca } from "./tipos";

export function criarQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
        retry: (tentativas, erro) => {
          if (erro instanceof ErroApi && erro.status >= 400 && erro.status < 500) return false;
          return tentativas < 1;
        },
      },
    },
  });
}

/** Monta ?a=1&b=2 ignorando valores vazios. */
function consulta(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export type ParamsMapa = { inicio: string; fim: string; categoriaId?: string };
export type FiltrosReservas = { inicio?: string; fim?: string; estado?: string; canal?: string; q?: string; pagina?: number; porPagina?: number };
export type ContaDetalhe = { saldo: { debitos: number; creditos: number; saldo: number }; extrato: LinhaExtrato[] };

export const usePainel = () => useQuery({ queryKey: ["painel"], queryFn: () => chamarApi<Painel>("GET", "/api/painel") });

export const useMapa = (p: ParamsMapa) =>
  useQuery({
    queryKey: ["mapa", p.inicio, p.fim, p.categoriaId],
    queryFn: () => chamarApi<Mapa>("GET", `/api/mapa${consulta({ inicio: p.inicio, fim: p.fim, categoriaId: p.categoriaId })}`),
  });

export const useReserva = (id: string) =>
  useQuery({ queryKey: ["reserva", id], queryFn: () => chamarApi<ReservaDetalhe>("GET", `/api/reservas/${encodeURIComponent(id)}`) });

export const useConta = (id: string) =>
  useQuery({ queryKey: ["conta", id], queryFn: () => chamarApi<ContaDetalhe>("GET", `/api/contas/${encodeURIComponent(id)}`) });

export const useReservas = (f: FiltrosReservas) =>
  useQuery({
    queryKey: ["reservas", f],
    queryFn: () => chamarApi<{ itens: ItemListaReserva[]; total: number }>("GET", `/api/reservas${consulta({ ...f })}`),
  });

// Caixa e governança ganham tipo próprio quando suas telas chegarem.
export const useCaixa = () => useQuery({ queryKey: ["caixa"], queryFn: () => chamarApi<unknown>("GET", "/api/caixa/atual") });

export const useGovernanca = () => useQuery({ queryKey: ["governanca"], queryFn: () => chamarApi<unknown[]>("GET", "/api/governanca") });

export const useBusca = (q: string) =>
  useQuery({
    queryKey: ["busca", q],
    queryFn: () => chamarApi<ResultadoBusca[]>("GET", `/api/busca${consulta({ q })}`),
    enabled: q.trim().length > 0,
  });

const CHAVES_INVALIDADAS = ["painel", "mapa", "reserva", "conta", "reservas", "caixa", "governanca"] as const;

/** Mutação que, ao dar certo, refaz as consultas que dependem do estado da pousada. */
export function useAcao<TCorpo, TResp>(fn: (corpo: TCorpo) => Promise<TResp>) {
  const cliente = useQueryClient();
  return useMutation<TResp, Error, TCorpo>({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(CHAVES_INVALIDADAS.map((k) => cliente.invalidateQueries({ queryKey: [k] })));
    },
  });
}
