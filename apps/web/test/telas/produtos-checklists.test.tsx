import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TelaChecklists } from "../../src/telas/configuracoes/TelaChecklists";
import { TelaProdutos } from "../../src/telas/configuracoes/TelaProdutos";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const AGUA = { id: "p1", codigo: "AGUA", nome: "Água", precoCentavos: 500, unidade: "un", grupo: "frigobar", tipo: "produto", setores: ["frigobar", "recepcao"], ativo: true };
const JANTAR = { id: "p2", codigo: "JANTAR", nome: "Jantar", precoCentavos: 8000, unidade: "un", grupo: "restaurante", tipo: "servico", setores: ["restaurante"], ativo: true };
const ANTIGO = { id: "p3", codigo: "ANTIGO", nome: "Antigo", precoCentavos: 100, unidade: "un", grupo: "bar", tipo: "produto", setores: ["bar"], ativo: false };

describe("tela Produtos", () => {
  test("produto exige ao menos um setor e salva preço em centavos", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/produtos": [AGUA], "POST /api/produtos": { __status: 201, ...AGUA } });
    renderizar(<TelaProdutos />, { usuario: { permissoes: ["cadastros.gerenciar"] } });
    const lista = await screen.findByRole("region", { name: "Produtos" });
    await u.click(await within(lista).findByRole("button", { name: "+ Novo" }));
    const painel = await screen.findByRole("dialog", { name: /Produtos/ });
    await u.type(within(painel).getByLabelText("Código"), "SUCO");
    await u.type(within(painel).getByLabelText("Nome"), "Suco");
    await u.type(within(painel).getByLabelText("Preço"), "12,50");
    const salvar = within(painel).getByRole("button", { name: "Salvar" });
    expect(salvar).toBeDisabled();
    expect(within(painel).getByText("Marque ao menos um setor de venda.")).toBeInTheDocument();
    await u.click(within(painel).getByLabelText("Frigobar"));
    await u.click(within(painel).getByLabelText("Bar"));
    expect(salvar).toBeEnabled();
    await u.click(salvar);
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "POST")).toBeDefined());
    expect(chamadas.find((c) => c.metodo === "POST")).toMatchObject({
      caminho: "/api/produtos",
      corpo: { codigo: "SUCO", nome: "Suco", precoCentavos: 1250, unidade: "un", tipo: "produto", setores: ["frigobar", "bar"] },
    });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("editar: código não aparece; salva com PUT e desativa; produtos de uso são invalidados", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/produtos": [AGUA, JANTAR], "PUT /api/produtos/p1": AGUA, "POST /api/produtos/p1/desativar": { ok: true } });
    const { cliente } = renderizar(<TelaProdutos />, { usuario: { permissoes: ["cadastros.gerenciar"] } });
    cliente.setQueryData(["produtos", "frigobar"], []);
    const lista = await screen.findByRole("region", { name: "Produtos" });
    await u.click((await within(lista).findAllByRole("button", { name: "Editar" }))[0]!);
    const painel = await screen.findByRole("dialog", { name: /Produtos/ });
    expect(within(painel).queryByLabelText("Código")).not.toBeInTheDocument();
    expect(within(painel).getByLabelText("Nome")).toHaveValue("Água");
    expect(within(painel).getByLabelText("Preço")).toHaveValue("5,00");
    await u.clear(within(painel).getByLabelText("Preço"));
    await u.type(within(painel).getByLabelText("Preço"), "6");
    await u.click(within(painel).getByLabelText("Recepção"));
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "PUT")).toBeDefined());
    expect(chamadas.find((c) => c.metodo === "PUT")).toMatchObject({
      caminho: "/api/produtos/p1",
      corpo: { nome: "Água", precoCentavos: 600, unidade: "un", tipo: "produto", setores: ["frigobar"] },
    });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(cliente.getQueryState(["produtos", "frigobar"])?.isInvalidated).toBe(true);
    await u.click((await within(lista).findAllByRole("button", { name: "Editar" }))[0]!);
    const painel2 = await screen.findByRole("dialog", { name: /Produtos/ });
    await u.click(within(painel2).getByRole("button", { name: "Desativar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.caminho === "/api/produtos/p1/desativar")).toBeDefined());
  });

  test("M3: a lista mostra a coluna Unidade", async () => {
    instalarApiFalsa({ "GET /api/produtos": [{ ...AGUA, unidade: "garrafa" }, JANTAR] });
    renderizar(<TelaProdutos />, { usuario: { permissoes: ["cadastros.gerenciar"] } });
    const lista = await screen.findByRole("region", { name: "Produtos" });
    expect(await within(lista).findByRole("columnheader", { name: "Unidade" })).toBeInTheDocument();
    expect(within(lista).getByText("garrafa")).toBeInTheDocument();
  });

  test("editar preserva o setor interno hospedagem no PUT", async () => {
    const u = userEvent.setup();
    const INTERNO = { ...AGUA, setores: ["hospedagem", "recepcao"] };
    instalarApiFalsa({ "GET /api/produtos": [INTERNO], "PUT /api/produtos/p1": INTERNO });
    renderizar(<TelaProdutos />, { usuario: { permissoes: ["cadastros.gerenciar"] } });
    const lista = await screen.findByRole("region", { name: "Produtos" });
    await u.click(await within(lista).findByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog", { name: /Produtos/ });
    expect(within(painel).queryByLabelText("Hospedagem")).not.toBeInTheDocument();
    await u.click(within(painel).getByLabelText("Bar"));
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "PUT")).toBeDefined());
    expect((chamadas.find((c) => c.metodo === "PUT")!.corpo as { setores: string[] }).setores).toEqual(["hospedagem", "recepcao", "bar"]);
  });

  test("I1: abrir Produtos não põe desativados na chave de uso de produtos", async () => {
    instalarApiFalsa({ "GET /api/produtos": [AGUA, ANTIGO] });
    const { cliente } = renderizar(<TelaProdutos />, { usuario: { permissoes: ["cadastros.gerenciar"] } });
    await screen.findByRole("region", { name: "Produtos" });
    await vi.waitFor(() => expect(cliente.getQueryData(["produtos", "retaguarda"])).toHaveLength(2));
    expect(cliente.getQueryData(["produtos", null])).toBeUndefined();
    expect(cliente.getQueryData(["produtos"])).toBeUndefined();
  });

  test("Todos: marca e desmarca os quatro setores, fica parcial e envia os setores individuais", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/produtos": [], "POST /api/produtos": { __status: 201, ...AGUA } });
    renderizar(<TelaProdutos />, { usuario: { permissoes: ["cadastros.gerenciar"] } });
    const lista = await screen.findByRole("region", { name: "Produtos" });
    await u.click(await within(lista).findByRole("button", { name: "+ Novo" }));
    const painel = await screen.findByRole("dialog", { name: /Produtos/ });
    const todos = within(painel).getByLabelText("Todos") as HTMLInputElement;
    const rotulos = ["Recepção", "Frigobar", "Bar", "Restaurante"];
    const marcados = () => rotulos.map((r) => (within(painel).getByLabelText(r) as HTMLInputElement).checked);
    // Todos fica acima dos quatro setores.
    const ordem = within(painel).getAllByRole("checkbox").map((c) => c.closest("label")!.textContent);
    expect(ordem).toEqual(["Todos", ...rotulos]);
    expect(todos.checked).toBe(false);
    expect(todos.indeterminate).toBe(false);

    await u.click(todos);
    expect(marcados()).toEqual([true, true, true, true]);
    expect(todos.checked).toBe(true);
    expect(todos.indeterminate).toBe(false);

    await u.click(within(painel).getByLabelText("Bar"));
    expect(todos.checked).toBe(false);
    expect(todos.indeterminate).toBe(true);

    await u.click(within(painel).getByLabelText("Bar"));
    expect(todos.checked).toBe(true);

    await u.click(todos);
    expect(marcados()).toEqual([false, false, false, false]);
    expect(todos.indeterminate).toBe(false);
    expect(within(painel).getByText("Marque ao menos um setor de venda.")).toBeInTheDocument();

    // Parcial: clicar em Todos completa os quatro.
    await u.click(within(painel).getByLabelText("Frigobar"));
    expect(todos.indeterminate).toBe(true);
    await u.click(todos);
    expect(marcados()).toEqual([true, true, true, true]);

    await u.type(within(painel).getByLabelText("Código"), "SUCO");
    await u.type(within(painel).getByLabelText("Nome"), "Suco");
    await u.type(within(painel).getByLabelText("Preço"), "12,50");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "POST")).toBeDefined());
    const corpo = chamadas.find((c) => c.metodo === "POST")!.corpo as { setores: string[] };
    expect(corpo.setores).toEqual(["recepcao", "frigobar", "bar", "restaurante"]);
    expect(corpo).not.toHaveProperty("todos");
  });

  test("Todos reflete o produto editado e preserva o setor interno hospedagem", async () => {
    const u = userEvent.setup();
    const COMPLETO = { ...AGUA, setores: ["hospedagem", "recepcao", "frigobar", "bar", "restaurante"] };
    instalarApiFalsa({ "GET /api/produtos": [COMPLETO], "PUT /api/produtos/p1": COMPLETO });
    renderizar(<TelaProdutos />, { usuario: { permissoes: ["cadastros.gerenciar"] } });
    const lista = await screen.findByRole("region", { name: "Produtos" });
    // Coluna Setores: com os quatro, mostra "Todos".
    expect(await within(lista).findByRole("cell", { name: "Todos" })).toBeInTheDocument();
    await u.click(within(lista).getByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog", { name: /Produtos/ });
    const todos = within(painel).getByLabelText("Todos") as HTMLInputElement;
    expect(todos.checked).toBe(true);
    await u.click(todos);
    await u.click(within(painel).getByLabelText("Bar"));
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "PUT")).toBeDefined());
    expect((chamadas.find((c) => c.metodo === "PUT")!.corpo as { setores: string[] }).setores).toEqual(["hospedagem", "bar"]);
  });

  test("a coluna Setores lista os nomes quando não são os quatro", async () => {
    instalarApiFalsa({ "GET /api/produtos": [AGUA, { ...JANTAR, setores: ["recepcao", "frigobar", "bar"] }] });
    renderizar(<TelaProdutos />, { usuario: { permissoes: ["cadastros.gerenciar"] } });
    const lista = await screen.findByRole("region", { name: "Produtos" });
    expect(await within(lista).findByRole("cell", { name: "Frigobar, Recepção" })).toBeInTheDocument();
    expect(within(lista).getByRole("cell", { name: "Recepção, Frigobar, Bar" })).toBeInTheDocument();
    expect(within(lista).queryByRole("cell", { name: "Todos" })).not.toBeInTheDocument();
  });

  test("filtra por setor e mostra desativados sob demanda; reativar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/produtos": [AGUA, JANTAR, ANTIGO], "POST /api/produtos/p3/reativar": { ok: true } });
    renderizar(<TelaProdutos />, { usuario: { permissoes: ["cadastros.gerenciar"] } });
    const lista = await screen.findByRole("region", { name: "Produtos" });
    await within(lista).findByText("Água");
    expect(within(lista).queryByText("Antigo")).not.toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText("Filtrar por setor"), "restaurante");
    expect(within(lista).queryByText("Água")).not.toBeInTheDocument();
    expect(within(lista).getByText("Jantar")).toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText("Filtrar por setor"), "");
    await u.click(within(lista).getByLabelText("Mostrar desativados"));
    expect(await within(lista).findByText("Antigo")).toBeInTheDocument();
    const linha = within(lista).getByText("Antigo").closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog", { name: /Produtos/ });
    await u.click(within(painel).getByRole("button", { name: "Reativar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.caminho === "/api/produtos/p3/reativar")).toBeDefined());
  });
});

