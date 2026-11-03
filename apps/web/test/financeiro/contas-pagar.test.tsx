import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { abrirAba, BANCO, CAIXA, esperarChamada, rotasBase } from "./base";

afterEach(() => vi.unstubAllGlobals());

const PENDENTE = {
  id: "p1", local_id: "l1", data: "2026-11-01T12:00:00.000Z", tipo: "pagamento", origem: "manual", forma_pagamento: "boleto", descricao: "Pães de novembro",
  categoria: "fornecedor", vencimento: "2026-11-20T12:00:00.000Z", fornecedor_nome: "Padaria Ltda", status: "pendente", valor: 12000,
};
const PAGO = { ...PENDENTE, id: "p2", descricao: "Luz de outubro", categoria: "servico", fornecedor_nome: null, status: "confirmado", valor: 30000 };

const rotas = (extra: Record<string, unknown> = {}) => ({
  ...rotasBase(),
  "GET /api/financeiro/lancamentos": [PENDENTE, PAGO],
  "GET /api/financeiro/fornecedores": [{ id: "f1", local_id: "l1", razao_social: "Padaria Ltda", cnpj: null }],
  ...extra,
});

describe("tela Contas a Pagar", () => {
  test("lista só pagamentos do local escolhido, em pt-BR, com o total a pagar", async () => {
    instalarApiFalsa(rotas());
    await abrirAba("pagar");
    expect(await screen.findByText("Pães de novembro")).toBeInTheDocument();
    expect(screen.getByText("Luz de outubro")).toBeInTheDocument();
    expect(screen.getAllByText("20/11/2026").length).toBeGreaterThan(0);
    expect(screen.getByText("Padaria Ltda")).toBeInTheDocument();
    expect(screen.getByText("A pagar neste filtro: R$ 120,00")).toBeInTheDocument();
    const consulta = chamadas.find((c) => c.caminho.startsWith("/api/financeiro/lancamentos"))!;
    expect(consulta.caminho).toContain("local_id=l1");
    expect(consulta.caminho).toContain("tipo=pagamento");
    // só a conta pendente pode ser paga
    expect(screen.getAllByRole("button", { name: "Pagar" })).toHaveLength(1);
  });

  test("filtra por situação", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas());
    await abrirAba("pagar");
    await screen.findByText("Pães de novembro");
    await u.selectOptions(screen.getByLabelText("Situação"), "Pago");
    expect(screen.queryByText("Pães de novembro")).not.toBeInTheDocument();
    expect(screen.getByText("Luz de outubro")).toBeInTheDocument();
  });

  test("lança uma conta a pagar: valor em centavos, fornecedor escolhido na lista", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "POST /api/financeiro/contas-a-pagar": { __status: 201, ...PENDENTE } }));
    await abrirAba("pagar");
    await u.click(await screen.findByRole("button", { name: "+ Nova conta a pagar" }));
    const painel = await screen.findByRole("dialog", { name: "Nova conta a pagar" });
    const lancar = within(painel).getByRole("button", { name: "Lançar conta a pagar" });
    expect(lancar).toBeDisabled();
    await u.type(within(painel).getByLabelText("Descrição"), "Pães de dezembro");
    await u.type(within(painel).getByLabelText("Valor"), "120,50");
    fireEvent.change(within(painel).getByLabelText("Vencimento"), { target: { value: "2026-12-05" } });
    await u.selectOptions(within(painel).getByLabelText("Fornecedor"), "Padaria Ltda");
    expect(lancar).toBeEnabled();
    await u.click(lancar);
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/contas-a-pagar");
    expect(post.corpo).toEqual({ local_id: "l1", descricao: "Pães de dezembro", categoria: "fornecedor", valor: 12050, vencimento: "2026-12-05", fornecedor_id: "f1" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("serviço, funcionário e contrato são tipos de conta a pagar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas());
    await abrirAba("pagar");
    await u.click(await screen.findByRole("button", { name: "+ Nova conta a pagar" }));
    const tipos = within(await screen.findByRole("dialog")).getByLabelText("Tipo");
    expect(within(tipos).getAllByRole("option").map((o) => o.textContent)).toEqual(["Fornecedor", "Serviço", "Funcionário", "Contrato"]);
  });

  test("cadastra um fornecedor novo sem sair do painel e já o seleciona", async () => {
    const u = userEvent.setup();
    let criado = false;
    instalarApiFalsa(rotas({
      "GET /api/financeiro/fornecedores": () => (criado ? [{ id: "f9", local_id: "l1", razao_social: "Gráfica Alfa", cnpj: null }] : []),
      "POST /api/financeiro/fornecedores": () => { criado = true; return { __status: 201, id: "f9", local_id: "l1", razao_social: "Gráfica Alfa", cnpj: null }; },
    }));
    await abrirAba("pagar");
    await u.click(await screen.findByRole("button", { name: "+ Nova conta a pagar" }));
    await u.click(await screen.findByRole("button", { name: "+ Novo fornecedor" }));
    const janela = await screen.findByRole("dialog", { name: "Novo fornecedor" });
    await u.type(within(janela).getByLabelText("Razão social"), "Gráfica Alfa");
    await u.click(within(janela).getByRole("button", { name: "Cadastrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Novo fornecedor" })).not.toBeInTheDocument());
    const painel = screen.getByRole("dialog", { name: "Nova conta a pagar" });
    await waitFor(() => expect(within(painel).getByLabelText("Fornecedor")).toHaveValue("f9"));
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual({ local_id: "l1", razao_social: "Gráfica Alfa" });
  });

  test("erro do servidor aparece dentro do painel de lançamento", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "POST /api/financeiro/contas-a-pagar": { __status: 422, codigo: "NAO_ENCONTRADO", mensagem: "Fornecedor não encontrado neste local." } }));
    await abrirAba("pagar");
    await u.click(await screen.findByRole("button", { name: "+ Nova conta a pagar" }));
    const painel = await screen.findByRole("dialog", { name: "Nova conta a pagar" });
    await u.type(within(painel).getByLabelText("Descrição"), "Luz");
    await u.type(within(painel).getByLabelText("Valor"), "50");
    await u.click(within(painel).getByRole("button", { name: "Lançar conta a pagar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Fornecedor não encontrado neste local.");
    expect(painel).toBeInTheDocument();
  });

  test("paga escolhendo a conta de saída e a forma de pagamento", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "PUT /api/financeiro/contas-a-pagar/p1/baixar": { ...PENDENTE, status: "confirmado" } }));
    await abrirAba("pagar");
    await u.click(await screen.findByRole("button", { name: "Pagar" }));
    const painel = await screen.findByRole("dialog", { name: "Pagar conta" });
    expect(within(painel).getByLabelText("Pagar com a conta")).toHaveValue(CAIXA.id);
    await u.selectOptions(within(painel).getByLabelText("Pagar com a conta"), BANCO.id);
    await u.selectOptions(within(painel).getByLabelText("Forma de pagamento"), "Pix");
    await u.click(within(painel).getByRole("button", { name: "Confirmar pagamento" }));
    const put = await esperarChamada(chamadas, "PUT", "/api/financeiro/contas-a-pagar/p1/baixar");
    expect(put.corpo).toEqual({ conta_id: BANCO.id, forma_pagamento: "pix" });
  });

  test("cancelar exige motivo e senha de supervisor, e o erro fica na janela", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "DELETE /api/financeiro/lancamentos/p2": { __status: 422, codigo: "SUPERVISOR_INVALIDO", mensagem: "Senha do supervisor incorreta." } }));
    await abrirAba("pagar");
    await screen.findByText("Luz de outubro");
    const linha = screen.getByText("Luz de outubro").closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Cancelar" }));
    const janela = await screen.findByRole("dialog", { name: "Cancelar lançamento" });
    await u.type(within(janela).getByLabelText("Motivo"), "Lançado em duplicidade");
    await u.type(within(janela).getByLabelText("Login do supervisor"), "admin");
    await u.type(within(janela).getByLabelText("Senha do supervisor"), "errada");
    await u.click(within(janela).getByRole("button", { name: /Confirmar|Autorizar|Cancelar lançamento/ }));
    expect(await within(janela).findByText("Senha do supervisor incorreta.")).toBeInTheDocument();
    const del = chamadas.find((c) => c.metodo === "DELETE")!;
    expect(del.corpo).toEqual({ motivo: "Lançado em duplicidade", supervisor: { login: "admin", senha: "errada" } });
  });

  test("sem contas a pagar mostra o aviso de lista vazia", async () => {
    instalarApiFalsa(rotas({ "GET /api/financeiro/lancamentos": [] }));
    await abrirAba("pagar");
    expect(await screen.findByText("Nenhuma conta a pagar encontrada.")).toBeInTheDocument();
  });
});
