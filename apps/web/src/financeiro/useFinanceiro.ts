import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
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
  categoria?: string;
  vencimento?: string;
  /** Dia local (da pousada) dos instantes: é o que a tela mostra. */
  dia: string;
  vencimento_dia?: string | null;
  referencia_tipo?: string;
  parcela_de?: string;
  valor_total?: number;
  fornecedor_id?: string;
  fornecedor_nome?: string | null;
  status: "pendente" | "confirmado" | "liquidado" | "cancelado";
  valor: number;
};
export type Local = { id: string; nome: string; ativo: boolean; hospedagem_padrao: boolean };
export type Conta = { id: string; local_id: string; nome: string; banco: string; agencia: string; numero: string; tipo: string; saldo_inicial: number; saldo: number };
export type Fornecedor = { id: string; local_id: string; razao_social: string; cnpj: string | null };
export type Contato = { email?: string; telefone?: string; endereco?: string };
export type Politica = { prazo_dias?: number; forma_cobranca?: "boleto" | "pix" | "deposito"; observacoes?: string };
export type FormaCobranca = "boleto" | "pix" | "deposito";
export type Faturamento = {
  id: string; cliente_id: string; cliente_nome: string; cliente_documento: string | null; cliente_contato: Contato; cliente_politica: Politica;
  reserva_codigo: number | null; valor_original: number; valor_liquido: number; data_vencimento: string; forma_cobranca: FormaCobranca;
  numero_documento: string; status: string; fechada: boolean; criado_em: string;
};
export type TipoCartao = "credito" | "debito" | "voucher";
export type MovimentoCartao = {
  id: string; local_id: string; data: string; adquirente: string; bandeira: string; tipo: TipoCartao; valor_bruto: number; taxa_percentual: number;
  prazo_dias: number; valor_taxa: number; valor_liquido: number; previsao: string; status: "a_receber" | "baixado" | "cancelado";
  /** 1 = entrou sem condição de cobrança cadastrada: precisa de revisão antes da baixa. */
  revisar: number;
};
export type CondicaoCartao = { id: string; local_id: string; adquirente: string; bandeira: string; tipo: TipoCartao; prazo_dias: number; taxa_percentual: number; ativo: boolean };
export type ExtratoCobranca = {
  numero_documento: string; forma_cobranca: string; data_vencimento: string; status: string; total: number;
  cliente: { id: string; nome: string; documento: string | null; contato: Contato };
  itens: { id: string; reserva_codigo: number | null; hospede: string | null; chegada: string | null; saida: string | null; valor: number }[];
};
export type Saldo = { conta_id: string; data: string; saldo: number };
export type SituacaoReceber = "aberto" | "vencido" | "parcialmente_recebido" | "recebido";
type Totais = { quantidade: number; valor_original: number; valor_recebido: number; valor_pendente: number };
export type ContasReceber = {
  local_id: string;
  situacoes: Record<SituacaoReceber, Totais>;
  itens: {
    id: string; numero_documento: string; cliente_id: string; cliente_nome: string; parcela_de: string | null; valor_total: number | null; data_vencimento: string;
    valor_original: number; valor_recebido: number; valor_pendente: number; situacao: SituacaoReceber;
  }[];
};
export type FluxoCaixa = {
  local_id: string; data: string; saldo_inicial: number; entradas: number; saidas: number;
  transferencias_entrada: number; transferencias_saida: number; taxas_cartao: number; saldo_final: number;
};
export type Consolidado = {
  data_inicio: string; data_fim: string;
  locais: { local_id: string; nome: string; saldo_inicial: number; recebimentos: number; pagamentos: number; taxas_cartao: number; saldo_final: number }[];
  total: { saldo_inicial: number; recebimentos: number; pagamentos: number; taxas_cartao: number; saldo_final: number };
};
export type Extrato = {
  conta_id: string; saldo_inicial: number; total_creditos: number; total_debitos: number; saldo_final: number;
  movimentos: {
    id: string; data: string; dia: string; tipo: string; lancamento_id: string; credito: number; debito: number; saldo_posterior: number;
    descricao: string; origem: string; estornavel: boolean;
  }[];
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
export function useLancamentos(localId: string, periodo: Partial<Periodo>, tipo?: Lancamento["tipo"]) {
  return useQuery({
    queryKey: ["financeiro", "lancamentos", localId, periodo.inicio, periodo.fim, tipo],
    enabled: !!localId,
    queryFn: () => chamarApi<Lancamento[]>("GET", `${BASE}/lancamentos${qs({ local_id: localId, data_inicio: periodo.inicio, data_fim: periodo.fim, tipo })}`),
  });
}

export const useLocais = () =>
  useQuery({ queryKey: ["financeiro", "locais"], queryFn: () => chamarApi<Local[]>("GET", `${BASE}/locais`) });

export const useContas = (localId: string) =>
  useQuery({
    queryKey: ["financeiro", "contas", localId],
    enabled: !!localId,
    queryFn: () => chamarApi<Conta[]>("GET", `${BASE}/contas${qs({ local_id: localId })}`),
  });

export const useFornecedores = (localId: string) =>
  useQuery({
    queryKey: ["financeiro", "fornecedores", localId],
    enabled: !!localId,
    queryFn: () => chamarApi<Fornecedor[]>("GET", `${BASE}/fornecedores${qs({ local_id: localId })}`),
  });

export const useFaturamentos = (localId: string) =>
  useQuery({
    queryKey: ["financeiro", "faturamentos", localId],
    enabled: !!localId,
    queryFn: () => chamarApi<Faturamento[]>("GET", `${BASE}/faturamentos${qs({ local_id: localId })}`),
  });

export const useMovimentosCartao = (localId: string) =>
  useQuery({
    queryKey: ["financeiro", "cartao-movimentos", localId],
    enabled: !!localId,
    queryFn: () => chamarApi<MovimentoCartao[]>("GET", `${BASE}/cartao/movimentos${qs({ local_id: localId })}`),
  });

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

/** Chave de envio: a mesma ação reenviada (duplo clique, nova tentativa) carrega a mesma chave e o servidor só a executa uma vez. */
export const novaChave = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Mutação que atualiza todas as consultas do Financeiro ao concluir. Com `comChave`, envia `chave` no corpo; ela só muda após um sucesso. */
function useAcaoFinanceira<T>(fn: (corpo: T, chave: string) => Promise<unknown>, comChave = false) {
  const cliente = useQueryClient();
  const chave = useRef(novaChave());
  return useMutation<unknown, Error, T>({
    mutationFn: (corpo) => fn(corpo, chave.current),
    onSuccess: () => {
      if (comChave) chave.current = novaChave();
      return cliente.invalidateQueries({ queryKey: ["financeiro"] });
    },
  });
}

export const useCancelarLancamento = () =>
  useAcaoFinanceira(({ id, aut }: { id: string; aut: Autorizacao }) =>
    chamarApi("DELETE", `${BASE}/lancamentos/${encodeURIComponent(id)}`, { motivo: aut.motivo, supervisor: aut.supervisor }));

export const useEstornarLancamento = () =>
  useAcaoFinanceira(({ id, aut }: { id: string; aut: Autorizacao }) =>
    chamarApi("POST", `${BASE}/lancamentos/${encodeURIComponent(id)}/estornar`, { motivo: aut.motivo, supervisor: aut.supervisor }));

export const useTransferir = () =>
  useAcaoFinanceira((c: { origem: string; destino: string; valor: number }, chave) => chamarApi("POST", `${BASE}/caixa-banco/transferencia`, { ...c, chave }), true);

export const useConfirmarPagamento = () =>
  useAcaoFinanceira(({ id, valor, contaId, novoVencimento }: { id: string; valor: number; contaId: string; novoVencimento?: string }, chave) =>
    chamarApi("PUT", `${BASE}/contas-receber/${encodeURIComponent(id)}/confirmar-pagamento`, { valor, conta_bancaria_id: contaId, novo_vencimento: novoVencimento, chave }), true);

export const useSalvarLocal = () =>
  useAcaoFinanceira(({ id, ...corpo }: { id?: string; nome?: string; ativo?: boolean; hospedagem_padrao?: boolean }, chave) =>
    id ? chamarApi("PUT", `${BASE}/locais/${encodeURIComponent(id)}`, corpo) : chamarApi("POST", `${BASE}/locais`, { ...corpo, chave }), true);

export const useCriarConta = () =>
  useAcaoFinanceira((c: { local_id: string; nome: string; banco: string; agencia: string; numero: string; tipo: string; saldo_inicial: number }, chave) =>
    chamarApi("POST", `${BASE}/contas`, { ...c, chave }), true);

export const useCriarFornecedor = () =>
  useAcaoFinanceira((c: { local_id: string; razao_social: string; cnpj?: string }, chave) => chamarApi<Fornecedor>("POST", `${BASE}/fornecedores`, { ...c, chave }), true);

export const useCriarContaPagar = () =>
  useAcaoFinanceira((c: { local_id: string; descricao: string; categoria: string; valor: number; vencimento: string; fornecedor_id?: string }, chave) =>
    chamarApi("POST", `${BASE}/contas-a-pagar`, { ...c, chave }), true);

export const useBaixarContaPagar = () =>
  useAcaoFinanceira(({ id, ...corpo }: { id: string; conta_id: string; forma_pagamento: string; valor?: number; novo_vencimento?: string }) =>
    chamarApi("PUT", `${BASE}/contas-a-pagar/${encodeURIComponent(id)}/baixar`, corpo));

export const useCriarMovimentoCartao = () =>
  useAcaoFinanceira((c: { local_id: string; data: string; valor: number; informado: "bruto" | "liquido"; condicao_id: string }, chave) =>
    chamarApi("POST", `${BASE}/cartao/movimentos`, { ...c, chave }), true);

export const useBaixarCartao = () =>
  useAcaoFinanceira(({ id, ...corpo }: { id: string; conta_id: string; taxa_percentual?: number; condicao_id?: string }) =>
    chamarApi("PUT", `${BASE}/cartao/movimentos/${encodeURIComponent(id)}/baixar`, corpo));

export const useFecharFatura = () =>
  useAcaoFinanceira(async (c: { ids: string[]; clienteId: string; contato: Contato; politica: Politica; forma: FormaCobranca; data_vencimento: string }, chave) => {
    await chamarApi("PUT", `${BASE}/clientes/${encodeURIComponent(c.clienteId)}`, { contato: c.contato, politica: c.politica });
    return chamarApi("POST", `${BASE}/faturamentos/fechar-grupo`, { ids: c.ids, forma: c.forma, data_vencimento: c.data_vencimento, chave });
  }, true);

export const useCondicoesCartao = (localId: string) =>
  useQuery({
    queryKey: ["financeiro", "condicoes-cartao", localId],
    enabled: !!localId,
    queryFn: () => chamarApi<CondicaoCartao[]>("GET", `${BASE}/cobranca/condicoes${qs({ local_id: localId })}`),
  });

export const useSalvarCondicao = () =>
  useAcaoFinanceira(({ id, ...corpo }: { id?: string; local_id?: string; adquirente?: string; bandeira?: string; tipo?: TipoCartao; prazo_dias?: number; taxa_percentual?: number; ativo?: boolean }, chave) =>
    id ? chamarApi("PUT", `${BASE}/cobranca/condicoes/${encodeURIComponent(id)}`, corpo) : chamarApi("POST", `${BASE}/cobranca/condicoes`, { ...corpo, chave }), true);

export const useExtratoCobranca = (localId: string, numero: string) =>
  useQuery({
    queryKey: ["financeiro", "extrato-cobranca", localId, numero],
    enabled: !!localId && !!numero,
    queryFn: () => chamarApi<ExtratoCobranca>("GET", `${BASE}/faturamentos/extrato${qs({ local_id: localId, numero })}`),
  });
