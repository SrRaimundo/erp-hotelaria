import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { LinhaExtrato } from "../../src/api/tipos";
import { GavetaReserva } from "../../src/telas/reserva/GavetaReserva";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";
import { criarReserva } from "../fixtures/reserva";

function Local() {
  const l = useLocation();
  return <output data-testid="local">{l.pathname + l.search}</output>;
}

const linha = (o: Partial<LinhaExtrato>): LinhaExtrato => ({
  id: "l1", natureza: "debito", tipo: "diaria", origem: "hospedagem", descricao: "Diária 20/11", valor: 90000,
  instante: "2026-11-20T14:00:00.000Z", data: "2026-11-20", estornaId: null, reservaId: "r1", setor: "hospedagem", ...o,
});

const extrato: LinhaExtrato[] = [
  linha({}),
  linha({ id: "l2", tipo: "extra", descricao: "Consumo de frigobar", valor: 5000, instante: "2026-11-21T01:30:00.000Z", data: "2026-11-20" }),
  linha({ id: "l3", tipo: "extra", descricao: "Lavanderia", valor: 3000, instante: "2026-11-21T11:00:00.000Z" }),
  linha({ id: "l4", tipo: "estorno", descricao: "Estorno: Lavanderia", valor: -3000, estornaId: "l3", instante: "2026-11-21T12:00:00.000Z" }),
  linha({ id: "p1", natureza: "credito", tipo: "pagamento", origem: "caixa", descricao: "Pagamento (pix)", valor: 50000, setor: null, instante: "2026-11-22T09:00:00.000Z" }),
];

const formas = [
  { id: "f1", codigo: "dinheiro", nome: "Dinheiro", ativa: true },
  { id: "f2", codigo: "pix", nome: "PIX", ativa: true },
  { id: "f3", codigo: "faturado", nome: "Faturado", ativa: true },
];
const produtos = [{ id: "pr1", codigo: "AGUA", nome: "Água mineral", precoCentavos: 600, unidade: "un", grupo: "bebidas", tipo: "produto" }];
const caixa = { turno: { id: "t1", usuarioId: "u1", abertoEm: "2026-11-20T08:00:00.000Z", valorInicial: 10000, fechadoEm: null }, movimentos: [], esperadoPorForma: {} };

function montar(rota = "/mapa?reserva=r1&aba=conta", extras: Record<string, unknown> = {}, permissoes: string[] = ["conta.lancar"]) {
  instalarApiFalsa({
    "GET /api/painel": criarPainel(),
    "GET /api/reservas/r1": criarReserva(),
    "GET /api/contas/ct1": { saldo: { debitos: 95000, creditos: 50000, saldo: 45000 }, extrato },
    "GET /api/produtos": produtos,
    "GET /api/formas-pagamento": formas,
    "GET /api/caixa/atual": caixa,
    ...extras,
  });
  return renderizar(<><GavetaReserva /><Local /></>, { rota, usuario: { permissoes } });
}

afterEach(() => vi.unstubAllGlobals());

const postou = (caminho: string) => chamadas.filter((c) => c.metodo === "POST" && c.caminho === caminho);

