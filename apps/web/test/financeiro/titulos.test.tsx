import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { dividirValor, gerarDatas, validarParcelas } from "../../src/financeiro/calculo-parcelas";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { abrirAba, esperarChamada, rotasBase } from "./base";

afterEach(() => vi.unstubAllGlobals());

describe("cálculo do parcelamento (igual ao do servidor)", () => {
  test("sobras de centavos na primeira parcela", () => {
    expect(dividirValor(100000, 3)).toEqual([33334, 33333, 33333]);
  });
  test("intervalos, inclusive o ajuste de fim de mês", () => {
    expect(gerarDatas("2026-12-31", 3, "mensal")).toEqual(["2026-12-31", "2027-01-31", "2027-02-28"]);
    expect(gerarDatas("2026-12-01", 3, "30_dias")).toEqual(["2026-12-01", "2026-12-31", "2027-01-30"]);
  });
  test("validação", () => {
    expect(validarParcelas(100, [{ vencimento: "2026-12-01", valor: 50 }, { vencimento: "2026-12-01", valor: 50 }]).join(" ")).toMatch(/ordem crescente/);
    expect(validarParcelas(100, [{ vencimento: "2026-12-01", valor: 50 }, { vencimento: "2027-01-01", valor: null }]).join(" ")).toMatch(/maior que zero/);
  });
});

const PAGAR_1 = {
  id: "p1", local_id: "l1", data: "2026-11-01T12:00:00.000Z", tipo: "pagamento", origem: "manual", forma_pagamento: "boleto", descricao: "NF 77",
  categoria: "fornecedor", vencimento: "2026-12-10T12:00:00.000Z", dia: "2026-11-01", vencimento_dia: "2026-12-10", fornecedor_nome: null, status: "confirmado", valor: 25000,
  titulo_id: "t1", parcela_num: 1, parcela_total: 4,
};
const PAGAR_2 = { ...PAGAR_1, id: "p2", vencimento_dia: "2027-01-10", status: "confirmado", valor: 10000, valor_total: 25000, parcela_num: 2 };
const PAGAR_2_SALDO = { ...PAGAR_1, id: "p2b", vencimento_dia: "2027-01-25", status: "pendente", valor: 15000, parcela_num: 2, parcela_de: "p2" };
const PAGAR_3 = { ...PAGAR_1, id: "p3", vencimento_dia: "2027-02-10", status: "pendente", parcela_num: 3 };

const DETALHE = {
  id: "t1", tipo: "pagar", local_id: "l1", documento: "NF 77", valor_total: 100000, num_parcelas: 4, intervalo: "mensal", status: "ativo", pago: 35000, restante: 65000,
  parcelas: [
    { id: "p1", numero: 1, total: 4, rotulo: "NF 77 – parcela 1/4", vencimento_dia: "2026-12-10", valor: 25000, pago: 25000, restante: 0, situacao: "pago", saldo_de: null },
    { id: "p2", numero: 2, total: 4, rotulo: "NF 77 – parcela 2/4", vencimento_dia: "2027-01-10", valor: 10000, pago: 10000, restante: 0, situacao: "pago", saldo_de: null },
    { id: "p2b", numero: 2, total: 4, rotulo: "NF 77 – parcela 2/4 – saldo", vencimento_dia: "2027-01-25", valor: 15000, pago: 0, restante: 15000, situacao: "pendente", saldo_de: "p2" },
    { id: "p3", numero: 3, total: 4, rotulo: "NF 77 – parcela 3/4", vencimento_dia: "2027-02-10", valor: 25000, pago: 0, restante: 25000, situacao: "pendente", saldo_de: null },
    { id: "p4", numero: 4, total: 4, rotulo: "NF 77 – parcela 4/4", vencimento_dia: "2027-03-10", valor: 25000, pago: 0, restante: 25000, situacao: "pendente", saldo_de: null },
  ],
  historico: [
    { instante: "2026-11-01T12:00:00.000Z", ator: "admin", acao: "fin_titulo.criar", motivo: null },
    { instante: "2026-11-02T12:00:00.000Z", ator: "admin", acao: "fin_conta_pagar.baixar", motivo: null },
  ],
};

