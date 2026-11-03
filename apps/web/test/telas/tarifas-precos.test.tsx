import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TelaDiasSemana } from "../../src/telas/tarifas/TelaDiasSemana";
import { TelaTabelaBase } from "../../src/telas/tarifas/TelaTabelaBase";
import { TelaTemporadas } from "../../src/telas/tarifas/TelaTemporadas";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const USUARIO = { permissoes: ["reservas.gerenciar", "tarifas.gerenciar"] };
const STD = { id: "c1", nome: "Standard", maxAdultos: 2, maxCriancas: 1, comodidades: [], ativo: true };
const LUXO = { id: "c2", nome: "Luxo", maxAdultos: 3, maxCriancas: 2, comodidades: [], ativo: true };
const BASE_STD = { categoriaId: "c1", porAdultos: { 1: 20000, 2: 25000, 3: 30000 }, adultoExtra: 5000, piso: 15000, teto: null };
const puts = (caminho: string) => chamadas.filter((c) => c.metodo === "PUT" && c.caminho === caminho);

describe("aba Tabela base", () => {
  const leituras = (extra: Record<string, unknown> = {}) => ({ "GET /api/tarifas/tabelas-base": [BASE_STD], "GET /api/categorias": [STD, LUXO], ...extra });

  test("lista a tabela e avisa das categorias sem tabela", async () => {
    instalarApiFalsa(leituras());
    renderizar(<TelaTabelaBase />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Tabela base" });
    expect(await within(lista).findByText("Standard")).toBeInTheDocument();
    expect(within(lista).getByText("R$ 250,00")).toBeInTheDocument();
    expect(await screen.findByText(/Sem tabela de preços: Luxo/)).toBeInTheDocument();
  });

  test("editar salva o corpo esperado, com piso e teto, e fecha o painel", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/tarifas/tabelas-base": BASE_STD }));
    renderizar(<TelaTabelaBase />, { usuario: USUARIO });
    await u.click(await screen.findByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog");
    await u.clear(within(painel).getByLabelText("Diária para 2 adultos"));
    await u.type(within(painel).getByLabelText("Diária para 2 adultos"), "260,00");
    await u.type(within(painel).getByLabelText("Teto"), "400");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(puts("/api/tarifas/tabelas-base")).toHaveLength(1));
    expect(puts("/api/tarifas/tabelas-base")[0]!.corpo).toEqual({
      categoriaId: "c1", porAdultos: { 1: 20000, 2: 26000, 3: 30000 }, adultoExtra: 5000, piso: 15000, teto: 40000,
    });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("nova tabela oferece só categorias sem tabela e explica o botão desligado", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras());
    renderizar(<TelaTabelaBase />, { usuario: USUARIO });
    await screen.findByText("Standard");
    await screen.findByText(/Sem tabela de preços/);
    await u.click(screen.getByRole("button", { name: "+ Nova tabela" }));
    const painel = await screen.findByRole("dialog");
    expect(within(painel).getAllByRole("option").map((o) => o.textContent)).toEqual(["Luxo"]);
    expect(within(painel).getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(within(painel).getByText("Informe a diária para 1, 2 e 3 adultos.")).toBeInTheDocument();
  });

  test("mostra a mensagem do servidor junto do botão e mantém o painel", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/tarifas/tabelas-base": { __status: 422, codigo: "TABELA_INVALIDA", mensagem: "O piso não pode passar do teto." } }));
    renderizar(<TelaTabelaBase />, { usuario: USUARIO });
    await u.click(await screen.findByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("O piso não pode passar do teto.");
  });
});

describe("aba Temporadas", () => {
  const ALTA = { id: "t1", nome: "Alta", inicio: "2026-12-20", fim: "2027-01-10", prioridade: 1, percentual: 20, tabelas: [] };
  const CARNAVAL = {
    id: "t2", nome: "Carnaval", inicio: "2027-02-05", fim: "2027-02-10", prioridade: 2, percentual: null,
    tabelas: [{ categoriaId: "c1", porAdultos: { 1: 30000, 2: 40000, 3: 45000 }, adultoExtra: 8000 }],
  };
  const leituras = (extra: Record<string, unknown> = {}) => ({ "GET /api/tarifas/temporadas": [ALTA, CARNAVAL], "GET /api/categorias": [STD, LUXO], ...extra });

  test("lista período e como cada temporada muda o preço", async () => {
    instalarApiFalsa(leituras());
    renderizar(<TelaTemporadas />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Temporadas" });
    expect(await within(lista).findByText("20/12/2026 a 10/01/2027")).toBeInTheDocument();
    expect(within(lista).getByText("20% sobre a base")).toBeInTheDocument();
    expect(within(lista).getByText(/Tabela própria: Standard R\$ 400,00/)).toBeInTheDocument();
  });

  test("alterar o percentual envia a temporada completa com o mesmo id", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/tarifas/temporadas": ALTA }));
    renderizar(<TelaTemporadas />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Temporadas" });
    await u.click((await within(lista).findAllByRole("button", { name: "Editar" }))[0]!);
    const painel = await screen.findByRole("dialog");
    expect(within(painel).getByLabelText("Nome")).toHaveValue("Alta");
    await u.clear(within(painel).getByLabelText("Percentual (%)"));
    await u.type(within(painel).getByLabelText("Percentual (%)"), "35,5");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(puts("/api/tarifas/temporadas")).toHaveLength(1));
    expect(puts("/api/tarifas/temporadas")[0]!.corpo).toEqual({
      id: "t1", nome: "Alta", inicio: "2026-12-20", fim: "2027-01-10", prioridade: 1, percentual: 35.5, tabelas: [],
    });
  });

  test("tabela própria: envia só as categorias marcadas e zera o percentual", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/tarifas/temporadas": CARNAVAL }));
    renderizar(<TelaTemporadas />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Temporadas" });
    await u.click((await within(lista).findAllByRole("button", { name: "Editar" }))[1]!);
    const painel = await screen.findByRole("dialog");
    expect(within(painel).getByLabelText("Standard: diária para 2 adultos")).toHaveValue("400,00");
    expect(within(painel).getByRole("checkbox", { name: "Tabela própria: Luxo" })).not.toBeChecked();
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(puts("/api/tarifas/temporadas")).toHaveLength(1));
    expect(puts("/api/tarifas/temporadas")[0]!.corpo).toEqual({
      id: "t2", nome: "Carnaval", inicio: "2027-02-05", fim: "2027-02-10", prioridade: 2, percentual: null,
      tabelas: [{ categoriaId: "c1", porAdultos: { 1: 30000, 2: 40000, 3: 45000 }, adultoExtra: 8000 }],
    });
  });

  test("período que cruza outra temporada gera aviso, sem bloquear o salvar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras());
    renderizar(<TelaTemporadas />, { usuario: USUARIO });
    await screen.findByText("Alta");
    await u.click(screen.getByRole("button", { name: "+ Novo" }));
    const painel = await screen.findByRole("dialog");
    await u.type(within(painel).getByLabelText("Nome"), "Réveillon");
    await u.type(within(painel).getByLabelText("Início"), "2026-12-28");
    await u.type(within(painel).getByLabelText("Fim"), "2027-01-02");
    expect(await within(painel).findByText(/Este período se cruza com: Alta \(20\/12\/2026 a 10\/01\/2027\)\. A prioridade é a mesma/)).toBeInTheDocument();
    expect(within(painel).getByRole("button", { name: "Salvar" })).toBeEnabled();
  });

  test("erro do servidor aparece junto do salvar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/tarifas/temporadas": { __status: 422, codigo: "TEMPORADA_SOBREPOSTA", mensagem: "Já existe uma temporada nesse período." } }));
    renderizar(<TelaTemporadas />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Temporadas" });
    await u.click((await within(lista).findAllByRole("button", { name: "Editar" }))[0]!);
    const painel = await screen.findByRole("dialog");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Já existe uma temporada nesse período.");
  });
});

