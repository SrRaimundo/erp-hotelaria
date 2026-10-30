import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TelaCategoriasQuartos } from "../../src/telas/configuracoes/TelaCategoriasQuartos";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const USUARIO = { permissoes: ["cadastros.gerenciar", "tarifas.gerenciar"] };
const STD = { id: "c1", nome: "Standard", maxAdultos: 2, maxCriancas: 1, comodidades: ["Ar-condicionado", "TV"] };
const LUXO = { id: "c2", nome: "Luxo", maxAdultos: 3, maxCriancas: 2, comodidades: [] };
const Q101 = { id: "q1", numero: "101", categoriaId: "c1", bloco: "A", situacao: "livre" };
const Q201 = { id: "q2", numero: "201", categoriaId: "c2", bloco: null, situacao: "livre" };
const BASE_STD = { categoriaId: "c1", porAdultos: { 1: 20000, 2: 25000, 3: 30000 }, adultoExtra: 5000, piso: 15000, teto: null };

/** Rotas de leitura; `?incluirInativos` devolve a lista completa. */
function leituras(extra: Record<string, unknown> = {}) {
  return {
    "GET /api/categorias": [STD, LUXO],
    "GET /api/quartos": (_c: unknown, url: URL) => {
      const cat = url.searchParams.get("categoriaId");
      return [Q101, Q201].filter((q) => !cat || q.categoriaId === cat);
    },
    "GET /api/tarifas/tabelas-base": [BASE_STD],
    ...extra,
  };
}

