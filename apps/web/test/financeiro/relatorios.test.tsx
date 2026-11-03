import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { abrirAba, BANCO, rotasBase } from "./base";

afterEach(() => vi.unstubAllGlobals());

const vazio = { quantidade: 0, valor_original: 0, valor_recebido: 0, valor_pendente: 0 };
const rotas = (extra: Record<string, unknown> = {}) => ({
  ...rotasBase(),
  "GET /api/financeiro/relatorios/fluxo-caixa": {
    local_id: "l1", data: "2026-11-02", saldo_inicial: 10000, entradas: 25000, saidas: 5000, transferencias_entrada: 0, transferencias_saida: 0, saldo_final: 30000,
  },
  "GET /api/financeiro/relatorios/consolidado": {
    data_inicio: "a", data_fim: "b", locais: [{ local_id: "l1", nome: "Pousada Sol", saldo_inicial: 0, recebimentos: 50000, pagamentos: 8000, saldo_final: 42000 }],
    total: { saldo_inicial: 0, recebimentos: 50000, pagamentos: 8000, saldo_final: 42000 },
  },
  "GET /api/financeiro/relatorios/contas-receber": {
    local_id: "l1", itens: [],
    situacoes: { aberto: { ...vazio, quantidade: 2, valor_pendente: 7000 }, vencido: vazio, parcialmente_recebido: { ...vazio, quantidade: 1, valor_pendente: 1500 }, recebido: { ...vazio, quantidade: 1, valor_recebido: 9000 } },
  },
  "GET /api/financeiro/relatorios/movimento": { conta_id: "c1", saldo_inicial: 0, total_creditos: 25000, total_debitos: 5000, saldo_final: 20000, movimentos: [] },
  "GET /api/financeiro/relatorios/cartao": {
    local_id: "l1", aberto: { quantidade: 3, valor: 30000 }, fechado: { quantidade: 1, valor: 4000 }, liquidado: { quantidade: 2, valor: 9000 },
  },
  ...extra,
});

describe("tela Relatórios do Financeiro", () => {
  test("mostra os cinco relatórios do MVP com valores em reais e rótulos em português", async () => {
    instalarApiFalsa(rotas());
    await abrirAba("relatorios");
    const fluxo = (await screen.findByRole("heading", { name: "Fluxo de caixa (hoje)" })).parentElement!;
    expect(within(fluxo).getByText("R$ 300,00")).toBeInTheDocument();
    const consolidado = screen.getByRole("heading", { name: /Consolidado por local/ }).parentElement!;
    expect(within(consolidado).getByText("R$ 500,00")).toBeInTheDocument();
    const receber = screen.getByRole("heading", { name: "Contas a receber" }).parentElement!;
    expect(within(receber).getByText("Aberto (2)")).toBeInTheDocument();
    expect(within(receber).getByText("Parcialmente recebido (1)")).toBeInTheDocument();
    const movimento = screen.getByRole("heading", { name: /Movimento da conta/ }).parentElement!;
    expect(within(movimento).getByText("R$ 200,00")).toBeInTheDocument();
    const cartao = screen.getByRole("heading", { name: "Cartão (líquido)" }).parentElement!;
    expect(within(cartao).getByText("A receber (3)")).toBeInTheDocument();
    expect(within(cartao).getByText("Pronto para baixar (1)")).toBeInTheDocument();
    expect(within(cartao).getByText("Baixado (2)")).toBeInTheDocument();
  });

  test("o extrato acompanha a conta escolhida no topo, em lista", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas());
    await abrirAba("relatorios");
    await screen.findByRole("heading", { name: /Movimento da conta/ });
    await u.selectOptions(screen.getByLabelText("Conta (caixa/banco)"), BANCO.id);
    await vi.waitFor(() => expect(chamadas.some((c) => c.caminho.startsWith("/api/financeiro/relatorios/movimento") && c.caminho.includes("conta_id=c2"))).toBe(true));
  });

  test("erro de um relatório aparece no próprio painel, sem derrubar os outros", async () => {
    instalarApiFalsa(rotas({ "GET /api/financeiro/relatorios/cartao": { __status: 500, codigo: "ERRO_INTERNO", mensagem: "Algo deu errado no servidor. Tente de novo." } }));
    await abrirAba("relatorios");
    const cartao = (await screen.findByRole("heading", { name: "Cartão (líquido)" })).parentElement!;
    expect(await within(cartao).findByRole("alert")).toHaveTextContent("Algo deu errado no servidor.");
    expect(screen.getByRole("heading", { name: "Fluxo de caixa (hoje)" })).toBeInTheDocument();
  });
});
