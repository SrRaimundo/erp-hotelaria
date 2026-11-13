import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { abrirAba, BANCO, CAIXA, esperarChamada, LOCAL, LOCAL_2, rotasBase } from "./base";

afterEach(() => vi.unstubAllGlobals());

const ITEM = {
  id: "r1", numero_documento: "FAT-2026-000001", cliente_id: "cli1", cliente_nome: "Empresa X Ltda", data_vencimento: "2026-12-10T12:00:00.000Z",
  valor_original: 90000, valor_recebido: 30000, valor_pendente: 60000, situacao: "parcialmente_recebido", parcela_de: null, valor_total: null,
};
const VENCIDO = { ...ITEM, id: "r2", numero_documento: "FAT-2026-000002", cliente_nome: "Hotel Y", valor_recebido: 0, valor_pendente: 5000, valor_original: 5000, situacao: "vencido" };
const vazio = { quantidade: 0, valor_original: 0, valor_recebido: 0, valor_pendente: 0 };
const POSICAO = { local_id: "l1", situacoes: { aberto: vazio, vencido: vazio, parcialmente_recebido: vazio, recebido: vazio }, itens: [ITEM, VENCIDO] };

describe("tela Contas a Receber", () => {
  test("mostra o nome do cliente (não o código) e filtra por situação", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ ...rotasBase(), "GET /api/financeiro/relatorios/contas-receber": POSICAO });
    await abrirAba("receber");
    expect(await screen.findByText("Empresa X Ltda")).toBeInTheDocument();
    expect(screen.queryByText("cli1")).not.toBeInTheDocument();
    expect(screen.getByText("R$ 900,00")).toBeInTheDocument();
    expect(screen.getAllByText("10/12/2026", { selector: "td" })).toHaveLength(2);
    await u.selectOptions(screen.getByLabelText("Situação"), "Vencido");
    expect(screen.queryByText("Empresa X Ltda")).not.toBeInTheDocument();
    expect(screen.getByText("Hotel Y")).toBeInTheDocument();
  });

  test("confirma o recebimento com valor e conta escolhidos na lista", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      ...rotasBase(),
      "GET /api/financeiro/relatorios/contas-receber": POSICAO,
      "PUT /api/financeiro/contas-receber/r1/confirmar-pagamento": { ...ITEM, status: "recebido" },
    });
    await abrirAba("receber");
    const linha = (await screen.findByText("Empresa X Ltda")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Confirmar pagamento" }));
    const painel = await screen.findByRole("dialog", { name: "Confirmar pagamento" });
    expect(within(painel).getByLabelText("Valor recebido")).toHaveValue("600,00");
    await u.clear(within(painel).getByLabelText("Valor recebido"));
    await u.type(within(painel).getByLabelText("Valor recebido"), "250,75");
    await u.selectOptions(within(painel).getByLabelText("Conta de destino"), BANCO.id);
    // recebimento parcial: o saldo vira nova parcela e pede a nova data
    expect(within(painel).getByText(/vira uma nova parcela, ligada a ela/)).toBeInTheDocument();
    expect(within(painel).getByRole("button", { name: "Confirmar" })).toBeDisabled();
    fireEvent.change(within(painel).getByLabelText("Novo vencimento do saldo"), { target: { value: "2026-12-31" } });
    await u.click(within(painel).getByRole("button", { name: "Confirmar" }));
    const put = await esperarChamada(chamadas, "PUT", "/api/financeiro/contas-receber/r1/confirmar-pagamento");
    expect(put.corpo).toEqual({ valor: 25075, conta_bancaria_id: BANCO.id, novo_vencimento: "2026-12-31", chave: expect.any(String) });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("valor acima do pendente: o erro do servidor fica no painel", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      ...rotasBase(),
      "GET /api/financeiro/relatorios/contas-receber": POSICAO,
      "PUT /api/financeiro/contas-receber/r1/confirmar-pagamento": { __status: 422, codigo: "VALIDACAO_FALHOU", mensagem: "Valor excede o saldo pendente." },
    });
    await abrirAba("receber");
    const linha = (await screen.findByText("Empresa X Ltda")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Confirmar pagamento" }));
    const painel = await screen.findByRole("dialog", { name: "Confirmar pagamento" });
    await u.click(within(painel).getByRole("button", { name: "Confirmar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Valor excede o saldo pendente.");
  });

  test("lista vazia orienta sobre Faturamento", async () => {
    instalarApiFalsa({ ...rotasBase(), "GET /api/financeiro/relatorios/contas-receber": { ...POSICAO, itens: [] } });
    await abrirAba("receber");
    expect(await screen.findByText(/Faturas fechadas em Faturamento e contas lançadas aqui/)).toBeInTheDocument();
  });
});

