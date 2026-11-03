import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { abrirAba, BANCO, CAIXA, esperarChamada, rotasBase } from "./base";

afterEach(() => vi.unstubAllGlobals());

const MOV = {
  id: "k1", local_id: "l1", data: "2026-11-10", bandeira: "Visa", tipo: "credito", valor_bruto: 10000, taxa_percentual: 2.5, valor_taxa: 250,
  valor_liquido: 9750, previsao: "2026-12-10", status: "a_receber", lancamento_id: "lx", conta_destino_id: null, baixado_em: null,
};
const BAIXADO = { ...MOV, id: "k2", bandeira: "Elo", tipo: "debito", status: "baixado", valor_bruto: 5000, valor_taxa: 100, valor_liquido: 4900 };

describe("tela Cartão de Crédito", () => {
  const rotas = (extra: Record<string, unknown> = {}) => ({ ...rotasBase(), "GET /api/financeiro/cartao/movimentos": [MOV, BAIXADO], ...extra });

  test("lista movimentos por bandeira e tipo com bruto, taxa, líquido e previsão", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas());
    await abrirAba("cartao");
    const linha = (await screen.findByText("Visa")).closest("tr")!;
    expect(within(linha).getByText("Crédito")).toBeInTheDocument();
    expect(within(linha).getByText("R$ 100,00")).toBeInTheDocument();
    expect(within(linha).getByText("R$ 2,50")).toBeInTheDocument();
    expect(within(linha).getByText("R$ 97,50")).toBeInTheDocument();
    expect(within(linha).getByText("10/12/2026")).toBeInTheDocument();
    expect(screen.getByText("Líquido a receber das operadoras: R$ 97,50")).toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText("Situação"), "Baixado");
    expect(screen.queryByText("Visa")).not.toBeInTheDocument();
    expect(screen.getByText("Elo")).toBeInTheDocument();
  });

  test("registra movimento informado pelo líquido: confere bruto e taxa e envia centavos e percentual", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "POST /api/financeiro/cartao/movimentos": { __status: 201, ...MOV } }));
    await abrirAba("cartao");
    await u.click(await screen.findByRole("button", { name: "+ Novo movimento" }));
    const painel = await screen.findByRole("dialog", { name: "Novo movimento de cartão" });
    fireEvent.change(within(painel).getByLabelText("Data da venda"), { target: { value: "2026-11-10" } });
    await u.selectOptions(within(painel).getByLabelText("Bandeira"), "Mastercard");
    await u.selectOptions(within(painel).getByLabelText("Tipo"), "Voucher");
    await u.selectOptions(within(painel).getByLabelText("O valor informado é"), "Líquido (já sem a taxa)");
    await u.type(within(painel).getByLabelText("Valor"), "97,50");
    await u.clear(within(painel).getByLabelText("Taxa da operadora (%)"));
    await u.type(within(painel).getByLabelText("Taxa da operadora (%)"), "2,5");
    const conf = within(painel).getByRole("list", { name: "Conferência dos valores" });
    expect(within(conf).getByText("R$ 100,00")).toBeInTheDocument();
    expect(within(conf).getByText("R$ 2,50")).toBeInTheDocument();
    await u.click(within(painel).getByRole("button", { name: "Registrar movimento" }));
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/cartao/movimentos");
    expect(post.corpo).toEqual({ local_id: "l1", data: "2026-11-10", bandeira: "Mastercard", tipo: "voucher", valor: 9750, informado: "liquido", taxa_percentual: 2.5 });
  });

  test("valor e taxa inválidos impedem o registro, com o motivo à vista", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas());
    await abrirAba("cartao");
    await u.click(await screen.findByRole("button", { name: "+ Novo movimento" }));
    const painel = await screen.findByRole("dialog", { name: "Novo movimento de cartão" });
    const registrar = within(painel).getByRole("button", { name: "Registrar movimento" });
    expect(registrar).toBeDisabled();
    expect(within(painel).getByText("Informe o valor.")).toBeInTheDocument();
    await u.type(within(painel).getByLabelText("Valor"), "10");
    await u.clear(within(painel).getByLabelText("Taxa da operadora (%)"));
    await u.type(within(painel).getByLabelText("Taxa da operadora (%)"), "100");
    expect(within(painel).getByText("Informe uma taxa entre 0% e 99,99%.")).toBeInTheDocument();
    expect(registrar).toBeDisabled();
  });

  test("baixa no Caixa e Banco com a taxa efetiva e a conta escolhida", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "PUT /api/financeiro/cartao/movimentos/k1/baixar": { ...MOV, status: "baixado" } }));
    await abrirAba("cartao");
    const linha = (await screen.findByText("Visa")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Baixar" }));
    const painel = await screen.findByRole("dialog", { name: "Baixar cartão" });
    expect(within(painel).getByLabelText("Conta que recebeu")).toHaveValue(CAIXA.id);
    await u.selectOptions(within(painel).getByLabelText("Conta que recebeu"), BANCO.id);
    await u.clear(within(painel).getByLabelText("Taxa cobrada (%)"));
    await u.type(within(painel).getByLabelText("Taxa cobrada (%)"), "3");
    expect(within(painel).getByText("R$ 97,00")).toBeInTheDocument();
    await u.click(within(painel).getByRole("button", { name: "Baixar no Caixa e Banco" }));
    const put = await esperarChamada(chamadas, "PUT", "/api/financeiro/cartao/movimentos/k1/baixar");
    expect(put.corpo).toEqual({ conta_id: BANCO.id, taxa_percentual: 3 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("erro na baixa fica no painel e movimento baixado não oferece nova baixa", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "PUT /api/financeiro/cartao/movimentos/k1/baixar": { __status: 422, codigo: "ESTADO_INVALIDO", mensagem: "Movimento já baixado." } }));
    await abrirAba("cartao");
    const baixado = (await screen.findByText("Elo")).closest("tr")!;
    expect(within(baixado).queryByRole("button", { name: "Baixar" })).not.toBeInTheDocument();
    await u.click(within((await screen.findByText("Visa")).closest("tr")!).getByRole("button", { name: "Baixar" }));
    const painel = await screen.findByRole("dialog", { name: "Baixar cartão" });
    await u.click(within(painel).getByRole("button", { name: "Baixar no Caixa e Banco" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Movimento já baixado.");
  });

  test("lista vazia explica que o cartão da hospedagem chega sozinho", async () => {
    instalarApiFalsa(rotas({ "GET /api/financeiro/cartao/movimentos": [] }));
    await abrirAba("cartao");
    expect(await screen.findByText(/Pagamentos em cartão da hospedagem aparecem aqui sozinhos/)).toBeInTheDocument();
  });
});