describe("aba Dias da semana", () => {
  test("mostra os sete dias e salva os sete percentuais, um PUT por dia", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/tarifas/dias-semana": [{ dia: 5, percentual: 7 }, { dia: 6, percentual: 15 }],
      "PUT /api/tarifas/dias-semana": (c: { dia: number; percentual: number }) => c,
    });
    renderizar(<TelaDiasSemana />, { usuario: USUARIO });
    await waitFor(() => expect(screen.getByLabelText("Sábado (%)")).toHaveValue("15"));
    expect(screen.getByLabelText("Sexta-feira (%)")).toHaveValue("7");
    expect(screen.getByLabelText("Segunda-feira (%)")).toHaveValue("0");
    await u.clear(screen.getByLabelText("Domingo (%)"));
    await u.type(screen.getByLabelText("Domingo (%)"), "-10");
    await u.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Salvo.")).toBeInTheDocument();
    expect(puts("/api/tarifas/dias-semana").map((c) => c.corpo)).toEqual([
      { dia: 0, percentual: -10 }, { dia: 1, percentual: 0 }, { dia: 2, percentual: 0 }, { dia: 3, percentual: 0 },
      { dia: 4, percentual: 0 }, { dia: 5, percentual: 7 }, { dia: 6, percentual: 15 },
    ]);
  });

  test("percentual inválido desliga o salvar e explica", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/tarifas/dias-semana": [] });
    renderizar(<TelaDiasSemana />, { usuario: USUARIO });
    await u.clear(await screen.findByLabelText("Terça-feira (%)"));
    await u.type(screen.getByLabelText("Terça-feira (%)"), "abc");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(screen.getByText(/Informe um percentual válido para todos os dias/)).toBeInTheDocument();
  });

  test("falha do servidor aparece junto do salvar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/tarifas/dias-semana": [],
      "PUT /api/tarifas/dias-semana": { __status: 422, codigo: "X", mensagem: "O percentual deve ser maior que −100" },
    });
    renderizar(<TelaDiasSemana />, { usuario: USUARIO });
    await u.click(await screen.findByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("O percentual deve ser maior que −100");
  });
});