describe("aba Conta", () => {
  test("extrato com saldo", async () => {
    montar();
    expect(await screen.findByText("Consumo de frigobar")).toBeInTheDocument();
    expect(screen.getByText("Saldo")).toBeInTheDocument();
    expect(screen.getByText("R$ 450,00")).toBeInTheDocument();
    expect(screen.getByText("a receber")).toBeInTheDocument();
    expect(screen.getByText("Débitos")).toBeInTheDocument();
    expect(screen.getByText("R$ 950,00")).toBeInTheDocument();
    expect(screen.getByText("Pagamento PIX")).toBeInTheDocument();
    // a data exibida é a local do servidor (01:30Z do dia 21 é dia 20 em São Paulo)
    expect(within(screen.getByText("Consumo de frigobar").closest("tr")!).getByText("20/11")).toBeInTheDocument();
    // estorno em itálico com sinal negativo
    const estorno = screen.getByText("Estorno: Lavanderia").closest("tr")!;
    expect(estorno).toHaveClass("conta-estorno");
    expect(within(estorno).getByText("−R$ 30,00")).toBeInTheDocument();
  });

  test("saldo negativo é crédito do hóspede", async () => {
    montar("/mapa?reserva=r1&aba=conta", { "GET /api/contas/ct1": { saldo: { debitos: 0, creditos: 2000, saldo: -2000 }, extrato: [] } });
    expect(await screen.findByText("crédito do hóspede")).toBeInTheDocument();
  });

  test("saldo zero é quitado", async () => {
    montar("/mapa?reserva=r1&aba=conta", { "GET /api/contas/ct1": { saldo: { debitos: 0, creditos: 0, saldo: 0 }, extrato: [] } });
    expect(await screen.findByText("quitado")).toBeInTheDocument();
  });

  test("lançar extra livre envia centavos inteiros", async () => {
    const usuario = userEvent.setup();
    montar("/mapa?reserva=r1&aba=conta", { "POST /api/contas/ct1/lancamentos": { id: "novo" } });
    await screen.findByText("Consumo de frigobar");
    await screen.findByRole("option", { name: /Água mineral/ });
    await usuario.selectOptions(screen.getByLabelText("Produto"), "Outro (descrição livre)");
    await usuario.type(screen.getByLabelText("Descrição"), "Lavagem");
    await usuario.type(screen.getByLabelText("Valor unitário"), "12,50");
    await usuario.clear(screen.getByLabelText("Quantidade"));
    await usuario.type(screen.getByLabelText("Quantidade"), "2");
    await usuario.click(screen.getByRole("button", { name: "Lançar" }));
    await waitFor(() => expect(postou("/api/contas/ct1/lancamentos")).toHaveLength(1));
    expect(postou("/api/contas/ct1/lancamentos")[0]!.corpo).toEqual({ tipo: "extra", descricao: "Lavagem", valorUnitario: 1250, quantidade: 2, setor: "recepcao" });
    await waitFor(() => expect(screen.getByLabelText("Produto")).toHaveValue(""));
  });

  test("lançar extra de produto envia o código", async () => {
    const usuario = userEvent.setup();
    montar("/mapa?reserva=r1&aba=conta", { "POST /api/contas/ct1/lancamentos": { id: "novo" } });
    await screen.findByRole("option", { name: /Água mineral/ });
    expect(screen.queryByLabelText("Descrição")).not.toBeInTheDocument();
    await usuario.selectOptions(screen.getByLabelText("Produto"), "AGUA");
    await usuario.click(screen.getByRole("button", { name: "Lançar" }));
    await waitFor(() => expect(postou("/api/contas/ct1/lancamentos")).toHaveLength(1));
    expect(postou("/api/contas/ct1/lancamentos")[0]!.corpo).toEqual({ tipo: "extra", produtoCodigo: "AGUA", quantidade: 1, setor: "recepcao" });
  });

  test("lançar extra sem produto ou com quantidade inválida mostra erro e não envia", async () => {
    const usuario = userEvent.setup();
    montar();
    await screen.findByRole("option", { name: /Água mineral/ });
    await usuario.click(screen.getByRole("button", { name: "Lançar" }));
    expect(await screen.findByText("Escolha um produto ou informe a descrição e o valor.")).toBeInTheDocument();
    await usuario.selectOptions(screen.getByLabelText("Produto"), "AGUA");
    await usuario.clear(screen.getByLabelText("Quantidade"));
    await usuario.type(screen.getByLabelText("Quantidade"), "0");
    await usuario.click(screen.getByRole("button", { name: "Lançar" }));
    expect(await screen.findByText("Informe a quantidade: um número inteiro de 1 em diante.")).toBeInTheDocument();
    expect(postou("/api/contas/ct1/lancamentos")).toHaveLength(0);
  });

  test("registrar sinal pré-preenche o valor pendente e foca o campo", async () => {
    const usuario = userEvent.setup();
    montar("/mapa?reserva=r1&aba=conta&receber=22000", { "POST /api/contas/ct1/pagamentos": { id: "pg" } });
    const valor = await screen.findByLabelText("Valor a receber");
    expect(valor).toHaveValue("220,00");
    await waitFor(() => expect(valor).toHaveFocus());
    await usuario.click(screen.getByRole("button", { name: "Receber" }));
    await waitFor(() => expect(postou("/api/contas/ct1/pagamentos")).toHaveLength(1));
    expect(postou("/api/contas/ct1/pagamentos")[0]!.corpo).toEqual({ reservaId: "r1", formaCodigo: "dinheiro", valor: 22000 });
    await waitFor(() => expect(screen.getByLabelText("Valor a receber")).toHaveValue(""));
  });

  test("Registrar sinal com a aba Conta já aberta pré-preenche e foca o valor", async () => {
    const usuario = userEvent.setup();
    montar("/mapa?reserva=r1&aba=conta", { "GET /api/reservas/r1": criarReserva({ estado: "pre_reserva", pago: 5000 }) });
    const valor = await screen.findByLabelText("Valor a receber");
    expect(valor).toHaveValue("");
    await usuario.click(screen.getByRole("button", { name: "Registrar sinal" }));
    await waitFor(() => expect(screen.getByLabelText("Valor a receber")).toHaveValue("220,00"));
    expect(screen.getByLabelText("Valor a receber")).toHaveFocus();
  });

  test("após receber, o parâmetro receber sai da URL", async () => {
    const usuario = userEvent.setup();
    montar("/mapa?reserva=r1&aba=conta&receber=22000", { "POST /api/contas/ct1/pagamentos": { id: "pg" } });
    await screen.findByLabelText("Valor a receber");
    await usuario.click(screen.getByRole("button", { name: "Receber" }));
    await waitFor(() => expect(screen.getByTestId("local").textContent).not.toContain("receber="));
    expect(screen.getByTestId("local").textContent).toContain("reserva=r1");
    expect(screen.getByTestId("local").textContent).toContain("aba=conta");
  });

  test("sem forma elegível o botão Receber fica desabilitado", async () => {
    montar("/mapa?reserva=r1&aba=conta", { "GET /api/formas-pagamento": [formas[2]] });
    await screen.findByLabelText("Valor a receber");
    expect(screen.getByRole("button", { name: "Receber" })).toBeDisabled();
  });

  test("formas não incluem faturado", async () => {
    montar();
    const forma = await screen.findByLabelText("Forma de pagamento");
    const nomes = within(forma).getAllByRole("option").map((o) => o.textContent);
    expect(nomes).toEqual(["Dinheiro", "PIX"]);
  });

  test("sem caixa aberto mostra aviso com link", async () => {
    montar("/mapa?reserva=r1&aba=conta", { "GET /api/caixa/atual": null });
    expect(await screen.findByText("Abra o caixa para receber pagamentos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir para o caixa" })).toHaveAttribute("href", "/caixa");
    expect(screen.queryByLabelText("Valor a receber")).not.toBeInTheDocument();
  });

  test("estornar pede supervisor e envia motivo e credenciais", async () => {
    const usuario = userEvent.setup();
    montar("/mapa?reserva=r1&aba=conta", { "POST /api/lancamentos/l2/estornar": { id: "e" } });
    await usuario.click(await screen.findByRole("button", { name: "Estornar Consumo de frigobar" }));
    const janela = await screen.findByRole("dialog", { name: "Estornar lançamento" });
    await usuario.type(within(janela).getByLabelText("Motivo"), "lançado por engano");
    await usuario.type(within(janela).getByLabelText("Login do supervisor"), "admin");
    await usuario.type(within(janela).getByLabelText("Senha do supervisor"), "segredo");
    await usuario.click(within(janela).getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(postou("/api/lancamentos/l2/estornar")).toHaveLength(1));
    expect(postou("/api/lancamentos/l2/estornar")[0]!.corpo).toEqual({ motivo: "lançado por engano", supervisor: { login: "admin", senha: "segredo" } });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Estornar lançamento" })).not.toBeInTheDocument());
  });

  test("estornar pagamento usa a rota de pagamentos", async () => {
    const usuario = userEvent.setup();
    montar("/mapa?reserva=r1&aba=conta", { "POST /api/pagamentos/p1/estornar": { id: "e" } });
    await usuario.click(await screen.findByRole("button", { name: "Estornar Pagamento PIX" }));
    const janela = await screen.findByRole("dialog", { name: "Estornar pagamento" });
    await usuario.type(within(janela).getByLabelText("Motivo"), "erro de valor");
    await usuario.type(within(janela).getByLabelText("Login do supervisor"), "admin");
    await usuario.type(within(janela).getByLabelText("Senha do supervisor"), "segredo");
    await usuario.click(within(janela).getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(postou("/api/pagamentos/p1/estornar")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Estornar pagamento" })).not.toBeInTheDocument());
  });

  test("estornos e lançamentos já estornados não têm botão Estornar", async () => {
    montar();
    await screen.findByText("Consumo de frigobar");
    const nomes = screen.getAllByRole("button", { name: /^Estornar / }).map((b) => b.getAttribute("aria-label"));
    expect(nomes).toEqual(["Estornar Diária 20/11", "Estornar Consumo de frigobar", "Estornar Pagamento PIX"]);
  });

  test("a coluna Origem mostra rótulos amigáveis", async () => {
    montar("/mapa?reserva=r1&aba=conta");
    const tabela = await screen.findByRole("table", { name: "Extrato da conta" });
    expect(within(tabela).getAllByText("Hospedagem").length).toBeGreaterThan(0);
    const linhaPagamento = within(tabela).getByText("Pagamento PIX").closest("tr")!;
    expect(within(linhaPagamento).getAllByRole("cell")[2]).toHaveTextContent("Caixa");
    expect(within(tabela).queryByText("hospedagem")).not.toBeInTheDocument();
  });
});

describe("setor e frigobar", () => {
  test("lançar extra envia o setor escolhido e filtra produtos pelo setor", async () => {
    const usuario = userEvent.setup();
    montar("/mapa?reserva=r1&aba=conta", { "POST /api/contas/ct1/lancamentos": { id: "novo" } });
    await screen.findByRole("option", { name: /Água mineral/ });
    expect(screen.getByLabelText("Setor")).toHaveValue("recepcao");
    expect(within(screen.getByLabelText("Setor")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Recepção", "Frigobar", "Bar", "Restaurante"]);
    expect(chamadas.some((c) => c.metodo === "GET" && c.caminho === "/api/produtos?setor=recepcao")).toBe(true);
    await usuario.selectOptions(screen.getByLabelText("Produto"), "AGUA");
    expect(screen.getByLabelText("Produto")).toHaveValue("AGUA");
    await usuario.selectOptions(screen.getByLabelText("Setor"), "Bar");
    await waitFor(() => expect(screen.getByLabelText("Produto")).toHaveValue(""));
    await waitFor(() => expect(chamadas.some((c) => c.caminho === "/api/produtos?setor=bar")).toBe(true));
    await usuario.selectOptions(await screen.findByLabelText("Produto"), "AGUA");
    await usuario.click(screen.getByRole("button", { name: "Lançar" }));
    await waitFor(() => expect(postou("/api/contas/ct1/lancamentos")).toHaveLength(1));
    expect(postou("/api/contas/ct1/lancamentos")[0]!.corpo).toEqual({ tipo: "extra", produtoCodigo: "AGUA", quantidade: 1, setor: "bar" });
  });

  test("extrato mostra a coluna Setor", async () => {
    montar();
    await screen.findByText("Consumo de frigobar");
    expect(screen.getByRole("columnheader", { name: "Setor" })).toBeInTheDocument();
    expect(within(screen.getByText("Consumo de frigobar").closest("tr")!).getAllByRole("cell")[3]).toHaveTextContent("Hospedagem");
    const pagamento = screen.getByText("Pagamento PIX").closest("tr")!;
    expect(within(pagamento).getAllByRole("cell")[3]).toBeEmptyDOMElement();
  });

  const frigobar = [
    { id: "agua", codigo: "AGUA", nome: "Água", precoCentavos: 600, unidade: "un", grupo: "bebidas", tipo: "produto", setores: ["frigobar"] },
    { id: "choc", codigo: "CHOC", nome: "Chocolate", precoCentavos: 900, unidade: "un", grupo: "doces", tipo: "produto", setores: ["frigobar"] },
    { id: "suco", codigo: "SUCO", nome: "Suco", precoCentavos: 800, unidade: "un", grupo: "bebidas", tipo: "produto", setores: ["frigobar"] },
  ];

  test("frigobar: 2 águas + 1 chocolate → total R$ 21,00 e corpo com só os itens > 0", async () => {
    const usuario = userEvent.setup();
    montar("/mapa?reserva=r1&aba=conta", { "GET /api/produtos": frigobar, "POST /api/contas/ct1/frigobar": { ids: ["a"] } });
    await usuario.click(await screen.findByRole("button", { name: "Frigobar" }));
    const janela = await screen.findByRole("dialog", { name: "Frigobar" });
    expect(chamadas.some((c) => c.caminho === "/api/produtos?setor=frigobar")).toBe(true);
    expect(within(janela).getByRole("button", { name: "Lançar" })).toBeDisabled();
    await usuario.click(await within(janela).findByRole("button", { name: "2 de Água" }));
    await usuario.click(within(janela).getByRole("button", { name: "1 de Chocolate" }));
    await usuario.click(within(janela).getByRole("button", { name: "3 de Suco" }));
    await usuario.click(within(janela).getByRole("button", { name: "0 de Suco" }));
    expect(within(janela).getByText("R$ 21,00")).toBeInTheDocument();
    await usuario.click(within(janela).getByRole("button", { name: "Lançar" }));
    await waitFor(() => expect(postou("/api/contas/ct1/frigobar")).toHaveLength(1));
    expect(postou("/api/contas/ct1/frigobar")[0]!.corpo).toEqual({ reservaId: "r1", itens: [{ produtoId: "agua", quantidade: 2 }, { produtoId: "choc", quantidade: 1 }] });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Frigobar" })).not.toBeInTheDocument());
  });

  test("frigobar: o + abre o campo numérico para quantidades maiores", async () => {
    const usuario = userEvent.setup();
    montar("/mapa?reserva=r1&aba=conta", { "GET /api/produtos": frigobar, "POST /api/contas/ct1/frigobar": { ids: ["a"] } });
    await usuario.click(await screen.findByRole("button", { name: "Frigobar" }));
    await usuario.click(await screen.findByRole("button", { name: "Outra quantidade de Água" }));
    await usuario.type(screen.getByLabelText("Quantidade de Água"), "5");
    expect(within(screen.getByRole("dialog", { name: "Frigobar" })).getByText("R$ 30,00")).toBeInTheDocument();
    await usuario.click(within(screen.getByRole("dialog", { name: "Frigobar" })).getByRole("button", { name: "Lançar" }));
    await waitFor(() => expect(postou("/api/contas/ct1/frigobar")[0]?.corpo).toEqual({ reservaId: "r1", itens: [{ produtoId: "agua", quantidade: 5 }] }));
  });

  test("botão Frigobar não aparece sem a permissão conta.lancar", async () => {
    montar("/mapa?reserva=r1&aba=conta", {}, []);
    await screen.findByText("Consumo de frigobar");
    expect(screen.queryByRole("button", { name: "Frigobar" })).not.toBeInTheDocument();
  });

  test("frigobar: o campo numérico limita a quantidade a 999", async () => {
    const usuario = userEvent.setup();
    montar("/mapa?reserva=r1&aba=conta", { "GET /api/produtos": frigobar });
    await usuario.click(await screen.findByRole("button", { name: "Frigobar" }));
    await usuario.click(await screen.findByRole("button", { name: "Outra quantidade de Água" }));
    await usuario.type(screen.getByLabelText("Quantidade de Água"), "5000");
    expect(screen.getByLabelText("Quantidade de Água")).toHaveValue(999);
  });

  test("botão Frigobar só aparece para hospedada", async () => {
    montar("/mapa?reserva=r1&aba=conta", { "GET /api/reservas/r1": criarReserva({ estado: "confirmada" }) });
    await screen.findByText("Consumo de frigobar");
    expect(screen.queryByRole("button", { name: "Frigobar" })).not.toBeInTheDocument();
  });
});