const rotasPagar = (extra: Record<string, unknown> = {}) => ({
  ...rotasBase(),
  "GET /api/financeiro/lancamentos": [PAGAR_1, PAGAR_2, PAGAR_2_SALDO, PAGAR_3],
  "GET /api/financeiro/fornecedores": [{ id: "f1", local_id: "l1", razao_social: "Padaria Ltda", cnpj: null }],
  ...extra,
});

async function abrirNova() {
  const u = userEvent.setup();
  await abrirAba("pagar");
  await u.click(await screen.findByRole("button", { name: "+ Nova conta a pagar" }));
  const painel = await screen.findByRole("dialog", { name: "Nova conta a pagar" });
  return { u, painel };
}

describe("Contas a Pagar: lançar parcelado", () => {
  test("Parcelado mostra a prévia com a divisão padrão (sobra de centavos na primeira) e as datas do intervalo", async () => {
    instalarApiFalsa(rotasPagar());
    const { u, painel } = await abrirNova();
    expect(within(painel).queryByLabelText("Número de parcelas")).not.toBeInTheDocument();
    await u.type(within(painel).getByLabelText("Valor"), "1000");
    await u.selectOptions(within(painel).getByLabelText("Forma"), "Parcelado");
    fireEvent.change(within(painel).getByLabelText("Primeiro vencimento"), { target: { value: "2026-12-31" } });
    fireEvent.change(within(painel).getByLabelText("Número de parcelas"), { target: { value: "3" } });
    await u.selectOptions(within(painel).getByLabelText("Intervalo"), "Todo mês no mesmo dia");
    expect(within(painel).getByLabelText("Valor da parcela 1")).toHaveValue("333,34");
    expect(within(painel).getByLabelText("Valor da parcela 2")).toHaveValue("333,33");
    expect(within(painel).getByLabelText("Valor da parcela 3")).toHaveValue("333,33");
    expect(within(painel).getByLabelText("Vencimento da parcela 1")).toHaveValue("2026-12-31");
    expect(within(painel).getByLabelText("Vencimento da parcela 2")).toHaveValue("2027-01-31");
    expect(within(painel).getByLabelText("Vencimento da parcela 3")).toHaveValue("2027-02-28");
    await u.selectOptions(within(painel).getByLabelText("Intervalo"), "A cada 30 dias");
    expect(within(painel).getByLabelText("Vencimento da parcela 2")).toHaveValue("2027-01-30");
  });

  test("editar um valor bloqueia o salvar com a explicação; acertar a soma libera e envia o título", async () => {
    instalarApiFalsa(rotasPagar({ "POST /api/financeiro/titulos": { __status: 201, ...DETALHE } }));
    const { u, painel } = await abrirNova();
    await u.type(within(painel).getByLabelText("Descrição"), "NF 88");
    await u.type(within(painel).getByLabelText("Valor"), "1000");
    await u.selectOptions(within(painel).getByLabelText("Forma"), "Parcelado");
    fireEvent.change(within(painel).getByLabelText("Primeiro vencimento"), { target: { value: "2026-12-10" } });
    fireEvent.change(within(painel).getByLabelText("Número de parcelas"), { target: { value: "3" } });
    const lancar = within(painel).getByRole("button", { name: "Lançar conta a pagar" });
    expect(lancar).toBeEnabled();
    const v2 = within(painel).getByLabelText("Valor da parcela 2");
    await u.clear(v2);
    await u.type(v2, "400");
    expect(lancar).toBeDisabled();
    expect(within(painel).getByText(/A soma das parcelas \(R\$ 1\.066,67\) precisa ser igual ao total \(R\$ 1\.000,00\)/)).toBeInTheDocument();
    const v3 = within(painel).getByLabelText("Valor da parcela 3");
    await u.clear(v3);
    await u.type(v3, "266,66");
    expect(lancar).toBeEnabled();
    await u.click(lancar);
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/titulos");
    expect(post.corpo).toEqual({
      tipo: "pagar", local_id: "l1", documento: "NF 88", categoria: "fornecedor", valor_total: 100000, intervalo: "30_dias",
      parcelas: [{ vencimento: "2026-12-10", valor: 33334 }, { vencimento: "2027-01-09", valor: 40000 }, { vencimento: "2027-02-08", valor: 26666 }], chave: expect.any(String),
    });
    expect(chamadas.some((c) => c.caminho.startsWith("/api/financeiro/contas-a-pagar"))).toBe(false);
  });

  test("datas fora de ordem bloqueiam o salvar com a explicação", async () => {
    instalarApiFalsa(rotasPagar());
    const { u, painel } = await abrirNova();
    await u.type(within(painel).getByLabelText("Descrição"), "NF 88");
    await u.type(within(painel).getByLabelText("Valor"), "100");
    await u.selectOptions(within(painel).getByLabelText("Forma"), "Parcelado");
    fireEvent.change(within(painel).getByLabelText("Primeiro vencimento"), { target: { value: "2026-12-10" } });
    fireEvent.change(within(painel).getByLabelText("Vencimento da parcela 2"), { target: { value: "2026-12-10" } });
    expect(within(painel).getByRole("button", { name: "Lançar conta a pagar" })).toBeDisabled();
    expect(within(painel).getByText(/ordem crescente/)).toBeInTheDocument();
  });

  test("menos de 2 parcelas ou mais de 60 não são aceitas", async () => {
    instalarApiFalsa(rotasPagar());
    const { u, painel } = await abrirNova();
    await u.type(within(painel).getByLabelText("Descrição"), "NF 88");
    await u.type(within(painel).getByLabelText("Valor"), "1000");
    await u.selectOptions(within(painel).getByLabelText("Forma"), "Parcelado");
    fireEvent.change(within(painel).getByLabelText("Número de parcelas"), { target: { value: "1" } });
    expect(within(painel).getByText(/pelo menos 2 parcelas/)).toBeInTheDocument();
    fireEvent.change(within(painel).getByLabelText("Número de parcelas"), { target: { value: "61" } });
    expect(within(painel).getByText(/no máximo 60 parcelas/)).toBeInTheDocument();
    expect(within(painel).getByRole("button", { name: "Lançar conta a pagar" })).toBeDisabled();
  });

  test("Datas livres: cada data e cada valor são digitados; a soma ainda precisa fechar", async () => {
    instalarApiFalsa(rotasPagar({ "POST /api/financeiro/titulos": { __status: 201, ...DETALHE } }));
    const { u, painel } = await abrirNova();
    await u.type(within(painel).getByLabelText("Descrição"), "Obra");
    await u.type(within(painel).getByLabelText("Valor"), "900");
    await u.selectOptions(within(painel).getByLabelText("Forma"), "Parcelado");
    await u.selectOptions(within(painel).getByLabelText("Intervalo"), "Datas livres");
    fireEvent.change(within(painel).getByLabelText("Primeiro vencimento"), { target: { value: "2026-12-01" } });
    fireEvent.change(within(painel).getByLabelText("Vencimento da parcela 2"), { target: { value: "2027-03-15" } });
    const v1 = within(painel).getByLabelText("Valor da parcela 1");
    await u.clear(v1);
    await u.type(v1, "600");
    const v2 = within(painel).getByLabelText("Valor da parcela 2");
    await u.clear(v2);
    await u.type(v2, "300");
    await u.click(within(painel).getByRole("button", { name: "Lançar conta a pagar" }));
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/titulos");
    expect(post.corpo).toMatchObject({ intervalo: "livre", valor_total: 90000, parcelas: [{ vencimento: "2026-12-01", valor: 60000 }, { vencimento: "2027-03-15", valor: 30000 }] });
  });
});