describe("remover temporada e outras correções", () => {
  const ALTA = { id: "t1", nome: "Alta", inicio: "2026-12-20", fim: "2027-01-10", prioridade: 1, percentual: 20, tabelas: [] };
  const MISTA = { id: "t3", nome: "Mista", inicio: "2027-03-01", fim: "2027-03-05", prioridade: 1, percentual: 10, tabelas: [{ categoriaId: "c1", porAdultos: { 1: 1, 2: 2, 3: 3 }, adultoExtra: 4 }] };
  const apagadas = (caminho: string) => chamadas.filter((c) => c.metodo === "DELETE" && c.caminho === caminho);

  test("Remover temporada pergunta antes, depois usa DELETE e fecha o painel", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/tarifas/temporadas": [ALTA], "GET /api/categorias": [STD], "DELETE /api/tarifas/temporadas/t1": { ok: true } });
    renderizar(<TelaTemporadas />, { usuario: USUARIO });
    await u.click(await screen.findByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog");
    await u.click(within(painel).getByRole("button", { name: "Remover temporada" }));
    expect(apagadas("/api/tarifas/temporadas/t1")).toHaveLength(0);
    expect(within(painel).getByText(/Reservas já feitas mantêm os preços que têm/)).toBeInTheDocument();
    await u.click(within(painel).getByRole("button", { name: "Cancelar" }));
    expect(within(painel).getByRole("button", { name: "Remover temporada" })).toBeInTheDocument();
    await u.click(within(painel).getByRole("button", { name: "Remover temporada" }));
    await u.click(within(painel).getByRole("button", { name: "Confirmar remoção" }));
    await vi.waitFor(() => expect(apagadas("/api/tarifas/temporadas/t1")).toHaveLength(1));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("erro ao remover aparece junto do botão de confirmar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/tarifas/temporadas": [ALTA], "GET /api/categorias": [STD], "DELETE /api/tarifas/temporadas/t1": { __status: 422, codigo: "TEMPORADA_NAO_ENCONTRADA", mensagem: "Temporada não encontrada." } });
    renderizar(<TelaTemporadas />, { usuario: USUARIO });
    await u.click(await screen.findByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog");
    await u.click(within(painel).getByRole("button", { name: "Remover temporada" }));
    await u.click(within(painel).getByRole("button", { name: "Confirmar remoção" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Temporada não encontrada.");
  });

  test("temporada com percentual e tabela salva em modo tabela sem perder o percentual", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/tarifas/temporadas": [MISTA], "GET /api/categorias": [STD], "PUT /api/tarifas/temporadas": MISTA });
    renderizar(<TelaTemporadas />, { usuario: USUARIO });
    await u.click(await screen.findByRole("button", { name: "Editar" }));
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(puts("/api/tarifas/temporadas")).toHaveLength(1));
    expect(puts("/api/tarifas/temporadas")[0]!.corpo).toMatchObject({ id: "t3", percentual: 10 });
  });

  test("dias da semana: -100 desliga o salvar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/tarifas/dias-semana": [] });
    renderizar(<TelaDiasSemana />, { usuario: USUARIO });
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled());
    await u.clear(screen.getByLabelText("Domingo (%)"));
    await u.type(screen.getByLabelText("Domingo (%)"), "-100");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(screen.getByText("O percentual deve ser maior que -100.")).toBeInTheDocument();
  });
});
