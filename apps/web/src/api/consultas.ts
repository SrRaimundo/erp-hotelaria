import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chamarApi, ErroApi } from "./cliente";
import { useConexao } from "./useConexao";
import type { Categoria, ConfigPousada, FormaPagamento, ItemListaReserva, LinhaExtrato, Mapa, Painel, Produto, ReservaDetalhe, ResultadoBusca, ResumoCaixa, ItemGovernanca, Setor } from "./tipos";

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

/** Offline: tenta de 5 em 5 s para a faixa de conexão sumir logo que o servidor voltar. */
export function usePainel(ativo = true) {
  const { online } = useConexao();
  return useQuery({
    queryKey: ["painel"],
    queryFn: () => chamarApi<Painel>("GET", "/api/painel"),
    enabled: ativo,
    refetchInterval: online ? 30_000 : 5_000,
  });
}

/** Horários de check-in/check-out para os subtítulos; se a consulta falhar, a tela simplesmente omite os horários. */
export const useConfigHorarios = () =>
  useQuery({ queryKey: ["config"], queryFn: () => chamarApi<{ horaCheckin: string; horaCheckout: string }>("GET", "/api/config"), staleTime: 300_000 });

/** Configuração completa da pousada (tela Pousada); compartilha a chave com os horários. */
export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: () => chamarApi<ConfigPousada>("GET", "/api/config") });

export const useMapa = (p: ParamsMapa) =>
  useQuery({
    queryKey: ["mapa", p.inicio, p.fim, p.categoriaId],
    queryFn: () => chamarApi<Mapa>("GET", `/api/mapa${consulta({ inicio: p.inicio, fim: p.fim, categoriaId: p.categoriaId })}`),
  });

/** Categorias (id -> nome) para cruzar com o mapa, cujos quartos trazem só o nome. */
export const useCategorias = () =>
  useQuery({ queryKey: ["categorias"], queryFn: () => chamarApi<Categoria[]>("GET", "/api/categorias"), staleTime: 300_000 });

export const useReserva = (id: string) =>
  useQuery({ queryKey: ["reserva", id], queryFn: () => chamarApi<ReservaDetalhe>("GET", `/api/reservas/${encodeURIComponent(id)}`) });

export const useConta = (id: string) =>
  useQuery({ queryKey: ["conta", id], queryFn: () => chamarApi<ContaDetalhe>("GET", `/api/contas/${encodeURIComponent(id)}`) });

export const useReservas = (f: FiltrosReservas, ativo = true) =>
  useQuery({
    queryKey: ["reservas", f],
    queryFn: () => chamarApi<{ itens: ItemListaReserva[]; total: number }>("GET", `/api/reservas${consulta({ ...f })}`),
    enabled: ativo,
  });

/** Turno aberto do usuário; `null` quando não há caixa aberto. */
export const useCaixa = () => useQuery({ queryKey: ["caixa"], queryFn: () => chamarApi<ResumoCaixa | null>("GET", "/api/caixa/atual") });

/** Produtos ativos; com `setor`, só os vendidos naquele setor. */
export const useProdutos = (setor?: Setor) =>
  useQuery({
    queryKey: ["produtos", setor ?? null],
    queryFn: () => chamarApi<Produto[]>("GET", `/api/produtos${setor ? consulta({ setor }) : ""}`),
    staleTime: 300_000,
  });

/** Formas de pagamento ativas, na ordem fixa do servidor. */
export const useFormasPagamento = () =>
  useQuery({ queryKey: ["formas-pagamento"], queryFn: () => chamarApi<FormaPagamento[]>("GET", "/api/formas-pagamento"), staleTime: 300_000 });

export const useGovernanca = (ativo = true) =>
  useQuery({ queryKey: ["governanca"], queryFn: () => chamarApi<ItemGovernanca[]>("GET", "/api/governanca"), enabled: ativo });

export const useBusca = (q: string) =>
  useQuery({
    queryKey: ["busca", q],
    queryFn: () => chamarApi<ResultadoBusca[]>("GET", `/api/busca${consulta({ q })}`),
    enabled: q.trim().length > 0,
  });

const CHAVES_INVALIDADAS = ["painel", "mapa", "reserva", "conta", "reservas", "caixa", "governanca", "busca", "hospedes"] as const;

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