describe("Contas a Pagar: lista e título", () => {
  test("cada parcela aparece como '<documento> – parcela n/total', com o saldo de pagamento parcial rotulado", async () => {
    instalarApiFalsa(rotasPagar());
    await abrirAba("pagar");
    expect(await screen.findByText(/^NF 77 – parcela 1\/4$/)).toBeInTheDocument();
    expect(screen.getByText(/^NF 77 – parcela 2\/4$/)).toBeInTheDocument();
    expect(screen.getByText(/^NF 77 – parcela 2\/4 – saldo$/)).toBeInTheDocument();
    expect(screen.getByText(/^NF 77 – parcela 3\/4$/)).toBeInTheDocument();
    expect(screen.queryByText(/saldo de pagamento parcial/)).not.toBeInTheDocument();
    expect(screen.getAllByText("10/01/2027").length).toBeGreaterThan(0);
    expect(screen.getAllByText("10/02/2027").length).toBeGreaterThan(0);
  });

  test("detalhe do título: parcelas, pago, restante e histórico", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotasPagar({ "GET /api/financeiro/titulos/t1": DETALHE }));
    await abrirAba("pagar");
    const linha = (await screen.findByText(/^NF 77 – parcela 3\/4$/)).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Ver título" }));
    const gaveta = await screen.findByRole("dialog", { name: "Título NF 77" });
    expect(await within(gaveta).findByText("Total: R$ 1.000,00")).toBeInTheDocument();
    expect(within(gaveta).getByText("Pago: R$ 350,00")).toBeInTheDocument();
    expect(within(gaveta).getByText("Falta: R$ 650,00")).toBeInTheDocument();
    expect(within(gaveta).getAllByRole("row")).toHaveLength(1 + 5);
    expect(within(gaveta).getByText("NF 77 – parcela 2/4 – saldo")).toBeInTheDocument();
    expect(within(gaveta).getByText("Título criado")).toBeInTheDocument();
    expect(within(gaveta).getByText("Pagamento")).toBeInTheDocument();
  });

  test("cancelar o título avisa quais parcelas ficam e envia motivo e supervisor", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotasPagar({
      "GET /api/financeiro/titulos/t1": DETALHE,
      "POST /api/financeiro/titulos/t1/cancelar": { ...DETALHE, status: "cancelado", restante: 0 },
    }));
    await abrirAba("pagar");
    const linha = (await screen.findByText(/^NF 77 – parcela 3\/4$/)).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Ver título" }));
    const gaveta = await screen.findByRole("dialog", { name: "Título NF 77" });
    await u.click(await within(gaveta).findByRole("button", { name: "Cancelar título" }));
    const janela = await screen.findByRole("dialog", { name: "Cancelar título" });
    expect(janela).toHaveTextContent("3 parcelas pendentes serão canceladas (R$ 650,00)");
    expect(janela).toHaveTextContent("Continuam como estão, por já terem pagamento: NF 77 – parcela 1/4, NF 77 – parcela 2/4");
    await u.type(within(janela).getByLabelText("Motivo"), "Compra desfeita");
    await u.type(within(janela).getByLabelText("Login do supervisor"), "admin");
    await u.type(within(janela).getByLabelText("Senha do supervisor"), "admin");
    await u.click(within(janela).getByRole("button", { name: "Autorizar" }));
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/titulos/t1/cancelar");
    expect(post.corpo).toEqual({ motivo: "Compra desfeita", supervisor: { login: "admin", senha: "admin" } });
  });

  test("título sem parcela pendente não oferece o cancelamento", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotasPagar({ "GET /api/financeiro/titulos/t1": { ...DETALHE, status: "cancelado", restante: 0 } }));
    await abrirAba("pagar");
    const linha = (await screen.findByText(/^NF 77 – parcela 3\/4$/)).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Ver título" }));
    const gaveta = await screen.findByRole("dialog", { name: "Título NF 77" });
    await within(gaveta).findByText("Total: R$ 1.000,00");
    expect(within(gaveta).queryByRole("button", { name: "Cancelar título" })).not.toBeInTheDocument();
    expect(within(gaveta).getByText("Cancelado")).toBeInTheDocument();
  });
});