const FAT = {
  id: "f1", cliente_id: "cli1", cliente_nome: "Empresa X Ltda", cliente_documento: "11222333000181", cliente_contato: {}, cliente_politica: {},
  reserva_codigo: 42, valor_original: 90000, valor_liquido: 90000, data_vencimento: "2026-12-01T00:00:00.000Z", forma_cobranca: "boleto",
  numero_documento: "", status: "aberto", fechada: false, criado_em: "2026-11-02T12:00:00.000Z",
};
const FECHADA = { ...FAT, id: "f2", cliente_nome: "Hotel Y", numero_documento: "FAT-2026-000007", fechada: true, valor_liquido: 12000 };

describe("tela Faturamento", () => {
  const rotas = (extra: Record<string, unknown> = {}) => ({ ...rotasBase(), "GET /api/financeiro/faturamentos": [FAT, FECHADA], ...extra });

  test("mostra por padrão os fechamentos marcados para faturar e alterna para as faturas fechadas", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas());
    await abrirAba("faturamento");
    const linha = (await screen.findByText("Empresa X Ltda")).closest("tr")!;
    expect(within(linha).getByText("42")).toBeInTheDocument();
    expect(within(linha).getByText("R$ 900,00")).toBeInTheDocument();
    expect(screen.queryByText("Hotel Y")).not.toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText("Mostrar"), "Fechadas");
    expect(screen.getByText("Hotel Y")).toBeInTheDocument();
    expect(screen.getByText("FAT-2026-000007")).toBeInTheDocument();
    expect(screen.getByText("Em Contas a Receber")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fechar fatura" })).not.toBeInTheDocument();
  });

  test("fecha a fatura: salva dados e política do cliente e envia forma e vencimento", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({
      "PUT /api/financeiro/clientes/cli1": { ok: true },
      "POST /api/financeiro/faturamentos/f1/fechar": { ...FAT, numero_documento: "FAT-2026-000008" },
    }));
    await abrirAba("faturamento");
    const linha = (await screen.findByText("Empresa X Ltda")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Fechar fatura" }));
    const painel = await screen.findByRole("dialog", { name: "Fechar fatura" });
    expect(within(painel).getByText(/11222333000181/)).toBeInTheDocument();
    await u.type(within(painel).getByLabelText("E-mail para cobrança"), "fin@x.com");
    await u.type(within(painel).getByLabelText("Telefone"), "1199999");
    await u.type(within(painel).getByLabelText("Endereço"), "Rua A, 10");
    await u.clear(within(painel).getByLabelText("Prazo de pagamento (dias)"));
    await u.type(within(painel).getByLabelText("Prazo de pagamento (dias)"), "15");
    await u.selectOptions(within(painel).getByLabelText("Forma de cobrança"), "Pix");
    await u.type(within(painel).getByLabelText("Observações"), "Enviar nota junto");
    fireEvent.change(within(painel).getByLabelText("Vencimento desta fatura"), { target: { value: "2026-12-20" } });
    await u.click(within(painel).getByRole("button", { name: "Fechar fatura" }));
    const fechar = await esperarChamada(chamadas, "POST", "/api/financeiro/faturamentos/f1/fechar");
    expect(fechar.corpo).toEqual({ forma: "pix", data_vencimento: "2026-12-20" });
    const cliente = chamadas.find((c) => c.metodo === "PUT")!;
    expect(cliente.caminho).toBe("/api/financeiro/clientes/cli1");
    expect(cliente.corpo).toEqual({
      contato: { email: "fin@x.com", telefone: "1199999", endereco: "Rua A, 10" },
      politica: { prazo_dias: 15, forma_cobranca: "pix", observacoes: "Enviar nota junto" },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("a política já salva do cliente vem preenchida", async () => {
    const u = userEvent.setup();
    const fat = { ...FAT, cliente_contato: { email: "a@b.com" }, cliente_politica: { prazo_dias: 45, forma_cobranca: "deposito", observacoes: "Só às sextas" } };
    instalarApiFalsa(rotas({ "GET /api/financeiro/faturamentos": [fat] }));
    await abrirAba("faturamento");
    await u.click(await screen.findByRole("button", { name: "Fechar fatura" }));
    const painel = await screen.findByRole("dialog", { name: "Fechar fatura" });
    expect(within(painel).getByLabelText("E-mail para cobrança")).toHaveValue("a@b.com");
    expect(within(painel).getByLabelText("Prazo de pagamento (dias)")).toHaveValue(45);
    expect(within(painel).getByLabelText("Forma de cobrança")).toHaveValue("deposito");
    expect(within(painel).getByLabelText("Observações")).toHaveValue("Só às sextas");
  });

  test("prazo inválido bloqueia o fechamento e erro do servidor aparece no painel", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({
      "PUT /api/financeiro/clientes/cli1": { ok: true },
      "POST /api/financeiro/faturamentos/f1/fechar": { __status: 422, codigo: "ESTADO_INVALIDO", mensagem: "Cobrança já gerada." },
    }));
    await abrirAba("faturamento");
    await u.click(await screen.findByRole("button", { name: "Fechar fatura" }));
    const painel = await screen.findByRole("dialog", { name: "Fechar fatura" });
    await u.clear(within(painel).getByLabelText("Prazo de pagamento (dias)"));
    expect(within(painel).getByRole("button", { name: "Fechar fatura" })).toBeDisabled();
    expect(within(painel).getByText("Informe um prazo entre 0 e 365 dias.")).toBeInTheDocument();
    await u.type(within(painel).getByLabelText("Prazo de pagamento (dias)"), "30");
    await u.click(within(painel).getByRole("button", { name: "Fechar fatura" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Cobrança já gerada.");
  });

  test("sem fechamentos marcados para faturar mostra o aviso", async () => {
    instalarApiFalsa(rotas({ "GET /api/financeiro/faturamentos": [] }));
    await abrirAba("faturamento");
    expect(await screen.findByText(/Nenhum fechamento marcado para faturar/)).toBeInTheDocument();
  });
});