const item = (id: string, etapa: string, texto: string, ordem: number, ativo = true) => ({ id, etapa, texto, ordem, ativo });
const ITENS_SAIDA = [
  item("i1", "limpeza", "Banheiro limpo", 1),
  item("i2", "limpeza", "Chão limpo", 2),
  item("i3", "limpeza", "Espelho", 3, false),
  item("i4", "enxoval", "Toalhas", 1),
];

function rotasChecklist(extra: Record<string, unknown> = {}) {
  return {
    "GET /api/checklists/itens": (_c: unknown, url: URL) => (url.searchParams.get("tipo") === "saida" ? ITENS_SAIDA : [item("d1", "controles", "Controle da TV", 1)]),
    ...extra,
  };
}

describe("tela Checklists", () => {
  test("checklist: incluir, mover e desativar item", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(
      rotasChecklist({
        "POST /api/checklists/itens": { __status: 201, ...item("n1", "enxoval", "Lençóis", 2) },
        "POST /api/checklists/itens/i2/mover": { ok: true },
        "PUT /api/checklists/itens/i1": item("i1", "limpeza", "Banheiro limpo", 1, false),
      }),
    );
    const { cliente } = renderizar(<TelaChecklists />, { usuario: { permissoes: ["config.gerenciar"] } });
    cliente.setQueryData(["checklist-modelos"], { saida: [], diaria: [] });
    const limpeza = await screen.findByRole("region", { name: "Limpeza" });
    // limites: primeiro não sobe, último não desce
    expect(within(limpeza).getByRole("button", { name: "Mover Banheiro limpo para cima" })).toBeDisabled();
    expect(within(limpeza).getByRole("button", { name: "Mover Banheiro limpo para baixo" })).toBeEnabled();
    expect(within(limpeza).getByRole("button", { name: "Mover Espelho para baixo" })).toBeDisabled();

    await u.click(within(limpeza).getByRole("button", { name: "Mover Chão limpo para cima" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.caminho === "/api/checklists/itens/i2/mover")).toBeDefined());
    expect(chamadas.find((c) => c.caminho === "/api/checklists/itens/i2/mover")!.corpo).toEqual({ direcao: "acima" });
    await vi.waitFor(() => expect(cliente.getQueryState(["checklist-modelos"])?.isInvalidated).toBe(true));

    await u.click(within(limpeza).getByRole("button", { name: "Desativar Banheiro limpo" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "PUT" && c.caminho === "/api/checklists/itens/i1")).toBeDefined());
    expect(chamadas.find((c) => c.metodo === "PUT")!.corpo).toEqual({ ativo: false });
    expect(within(limpeza).getByRole("button", { name: "Reativar Espelho" })).toBeInTheDocument();

    const enxoval = screen.getByRole("region", { name: "Enxoval recolhido" });
    await u.click(within(enxoval).getByRole("button", { name: "+ Item" }));
    await u.type(within(enxoval).getByLabelText("Novo item"), "Lençóis");
    await u.click(within(enxoval).getByRole("button", { name: "Incluir" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "POST" && c.caminho === "/api/checklists/itens")).toBeDefined());
    expect(chamadas.find((c) => c.caminho === "/api/checklists/itens" && c.metodo === "POST")).toMatchObject({ corpo: { tipo: "saida", etapa: "enxoval", texto: "Lençóis" } });
    await vi.waitFor(() => expect(within(enxoval).queryByLabelText("Novo item")).not.toBeInTheDocument());
  });

  test("renomear em linha salva só o texto; limite de 120 caracteres; Cancelar descarta", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotasChecklist({ "PUT /api/checklists/itens/i4": item("i4", "enxoval", "Toalhas de banho", 1) }));
    renderizar(<TelaChecklists />, { usuario: { permissoes: ["config.gerenciar"] } });
    const enxoval = await screen.findByRole("region", { name: "Enxoval recolhido" });
    await u.click(await within(enxoval).findByRole("button", { name: "Renomear Toalhas" }));
    const campo = within(enxoval).getByLabelText("Texto do item");
    expect(campo).toHaveValue("Toalhas");
    expect(campo).toHaveAttribute("maxlength", "120");
    await u.clear(campo);
    expect(within(enxoval).getByRole("button", { name: "Salvar" })).toBeDisabled();
    await u.type(campo, "Toalhas de banho");
    await u.click(within(enxoval).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "PUT")).toBeDefined());
    expect(chamadas.find((c) => c.metodo === "PUT")).toMatchObject({ caminho: "/api/checklists/itens/i4", corpo: { texto: "Toalhas de banho" } });
    await vi.waitFor(() => expect(within(enxoval).queryByLabelText("Texto do item")).not.toBeInTheDocument());

    await u.click(within(enxoval).getByRole("button", { name: "Renomear Toalhas" }));
    await u.click(within(enxoval).getByRole("button", { name: "Cancelar" }));
    expect(within(enxoval).queryByLabelText("Texto do item")).not.toBeInTheDocument();
    expect(chamadas.filter((c) => c.metodo === "PUT")).toHaveLength(1);
  });

  test("aba Diária carrega o outro modelo e inclui com tipo diaria", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotasChecklist({ "POST /api/checklists/itens": { __status: 201, ...item("n2", "limpeza", "Pó", 1) } }));
    renderizar(<TelaChecklists />, { usuario: { permissoes: ["config.gerenciar"] } });
    await screen.findByText("Banheiro limpo");
    await u.click(screen.getByRole("tab", { name: "Diária" }));
    expect(await screen.findByText("Controle da TV")).toBeInTheDocument();
    expect(screen.queryByText("Banheiro limpo")).not.toBeInTheDocument();
    const limpeza = screen.getByRole("region", { name: "Limpeza" });
    expect(within(limpeza).getByText("Nenhum item nesta etapa.")).toBeInTheDocument();
    await u.click(within(limpeza).getByRole("button", { name: "+ Item" }));
    await u.type(within(limpeza).getByLabelText("Novo item"), "Pó");
    await u.click(within(limpeza).getByRole("button", { name: "Incluir" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "POST")).toBeDefined());
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual({ tipo: "diaria", etapa: "limpeza", texto: "Pó" });
  });

  test("erro do servidor aparece junto da ação", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotasChecklist({ "POST /api/checklists/itens/i2/mover": { __status: 409, codigo: "X", mensagem: "Não foi possível mover." } }));
    renderizar(<TelaChecklists />, { usuario: { permissoes: ["config.gerenciar"] } });
    const limpeza = await screen.findByRole("region", { name: "Limpeza" });
    await u.click(await within(limpeza).findByRole("button", { name: "Mover Chão limpo para cima" }));
    expect(await within(limpeza).findByRole("alert")).toHaveTextContent("Não foi possível mover.");
  });
});