const ITEM_RECEBER = {
  id: "r1", numero_documento: "EV-9", cliente_id: "k1", cliente_nome: "Maria Eventos", parcela_de: null, valor_total: null, titulo_id: "t2", parcela_num: 1, parcela_total: 2,
  rotulo: "EV-9 – parcela 1/2", data_vencimento: "2026-12-20T12:00:00.000Z", origem: "manual", categoria: "evento", observacao: null, editavel: false, cancelavel: true, lancamento_id: null,
  valor_original: 50000, valor_recebido: 0, valor_pendente: 50000, situacao: "aberto",
};
const rotasReceber = (extra: Record<string, unknown> = {}) => ({
  ...rotasBase(),
  "GET /api/financeiro/relatorios/contas-receber": {
    local_id: "l1",
    situacoes: Object.fromEntries(["aberto", "vencido", "parcialmente_recebido", "recebido"].map((s) => [s, { quantidade: 0, valor_original: 0, valor_recebido: 0, valor_pendente: 0 }])),
    itens: [ITEM_RECEBER, { ...ITEM_RECEBER, id: "r2", rotulo: "EV-9 – parcela 2/2", parcela_num: 2, data_vencimento: "2027-01-20T12:00:00.000Z" },
      { ...ITEM_RECEBER, id: "r2b", rotulo: "EV-9 – parcela 2/2 – saldo", numero_documento: "EV-9-P1", parcela_num: 2, parcela_de: "r2", data_vencimento: "2027-02-20T12:00:00.000Z" }],
  },
  "GET /api/financeiro/clientes": [{ id: "k1", local_id: "l1", nome: "Maria Eventos", cpf_cnpj: null }],
  ...extra,
});

