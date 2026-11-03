import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chamarApi } from "../api/cliente";
import type { Autorizacao } from "../componentes/JanelaSupervisor";

export type Lancamento = {
  id: string;
  local_id: string;
  data: string;
  tipo: "recebimento" | "pagamento" | "transferencia" | "ajuste";
  origem: string;
  forma_pagamento: string;
  descricao: string;
  status: "pendente" | "confirmado" | "liquidado" | "cancelado";
  valor: number;
};
export type Saldo = { conta_id: string; data: string; saldo: number };
export type SituacaoReceber = "aberto" | "vencido" | "parcialmente_recebido" | "recebido";
type Totais = { quantidade: number; valor_original: number; valor_recebido: number; valor_pendente: number };
export type ContasReceber = {
  local_id: string;
  situacoes: Record<SituacaoReceber, Totais>;
  itens: {
    id: string; numero_documento: string; cliente_id: string; data_vencimento: string;
    valor_original: number; valor_recebido: number; valor_pendente: number; situacao: SituacaoReceber;
  }[];
};
export type FluxoCaixa = {
  local_id: string; data: string; saldo_inicial: number; entradas: number; saidas: number;
  transferencias_entrada: number; transferencias_saida: number; saldo_final: number;
};
export type Consolidado = {
  data_inicio: string; data_fim: string;
  locais: { local_id: string; nome: string; saldo_inicial: number; recebimentos: number; pagamentos: number; saldo_final: number }[];
  total: { saldo_inicial: number; recebimentos: number; pagamentos: number; saldo_final: number };
};
export type Extrato = {
  conta_id: string; saldo_inicial: number; total_creditos: number; total_debitos: number; saldo_final: number;
  movimentos: { id: string; data: string; tipo: string; lancamento_id: string; credito: number; debito: number; saldo_posterior: number }[];
};
export type Cartao = Record<"aberto" | "fechado" | "liquidado", { quantidade: number; valor: number }>;

export type Periodo = { inicio: string; fim: string };

/** Data local AAAA-MM-DD, `dias` dias a partir de hoje. */
export function dataLocal(dias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  return `?${p.toString()}`;
}

const BASE = "/api/financeiro";

/** Consultas do módulo Financeiro; `localId`/`contaId` vazios desligam a consulta correspondente. */
export function useLancamentos(localId: string, periodo: Partial<Periodo>) {
  return useQuery({
    queryKey: ["financeiro", "lancamentos", localId, periodo.inicio, periodo.fim],
    enabled: !!localId,
    queryFn: () => chamarApi<Lancamento[]>("GET", `${BASE}/lancamentos${qs({ local_id: localId, data_inicio: periodo.inicio, data_fim: periodo.fim })}`),
  });
}

export function useSaldo(contaId: string) {
  return useQuery({
    queryKey: ["financeiro", "saldo", contaId],
    enabled: !!contaId,
    queryFn: () => chamarApi<Saldo>("GET", `${BASE}/caixa-banco/saldo${qs({ conta_id: contaId })}`),
  });
}

export function useContasReceber(localId: string) {
  return useQuery({
    queryKey: ["financeiro", "contas-receber", localId],
    enabled: !!localId,
    queryFn: () => chamarApi<ContasReceber>("GET", `${BASE}/relatorios/contas-receber${qs({ local_id: localId })}`),
  });
}

export function useFluxoCaixa(localId: string, data: string) {
  return useQuery({
    queryKey: ["financeiro", "fluxo-caixa", localId, data],
    enabled: !!localId,
    queryFn: () => chamarApi<FluxoCaixa>("GET", `${BASE}/relatorios/fluxo-caixa${qs({ local_id: localId, data })}`),
  });
}

export function useConsolidado(periodo: Periodo) {
  return useQuery({
    queryKey: ["financeiro", "consolidado", periodo.inicio, periodo.fim],
    queryFn: () => chamarApi<Consolidado>("GET", `${BASE}/relatorios/consolidado${qs({ data_inicio: periodo.inicio, data_fim: periodo.fim })}`),
  });
}

export function useMovimento(contaId: string, periodo: Periodo) {
  return useQuery({
    queryKey: ["financeiro", "movimento", contaId, periodo.inicio, periodo.fim],
    enabled: !!contaId,
    queryFn: () => chamarApi<Extrato>("GET", `${BASE}/relatorios/movimento${qs({ conta_id: contaId, data_inicio: periodo.inicio, data_fim: periodo.fim })}`),
  });
}

export function useCartao(localId: string) {
  return useQuery({
    queryKey: ["financeiro", "cartao", localId],
    enabled: !!localId,
    queryFn: () => chamarApi<Cartao>("GET", `${BASE}/relatorios/cartao${qs({ local_id: localId })}`),
  });
}

/** Mutação que atualiza todas as consultas do Financeiro ao concluir. */
function useAcaoFinanceira<T>(fn: (corpo: T) => Promise<unknown>) {
  const cliente = useQueryClient();
  return useMutation<unknown, Error, T>({
    mutationFn: fn,
    onSuccess: () => cliente.invalidateQueries({ queryKey: ["financeiro"] }),
  });
}

export const useCancelarLancamento = () =>
  useAcaoFinanceira(({ id, aut }: { id: string; aut: Autorizacao }) =>
    chamarApi("DELETE", `${BASE}/lancamentos/${encodeURIComponent(id)}`, { motivo: aut.motivo, supervisor: aut.supervisor }));

export const useTransferir = () =>
  useAcaoFinanceira((c: { origem: string; destino: string; valor: number }) => chamarApi("POST", `${BASE}/caixa-banco/transferencia`, c));

export const useConfirmarPagamento = () =>
  useAcaoFinanceira(({ id, valor, contaId }: { id: string; valor: number; contaId: string }) =>
    chamarApi("PUT", `${BASE}/contas-receber/${encodeURIComponent(id)}/confirmar-pagamento`, { valor, conta_bancaria_id: contaId }));