describe("tela Categorias e quartos", () => {
  test("lista categorias e quartos e filtra os quartos por categoria", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras());
    renderizar(<TelaCategoriasQuartos />, { usuario: USUARIO });
    const quartos = await screen.findByRole("region", { name: "Quartos" });
    expect(await within(quartos).findByText("101")).toBeInTheDocument();
    expect(within(quartos).getByText("201")).toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText("Filtrar por categoria"), "c2");
    await vi.waitFor(() => expect(within(quartos).queryByText("101")).not.toBeInTheDocument());
    expect(within(quartos).getByText("201")).toBeInTheDocument();
    expect(chamadas.some((c) => c.caminho === "/api/quartos?categoriaId=c2")).toBe(true);
  });

  test("editar categoria salva categoria e preço base", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/categorias/c1": STD, "PUT /api/tarifas/tabelas-base": BASE_STD }));
    renderizar(<TelaCategoriasQuartos />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Categorias" });
    await u.click((await within(lista).findAllByRole("button", { name: "Editar" }))[0]!);
    const painel = await screen.findByRole("dialog", { name: /Categorias/ });
    expect(await within(painel).findByLabelText("Nome")).toHaveValue("Standard");
    expect(within(painel).getByLabelText("Comodidades (separadas por vírgula)")).toHaveValue("Ar-condicionado, TV");
    expect(within(painel).getByLabelText("Diária para 2 adultos")).toHaveValue("250,00");
    await u.clear(within(painel).getByLabelText("Nome"));
    await u.type(within(painel).getByLabelText("Nome"), "Standard Plus");
    await u.clear(within(painel).getByLabelText("Diária para 2 adultos"));
    await u.type(within(painel).getByLabelText("Diária para 2 adultos"), "260,00");
    await u.type(within(painel).getByLabelText("Teto"), "400");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "PUT" && c.caminho === "/api/tarifas/tabelas-base")).toBeDefined());
    expect(chamadas.find((c) => c.caminho === "/api/categorias/c1")).toMatchObject({
      metodo: "PUT",
      corpo: { nome: "Standard Plus", maxAdultos: 2, maxCriancas: 1, comodidades: ["Ar-condicionado", "TV"] },
    });
    expect(chamadas.find((c) => c.caminho === "/api/tarifas/tabelas-base" && c.metodo === "PUT")!.corpo).toEqual({
      categoriaId: "c1", porAdultos: { 1: 20000, 2: 26000, 3: 30000 }, adultoExtra: 5000, piso: 15000, teto: 40000,
    });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("nova categoria cria e salva o preço; falha no preço mantém o painel e não duplica a categoria", async () => {
    const u = userEvent.setup();
    let tentativas = 0;
    instalarApiFalsa(
      leituras({
        "POST /api/categorias": { __status: 201, id: "c9", nome: "Suíte", maxAdultos: 2, maxCriancas: 0, comodidades: ["Varanda"] },
        "PUT /api/categorias/c9": { id: "c9" },
        "PUT /api/tarifas/tabelas-base": () => (++tentativas === 1 ? { __status: 422, codigo: "VALIDACAO", mensagem: "Preço recusado." } : BASE_STD),
      }),
    );
    renderizar(<TelaCategoriasQuartos />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Categorias" });
    await u.click(within(lista).getByRole("button", { name: "+ Novo" }));
    const painel = await screen.findByRole("dialog", { name: /Categorias/ });
    await u.type(await within(painel).findByLabelText("Nome"), "Suíte");
    await u.type(within(painel).getByLabelText("Máximo de adultos"), "2");
    await u.type(within(painel).getByLabelText("Máximo de crianças"), "0");
    await u.type(within(painel).getByLabelText("Comodidades (separadas por vírgula)"), "Varanda");
    await u.type(within(painel).getByLabelText("Diária para 1 adulto"), "300");
    await u.type(within(painel).getByLabelText("Diária para 2 adultos"), "350");
    await u.type(within(painel).getByLabelText("Diária para 3 adultos"), "400");
    await u.type(within(painel).getByLabelText("Adulto extra"), "50");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Preço recusado.");
    expect(screen.getByRole("dialog", { name: /Categorias/ })).toBeInTheDocument();
    expect(chamadas.find((c) => c.metodo === "POST" && c.caminho === "/api/categorias")!.corpo).toEqual({
      nome: "Suíte", maxAdultos: 2, maxCriancas: 0, comodidades: ["Varanda"],
    });
    // nova tentativa: atualiza a categoria já criada (PUT), sem criar outra
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(chamadas.filter((c) => c.metodo === "POST" && c.caminho === "/api/categorias")).toHaveLength(1);
    expect(chamadas.some((c) => c.metodo === "PUT" && c.caminho === "/api/categorias/c9")).toBe(true);
    const preco = chamadas.filter((c) => c.metodo === "PUT" && c.caminho === "/api/tarifas/tabelas-base");
    expect(preco).toHaveLength(2);
    expect(preco[1]!.corpo).toEqual({ categoriaId: "c9", porAdultos: { 1: 30000, 2: 35000, 3: 40000 }, adultoExtra: 5000, piso: null, teto: null });
  });

  test("desativar categoria com quartos mostra a mensagem do servidor", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(
      leituras({
        "POST /api/categorias/c1/desativar": { __status: 409, codigo: "CATEGORIA_COM_QUARTOS", mensagem: "Esta categoria ainda tem quartos ativos." },
      }),
    );
    renderizar(<TelaCategoriasQuartos />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Categorias" });
    await u.click((await within(lista).findAllByRole("button", { name: "Editar" }))[0]!);
    const painel = await screen.findByRole("dialog", { name: /Categorias/ });
    await u.click(await within(painel).findByRole("button", { name: "Desativar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Esta categoria ainda tem quartos ativos.");
  });

  test("editar quarto: só categorias ativas como opção; salva com o corpo esperado", async () => {
    const u = userEvent.setup();
    const INATIVA = { id: "c3", nome: "Antiga", maxAdultos: 1, maxCriancas: 0, comodidades: [] };
    instalarApiFalsa(
      leituras({
        "GET /api/categorias": (_c: unknown, url: URL) => (url.searchParams.get("incluirInativos") ? [STD, LUXO, INATIVA] : [STD, LUXO]),
        "PUT /api/quartos/q1": Q101,
      }),
    );
    renderizar(<TelaCategoriasQuartos />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Quartos" });
    await u.click((await within(lista).findAllByRole("button", { name: "Editar" }))[0]!);
    const painel = await screen.findByRole("dialog", { name: /Quartos/ });
    const select = within(painel).getByLabelText("Categoria");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Standard", "Luxo"]);
    await u.clear(within(painel).getByLabelText("Número"));
    await u.type(within(painel).getByLabelText("Número"), "102");
    await u.clear(within(painel).getByLabelText("Bloco"));
    await u.selectOptions(select, "c2");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "PUT")).toBeDefined());
    expect(chamadas.find((c) => c.metodo === "PUT")).toMatchObject({
      caminho: "/api/quartos/q1",
      corpo: { numero: "102", categoriaId: "c2", bloco: null },
    });
  });

  test("novo quarto cria com POST /api/quartos", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "POST /api/quartos": { __status: 201, ...Q101 } }));
    renderizar(<TelaCategoriasQuartos />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Quartos" });
    await u.click(within(lista).getByRole("button", { name: "+ Novo" }));
    const painel = await screen.findByRole("dialog", { name: /Quartos/ });
    await u.type(within(painel).getByLabelText("Número"), "301");
    await u.selectOptions(within(painel).getByLabelText("Categoria"), "c2");
    await u.type(within(painel).getByLabelText("Bloco"), "B");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "POST")).toBeDefined());
    expect(chamadas.find((c) => c.metodo === "POST")).toMatchObject({ caminho: "/api/quartos", corpo: { numero: "301", categoriaId: "c2", bloco: "B" } });
  });

  test("desativar quarto com reservas mostra os códigos", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(
      leituras({
        "POST /api/quartos/q1/desativar": {
          __status: 409,
          codigo: "QUARTO_COM_RESERVAS",
          mensagem: "O quarto 101 está ocupado ou tem reservas ativas.",
          detalhes: { codigos: ["R-0012", "R-0015"] },
        },
      }),
    );
    renderizar(<TelaCategoriasQuartos />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Quartos" });
    await u.click((await within(lista).findAllByRole("button", { name: "Editar" }))[0]!);
    const painel = await screen.findByRole("dialog", { name: /Quartos/ });
    await u.click(within(painel).getByRole("button", { name: "Desativar" }));
    const alerta = await within(painel).findByRole("alert");
    expect(alerta).toHaveTextContent("O quarto 101 está ocupado ou tem reservas ativas.");
    expect(alerta).toHaveTextContent("R-0012");
    expect(alerta).toHaveTextContent("R-0015");
  });

  test("reativar quarto desativado (lista com desativados)", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(
      leituras({
        "GET /api/quartos": (_c: unknown, url: URL) => (url.searchParams.get("incluirInativos") ? [Q101, Q201] : [Q201]),
        "POST /api/quartos/q1/reativar": { ok: true },
      }),
    );
    renderizar(<TelaCategoriasQuartos />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Quartos" });
    await within(lista).findByText("201");
    expect(within(lista).queryByText("101")).not.toBeInTheDocument();
    await u.click(within(lista).getByLabelText("Mostrar desativados"));
    expect(await within(lista).findByText("desativado")).toBeInTheDocument();
    await u.click(within(lista).getAllByRole("button", { name: "Editar" })[0]!);
    const painel = await screen.findByRole("dialog", { name: /Quartos/ });
    await u.click(within(painel).getByRole("button", { name: "Reativar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.caminho === "/api/quartos/q1/reativar")).toBeDefined());
  });

  test("criar vários quartos e conflito listando números", async () => {
    const u = userEvent.setup();
    let tentativas = 0;
    instalarApiFalsa(
      leituras({
        "POST /api/quartos/lote": () =>
          ++tentativas === 1
            ? { __status: 409, codigo: "NUMERO_QUARTO_DUPLICADO", mensagem: "Nenhum quarto foi criado.", detalhes: { numeros: ["102", "103"] } }
            : { __status: 201 },
      }),
    );
    renderizar(<TelaCategoriasQuartos />, { usuario: USUARIO });
    await u.click(await screen.findByRole("button", { name: "Criar vários quartos" }));
    const painel = await screen.findByRole("dialog", { name: "Criar vários quartos" });
    await u.selectOptions(within(painel).getByLabelText("Categoria"), "c1");
    await u.type(within(painel).getByLabelText("De"), "101");
    await u.type(within(painel).getByLabelText("Até"), "104");
    await u.type(within(painel).getByLabelText("Bloco"), "A");
    await u.click(within(painel).getByRole("button", { name: "Criar quartos" }));
    const alerta = await within(painel).findByRole("alert");
    expect(alerta).toHaveTextContent("102");
    expect(alerta).toHaveTextContent("103");
    expect(chamadas.find((c) => c.caminho === "/api/quartos/lote")!.corpo).toEqual({ categoriaId: "c1", de: 101, ate: 104, bloco: "A" });
    expect(screen.getByRole("dialog", { name: "Criar vários quartos" })).toBeInTheDocument();
    await u.clear(within(painel).getByLabelText("De"));
    await u.type(within(painel).getByLabelText("De"), "105");
    await u.clear(within(painel).getByLabelText("Até"));
    await u.type(within(painel).getByLabelText("Até"), "106");
    await u.click(within(painel).getByRole("button", { name: "Criar quartos" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