describe("tela Caixa e Banco", () => {
  const MOV = {
    conta_id: "c1", saldo_inicial: 0, total_creditos: 25000, total_debitos: 0, saldo_final: 25000,
    movimentos: [{ id: "m1", data: "2026-11-02T12:00:00.000Z", dia: "2026-11-02", tipo: "credito", lancamento_id: "x", credito: 25000, debito: 0, saldo_posterior: 25000, descricao: "Cartão Visa", origem: "manual", estornavel: true }],
  };
  const rotas = (extra: Record<string, unknown> = {}) => ({
    ...rotasBase(),
    "GET /api/financeiro/caixa-banco/saldo": () => ({ conta_id: "c1", data: "2026-11-02", saldo: 25000 }),
    "GET /api/financeiro/relatorios/movimento": MOV,
    ...extra,
  });

  test("mostra saldo da conta escolhida no topo, o das demais contas e os movimentos", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas());
    await abrirAba("caixa");
    expect(await screen.findByText("R$ 250,00", { selector: ".fin__destaque" })).toBeInTheDocument();
    const contas = screen.getByRole("list", { name: "Contas do local" });
    expect(within(contas).getByText("Banco do Brasil")).toBeInTheDocument();
    expect(within(contas).getByText("R$ 1.000,00")).toBeInTheDocument();
    expect(await screen.findByText("02/11/2026")).toBeInTheDocument();
    expect(screen.getByLabelText("Conta (caixa/banco)")).toHaveValue(CAIXA.id);
    await u.selectOptions(screen.getByLabelText("Conta (caixa/banco)"), BANCO.id);
    await waitFor(() => expect(chamadas.some((c) => c.caminho.includes("conta_id=c2"))).toBe(true));
  });

  test("transfere entre contas escolhidas em listas, valor em centavos", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "POST /api/financeiro/caixa-banco/transferencia": { __status: 201, mov_origem: {}, mov_destino: {} } }));
    await abrirAba("caixa");
    await u.click(await screen.findByRole("button", { name: "Transferir" }));
    const painel = await screen.findByRole("dialog", { name: "Transferir entre contas" });
    expect(within(painel).getByLabelText("Conta de origem")).toHaveValue(CAIXA.id);
    expect(within(painel).getByLabelText("Conta de destino")).toHaveValue(BANCO.id);
    await u.type(within(painel).getByLabelText("Valor"), "100");
    await u.click(within(painel).getByRole("button", { name: "Transferir" }));
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/caixa-banco/transferencia");
    expect(post.corpo).toEqual({ origem: CAIXA.id, destino: BANCO.id, valor: 10000, chave: expect.any(String) });
  });

  test("origem igual ao destino é barrada na hora", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas());
    await abrirAba("caixa");
    await u.click(await screen.findByRole("button", { name: "Transferir" }));
    const painel = await screen.findByRole("dialog", { name: "Transferir entre contas" });
    await u.selectOptions(within(painel).getByLabelText("Conta de destino"), CAIXA.id);
    await u.type(within(painel).getByLabelText("Valor"), "10");
    expect(within(painel).getByRole("alert")).toHaveTextContent("Origem e destino devem ser diferentes.");
    expect(within(painel).getByRole("button", { name: "Transferir" })).toBeDisabled();
  });

  test("saldo insuficiente ou outro erro do servidor aparece junto do botão", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "POST /api/financeiro/caixa-banco/transferencia": { __status: 422, codigo: "VALIDACAO_FALHOU", mensagem: "Transferência só entre contas do mesmo local." } }));
    await abrirAba("caixa");
    await u.click(await screen.findByRole("button", { name: "Transferir" }));
    const painel = await screen.findByRole("dialog", { name: "Transferir entre contas" });
    await u.type(within(painel).getByLabelText("Valor"), "10");
    await u.click(within(painel).getByRole("button", { name: "Transferir" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Transferência só entre contas do mesmo local.");
  });

  test("cria uma conta nova com saldo inicial em centavos", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "POST /api/financeiro/contas": { __status: 201, ...BANCO } }));
    await abrirAba("caixa");
    await u.click(await screen.findByRole("button", { name: "+ Nova conta" }));
    const painel = await screen.findByRole("dialog", { name: "Nova conta" });
    const criar = within(painel).getByRole("button", { name: "Criar conta" });
    expect(criar).toBeDisabled();
    await u.type(within(painel).getByLabelText("Nome da conta"), "Banco Itaú");
    await u.type(within(painel).getByLabelText("Banco"), "341");
    await u.type(within(painel).getByLabelText("Agência"), "0001");
    await u.type(within(painel).getByLabelText("Número da conta"), "55555-0");
    await u.clear(within(painel).getByLabelText("Saldo inicial"));
    await u.type(within(painel).getByLabelText("Saldo inicial"), "1.500,00");
    await u.click(criar);
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/contas");
    expect(post.corpo).toEqual({ local_id: "l1", nome: "Banco Itaú", tipo: "corrente", banco: "341", agencia: "0001", numero: "55555-0", saldo_inicial: 150000, chave: expect.any(String) });
  });

  test("trocar o local no topo recarrega as contas daquele local", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      ...rotasBase([LOCAL, LOCAL_2], []),
      "GET /api/financeiro/contas": (_c: unknown, url: URL) => (url.searchParams.get("local_id") === "l2" ? [{ ...CAIXA, id: "c9", local_id: "l2", nome: "Caixa da Sorveteria", saldo: 700 }] : [CAIXA]),
      "GET /api/financeiro/caixa-banco/saldo": { conta_id: "c1", data: "x", saldo: 0 },
      "GET /api/financeiro/relatorios/movimento": { ...MOV, movimentos: [] },
    });
    await abrirAba("caixa");
    await u.selectOptions(await screen.findByLabelText("Local"), "Sorveteria");
    expect(await screen.findByText("Caixa da Sorveteria", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByLabelText("Conta (caixa/banco)")).toHaveValue("c9");
  });

  test("estornar um lançamento do extrato exige supervisor e envia motivo; o erro fica na janela", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "POST /api/financeiro/lancamentos/x/estornar": { __status: 422, codigo: "ESTADO_INVALIDO", mensagem: "A parcela do saldo deste pagamento parcial já teve movimento." } }));
    await abrirAba("caixa");
    expect(await screen.findByText("Cartão Visa")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Estornar" }));
    const janela = await screen.findByRole("dialog", { name: "Estornar lançamento" });
    await u.type(within(janela).getByLabelText("Motivo"), "Valor errado");
    await u.type(within(janela).getByLabelText("Login do supervisor"), "admin");
    await u.type(within(janela).getByLabelText("Senha do supervisor"), "admin");
    await u.click(within(janela).getByRole("button", { name: /Confirmar|Autorizar|Estornar/ }));
    expect(await within(janela).findByText(/A parcela do saldo deste pagamento parcial/)).toBeInTheDocument();
    const post = chamadas.find((c) => c.metodo === "POST")!;
    expect(post.corpo).toEqual({ motivo: "Valor errado", supervisor: { login: "admin", senha: "admin" } });
  });

  test("movimento já revertido não oferece Estornar", async () => {
    instalarApiFalsa(rotas({ "GET /api/financeiro/relatorios/movimento": { ...MOV, movimentos: [{ ...MOV.movimentos[0], estornavel: false }] } }));
    await abrirAba("caixa");
    expect(await screen.findByText("Cartão Visa")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Estornar" })).not.toBeInTheDocument();
  });
});
