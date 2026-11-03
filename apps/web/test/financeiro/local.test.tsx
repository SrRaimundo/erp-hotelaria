import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { abrirAba, esperarChamada, LOCAL, LOCAL_2 } from "./base";

afterEach(() => vi.unstubAllGlobals());

describe("tela Local", () => {
  test("lista os locais e marca o que recebe a hospedagem", async () => {
    instalarApiFalsa({ "GET /api/financeiro/locais": [LOCAL, LOCAL_2] });
    await abrirAba("local");
    const lista = await screen.findByRole("region", { name: "Locais" });
    expect(within(lista).getByText("Pousada Sol")).toBeInTheDocument();
    expect(within(lista).getByText("Sorveteria")).toBeInTheDocument();
    expect(within(lista).getAllByText("recebe a hospedagem")).toHaveLength(1);
  });

  test("cria um local novo com o nome informado", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/financeiro/locais": [LOCAL],
      "POST /api/financeiro/locais": { __status: 201, ...LOCAL_2 },
    });
    await abrirAba("local");
    await u.click(await screen.findByRole("button", { name: "+ Novo local" }));
    const painel = await screen.findByRole("dialog");
    const salvar = within(painel).getByRole("button", { name: "Salvar" });
    expect(salvar).toBeDisabled();
    await u.type(within(painel).getByLabelText("Nome do local"), "Sorveteria");
    await u.click(within(painel).getByLabelText("Recebe os lançamentos da hospedagem"));
    await u.click(salvar);
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/locais");
    expect(post.corpo).toEqual({ nome: "Sorveteria", hospedagem_padrao: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("edita o nome e desativa; desativados só aparecem quando pedido", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/financeiro/locais": [LOCAL, { ...LOCAL_2, ativo: false }],
      "PUT /api/financeiro/locais/l1": LOCAL,
    });
    await abrirAba("local");
    const lista = await screen.findByRole("region", { name: "Locais" });
    expect(within(lista).queryByText("Sorveteria")).not.toBeInTheDocument();
    await u.click(within(lista).getByLabelText("Mostrar desativados"));
    expect(within(lista).getByText("Sorveteria")).toBeInTheDocument();

    await u.click(within(lista).getAllByRole("button", { name: "Editar" })[0]!);
    const painel = await screen.findByRole("dialog");
    await u.clear(within(painel).getByLabelText("Nome do local"));
    await u.type(within(painel).getByLabelText("Nome do local"), "Pousada Lua");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    const put = await esperarChamada(chamadas, "PUT", "/api/financeiro/locais/l1");
    expect(put.corpo).toEqual({ nome: "Pousada Lua" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await u.click(within(lista).getAllByRole("button", { name: "Editar" })[0]!);
    await u.click(await screen.findByRole("button", { name: "Desativar" }));
    await waitFor(() => expect(chamadas.filter((c) => c.metodo === "PUT")).toHaveLength(2));
    expect(chamadas.filter((c) => c.metodo === "PUT")[1]!.corpo).toEqual({ ativo: false });
  });

  test("erro do servidor aparece dentro do painel, junto do botão", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/financeiro/locais": [],
      "POST /api/financeiro/locais": { __status: 422, codigo: "VALIDACAO_FALHOU", mensagem: "Já existe um Local com este nome." },
    });
    await abrirAba("local");
    await u.click(await screen.findByRole("button", { name: "+ Novo local" }));
    const painel = await screen.findByRole("dialog");
    await u.type(within(painel).getByLabelText("Nome do local"), "Pousada");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Já existe um Local com este nome.");
  });

  test("sem nenhum local as outras telas orientam a cadastrar o primeiro", async () => {
    instalarApiFalsa({ "GET /api/financeiro/locais": [] });
    await abrirAba("pagar");
    expect(await screen.findByText(/Nenhum local ativo/)).toBeInTheDocument();
  });
});