describe("Contas a Receber: título parcelado (espelho)", () => {
  test("lista cada parcela com o rótulo do título, cada uma na sua data, sem Editar", async () => {
    instalarApiFalsa(rotasReceber());
    await abrirAba("receber");
    expect(await screen.findByText("EV-9 – parcela 1/2")).toBeInTheDocument();
    expect(screen.getByText("EV-9 – parcela 2/2")).toBeInTheDocument();
    expect(screen.getByText("EV-9 – parcela 2/2 – saldo")).toBeInTheDocument();
    expect(screen.getByText("20/12/2026")).toBeInTheDocument();
    expect(screen.getByText("20/01/2027")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByText(/saldo de recebimento parcial/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Ver título" })).toHaveLength(3);
  });

  test("lança parcelado e envia o título a receber", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotasReceber({ "POST /api/financeiro/titulos": { __status: 201, ...DETALHE, tipo: "receber", documento: "EV-10" } }));
    await abrirAba("receber");
    await u.click(await screen.findByRole("button", { name: "+ Nova conta a receber" }));
    const painel = await screen.findByRole("dialog", { name: "Nova conta a receber" });
    await u.selectOptions(within(painel).getByLabelText("Cliente"), "Maria Eventos");
    await u.type(within(painel).getByLabelText("Número do documento"), "EV-10");
    await u.type(within(painel).getByLabelText("Valor"), "100,01");
    await u.selectOptions(within(painel).getByLabelText("Forma"), "Parcelado");
    fireEvent.change(within(painel).getByLabelText("Primeiro vencimento"), { target: { value: "2026-12-05" } });
    fireEvent.change(within(painel).getByLabelText("Número de parcelas"), { target: { value: "2" } });
    expect(within(painel).getByLabelText("Valor da parcela 1")).toHaveValue("50,01");
    expect(within(painel).getByLabelText("Valor da parcela 2")).toHaveValue("50,00");
    await u.click(within(painel).getByRole("button", { name: "Lançar conta a receber" }));
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/titulos");
    expect(post.corpo).toMatchObject({ tipo: "receber", local_id: "l1", cliente_id: "k1", documento: "EV-10", categoria: "servico", valor_total: 10001, intervalo: "30_dias" });
    expect((post.corpo as any).parcelas).toEqual([{ vencimento: "2026-12-05", valor: 5001 }, { vencimento: "2027-01-04", valor: 5000 }]);
  });

  test("detalhe e cancelamento do título a receber", async () => {
    const u = userEvent.setup();
    const detalhe = { ...DETALHE, tipo: "receber", documento: "EV-9", id: "t2", num_parcelas: 2, valor_total: 100000, pago: 0, restante: 100000,
      parcelas: DETALHE.parcelas.slice(2, 4).map((p) => ({ ...p, pago: 0, situacao: "pendente", restante: p.valor })) };
    instalarApiFalsa(rotasReceber({ "GET /api/financeiro/titulos/t2": detalhe, "POST /api/financeiro/titulos/t2/cancelar": { ...detalhe, status: "cancelado", restante: 0 } }));
    await abrirAba("receber");
    const linha = (await screen.findByText("EV-9 – parcela 1/2")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Ver título" }));
    const gaveta = await screen.findByRole("dialog", { name: "Título EV-9" });
    await u.click(await within(gaveta).findByRole("button", { name: "Cancelar título" }));
    const janela = await screen.findByRole("dialog", { name: "Cancelar título" });
    expect(janela).toHaveTextContent("2 parcelas pendentes serão canceladas");
    expect(janela).not.toHaveTextContent("Continuam como estão");
    await u.type(within(janela).getByLabelText("Motivo"), "Evento desfeito");
    await u.type(within(janela).getByLabelText("Login do supervisor"), "admin");
    await u.type(within(janela).getByLabelText("Senha do supervisor"), "admin");
    await u.click(within(janela).getByRole("button", { name: "Autorizar" }));
    await esperarChamada(chamadas, "POST", "/api/financeiro/titulos/t2/cancelar");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cancelar título" })).not.toBeInTheDocument());
  });
});
