import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TelaCanais } from "../../src/telas/tarifas/TelaCanais";
import { TelaCriancas } from "../../src/telas/tarifas/TelaCriancas";
import { TelaOcupacao } from "../../src/telas/tarifas/TelaOcupacao";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const USUARIO = { permissoes: ["reservas.gerenciar", "tarifas.gerenciar"] };
const feitas = (metodo: string, caminho: string) => chamadas.filter((c) => c.metodo === metodo && c.caminho === caminho);

describe("aba Canais", () => {
  const BALCAO = { id: "k1", nome: "Balcão", percentual: 0, exigeSinal: false, tipo: "direta", comissaoPercentual: 0 };
  const BOOKING = { id: "k2", nome: "Booking", percentual: 15, exigeSinal: true, tipo: "ota", comissaoPercentual: 12.5 };
  const leituras = (extra: Record<string, unknown> = {}) => ({ "GET /api/tarifas/canais": [BALCAO, BOOKING], ...extra });
  const editar = async (u: ReturnType<typeof userEvent.setup>, nome: string) => {
    const linha = (await screen.findByText(nome)).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Editar" }));
    return screen.findByRole("dialog");
  };

  test("lista tipo (com o rótulo) e comissão de cada canal", async () => {
    instalarApiFalsa(leituras());
    renderizar(<TelaCanais />, { usuario: USUARIO });
    const linha = (await screen.findByText("Booking")).closest("tr")!;
    expect(within(linha).getByText("OTA")).toBeInTheDocument();
    expect(within(linha).getByText("12,5%")).toBeInTheDocument();
    expect(within((await screen.findByText("Balcão")).closest("tr")!).getByText("Reserva direta")).toBeInTheDocument();
  });

  test("o seletor de tipo oferece os quatro rótulos", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras());
    renderizar(<TelaCanais />, { usuario: USUARIO });
    await screen.findByText("Booking");
    await u.click(screen.getByRole("button", { name: "+ Novo" }));
    const painel = await screen.findByRole("dialog");
    expect(within(within(painel).getByLabelText("Tipo")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Reserva direta", "OTA", "Agência", "Passante"]);
  });

  test("editar tipo e comissão envia o canal completo", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/tarifas/canais": BOOKING }));
    renderizar(<TelaCanais />, { usuario: USUARIO });
    const painel = await editar(u, "Booking");
    await u.selectOptions(within(painel).getByLabelText("Tipo"), "agencia");
    await u.clear(within(painel).getByLabelText("Comissão (%)"));
    await u.type(within(painel).getByLabelText("Comissão (%)"), "8,75");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(feitas("PUT", "/api/tarifas/canais")).toHaveLength(1));
    expect(feitas("PUT", "/api/tarifas/canais")[0]!.corpo).toEqual({
      id: "k2", nome: "Booking", percentual: 15, exigeSinal: true, tipo: "agencia", comissaoPercentual: 8.75,
    });
  });

  test("comissão acima de 100 ou com três casas desliga o salvar e explica", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras());
    renderizar(<TelaCanais />, { usuario: USUARIO });
    const painel = await editar(u, "Booking");
    await u.clear(within(painel).getByLabelText("Comissão (%)"));
    await u.type(within(painel).getByLabelText("Comissão (%)"), "101");
    expect(within(painel).getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(within(painel).getByText("A comissão deve ficar entre 0 e 100.")).toBeInTheDocument();
    await u.clear(within(painel).getByLabelText("Comissão (%)"));
    await u.type(within(painel).getByLabelText("Comissão (%)"), "5,123");
    expect(within(painel).getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(within(painel).getByText("Informe a comissão (use 0 se não houver).")).toBeInTheDocument();
  });

  test("remover usa DELETE e fecha o painel", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "DELETE /api/tarifas/canais/k2": { ok: true } }));
    renderizar(<TelaCanais />, { usuario: USUARIO });
    const painel = await editar(u, "Booking");
    await u.click(within(painel).getByRole("button", { name: "Remover canal" }));
    expect(feitas("DELETE", "/api/tarifas/canais/k2")).toHaveLength(0);
    expect(within(painel).getByText("Remover o canal Booking? Isso não pode ser desfeito.")).toBeInTheDocument();
    await u.click(within(painel).getByRole("button", { name: "Confirmar remoção" }));
    await vi.waitFor(() => expect(feitas("DELETE", "/api/tarifas/canais/k2")).toHaveLength(1));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("canal em uso: a mensagem CANAL_EM_USO aparece junto do botão Remover", async () => {
    const u = userEvent.setup();
    const mensagem = 'O canal "Booking" tem reservas e não pode ser removido nem renomeado.';
    instalarApiFalsa(leituras({ "DELETE /api/tarifas/canais/k2": { __status: 422, codigo: "CANAL_EM_USO", mensagem, detalhes: { canais: ["Booking"] } } }));
    renderizar(<TelaCanais />, { usuario: USUARIO });
    const painel = await editar(u, "Booking");
    await u.click(within(painel).getByRole("button", { name: "Remover canal" }));
    await u.click(within(painel).getByRole("button", { name: "Confirmar remoção" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent(mensagem);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("renomear canal em uso mostra CANAL_EM_USO junto do Salvar", async () => {
    const u = userEvent.setup();
    const mensagem = 'O canal "Booking" tem reservas e não pode ser removido nem renomeado.';
    instalarApiFalsa(leituras({ "PUT /api/tarifas/canais": { __status: 422, codigo: "CANAL_EM_USO", mensagem } }));
    renderizar(<TelaCanais />, { usuario: USUARIO });
    const painel = await editar(u, "Booking");
    await u.type(within(painel).getByLabelText("Nome"), " 2");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent(mensagem);
  });

  test("Balcão: nome travado, remoção desligada e explicada; edição de comissão segue possível", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/tarifas/canais": BALCAO }));
    renderizar(<TelaCanais />, { usuario: USUARIO });
    const painel = await editar(u, "Balcão");
    expect(within(painel).getByLabelText("Nome")).toBeDisabled();
    expect(within(painel).getByRole("button", { name: "Remover canal" })).toBeDisabled();
    expect(within(painel).getByText("O Balcão não pode ser removido.")).toBeInTheDocument();
    expect(within(painel).getByLabelText("Percentual sobre o Balcão (%)")).toBeDisabled();
    await u.type(within(painel).getByLabelText("Comissão (%)"), "3");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(feitas("PUT", "/api/tarifas/canais")).toHaveLength(1));
    expect(feitas("PUT", "/api/tarifas/canais")[0]!.corpo).toMatchObject({ id: "k1", nome: "Balcão", comissaoPercentual: 3 });
  });

  test("CANAL_BALCAO_FIXO vindo do servidor aparece junto da ação", async () => {
    const u = userEvent.setup();
    const mensagem = "O canal Balcão é a referência de preço e não pode ser renomeado.";
    instalarApiFalsa(leituras({ "PUT /api/tarifas/canais": { __status: 422, codigo: "CANAL_BALCAO_FIXO", mensagem } }));
    renderizar(<TelaCanais />, { usuario: USUARIO });
    const painel = await editar(u, "Balcão");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent(mensagem);
  });
});

describe("aba Canais: nome repetido", () => {
  test("novo canal com nome já existente (mesmo em outra caixa) não salva e explica", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/tarifas/canais": [{ id: "k1", nome: "Balcão", percentual: 0, exigeSinal: false, tipo: "direta", comissaoPercentual: 0 }] });
    renderizar(<TelaCanais />, { usuario: USUARIO });
    await screen.findByText("Balcão");
    await u.click(screen.getByRole("button", { name: "+ Novo" }));
    const painel = await screen.findByRole("dialog");
    await u.type(within(painel).getByLabelText("Nome"), "balcão");
    expect(within(painel).getByText("Já existe um canal com esse nome. Edite o existente.")).toBeInTheDocument();
    expect(within(painel).getByRole("button", { name: "Salvar" })).toBeDisabled();
  });
});

describe("aba Ocupação", () => {
  const FAIXAS = [{ acimaDe: 50, percentual: 10 }, { acimaDe: 80, percentual: 25 }];

  test("lista as faixas", async () => {
    instalarApiFalsa({ "GET /api/tarifas/faixas-ocupacao": FAIXAS });
    renderizar(<TelaOcupacao />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Ocupação" });
    expect(await within(lista).findByText("80%")).toBeInTheDocument();
    expect(within(lista).getByText("25%")).toBeInTheDocument();
  });

  test("nova faixa envia a lista COMPLETA, ordenada", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/tarifas/faixas-ocupacao": FAIXAS, "PUT /api/tarifas/faixas-ocupacao": FAIXAS });
    renderizar(<TelaOcupacao />, { usuario: USUARIO });
    await screen.findByText("80%");
    await u.click(screen.getByRole("button", { name: "+ Nova faixa" }));
    const painel = await screen.findByRole("dialog");
    await u.type(within(painel).getByLabelText("Acima de (% de ocupação)"), "65");
    await u.type(within(painel).getByLabelText("Ajuste (%)"), "-5");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(feitas("PUT", "/api/tarifas/faixas-ocupacao")).toHaveLength(1));
    expect(feitas("PUT", "/api/tarifas/faixas-ocupacao")[0]!.corpo).toEqual([
      { acimaDe: 50, percentual: 10 }, { acimaDe: 65, percentual: -5 }, { acimaDe: 80, percentual: 25 },
    ]);
  });

  test("editar uma faixa troca só ela e remover envia a lista sem ela", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/tarifas/faixas-ocupacao": FAIXAS, "PUT /api/tarifas/faixas-ocupacao": FAIXAS });
    renderizar(<TelaOcupacao />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Ocupação" });
    await u.click((await within(lista).findAllByRole("button", { name: "Editar" }))[1]!);
    let painel = await screen.findByRole("dialog");
    await u.clear(within(painel).getByLabelText("Ajuste (%)"));
    await u.type(within(painel).getByLabelText("Ajuste (%)"), "30");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(feitas("PUT", "/api/tarifas/faixas-ocupacao")).toHaveLength(1));
    expect(feitas("PUT", "/api/tarifas/faixas-ocupacao")[0]!.corpo).toEqual([{ acimaDe: 50, percentual: 10 }, { acimaDe: 80, percentual: 30 }]);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await u.click((await within(lista).findAllByRole("button", { name: "Editar" }))[0]!);
    painel = await screen.findByRole("dialog");
    await u.click(within(painel).getByRole("button", { name: "Remover faixa" }));
    await vi.waitFor(() => expect(feitas("PUT", "/api/tarifas/faixas-ocupacao")).toHaveLength(2));
    expect(feitas("PUT", "/api/tarifas/faixas-ocupacao")[1]!.corpo).toEqual([{ acimaDe: 80, percentual: 25 }]);
  });

  test("faixa repetida não salva e o erro do servidor aparece junto do botão", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/tarifas/faixas-ocupacao": FAIXAS, "PUT /api/tarifas/faixas-ocupacao": { __status: 422, codigo: "X", mensagem: "Faixas inválidas." } });
    renderizar(<TelaOcupacao />, { usuario: USUARIO });
    await screen.findByText("80%");
    await u.click(screen.getByRole("button", { name: "+ Nova faixa" }));
    const painel = await screen.findByRole("dialog");
    await u.type(within(painel).getByLabelText("Acima de (% de ocupação)"), "80");
    await u.type(within(painel).getByLabelText("Ajuste (%)"), "1");
    expect(within(painel).getByText("Já existe uma faixa que começa nessa ocupação.")).toBeInTheDocument();
    expect(within(painel).getByRole("button", { name: "Salvar" })).toBeDisabled();
    await u.clear(within(painel).getByLabelText("Acima de (% de ocupação)"));
    await u.type(within(painel).getByLabelText("Acima de (% de ocupação)"), "90");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Faixas inválidas.");
  });
});

describe("listas que substituem tudo ficam bloqueadas até a leitura dar certo", () => {
  test.each([
    ["Ocupação", TelaOcupacao, "/api/tarifas/faixas-ocupacao", "+ Nova faixa"],
    ["Crianças", TelaCriancas, "/api/tarifas/faixas-crianca", "+ Nova faixa"],
  ] as const)("%s: enquanto carrega o botão fica desligado; se falhar, mostra o erro e Tentar de novo libera", async (_nome, Tela, rota, novo) => {
    const u = userEvent.setup();
    let tentativas = 0;
    instalarApiFalsa({
      [`GET ${rota}`]: () => {
        tentativas++;
        return tentativas === 1 ? { __status: 500, codigo: "ERRO_INTERNO", mensagem: "Falha ao ler as faixas." } : [];
      },
      [`PUT ${rota}`]: [],
    });
    renderizar(<Tela />, { usuario: USUARIO });
    expect(screen.getByRole("button", { name: novo })).toBeDisabled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao ler as faixas.");
    expect(screen.getByRole("button", { name: novo })).toBeDisabled();
    expect(chamadas.filter((c) => c.metodo === "PUT")).toHaveLength(0);
    await u.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: novo })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeInTheDocument();
    expect(tentativas).toBe(2);
  });

  test("Ocupação diz 'acima de' (a faixa vale só acima do limite)", async () => {
    instalarApiFalsa({ "GET /api/tarifas/faixas-ocupacao": [{ acimaDe: 80, percentual: 25 }] });
    renderizar(<TelaOcupacao />, { usuario: USUARIO });
    expect(await screen.findByRole("columnheader", { name: "Acima de" })).toBeInTheDocument();
    expect(screen.getByText(/uma noite com exatamente 80% de ocupação não recebe o ajuste/)).toBeInTheDocument();
    expect(screen.queryByText(/a partir de/i)).not.toBeInTheDocument();
  });
});

describe("aba Crianças", () => {
  const FAIXAS = [
    { idadeMin: 0, idadeMax: 3, tipo: "gratis", valor: 0 },
    { idadeMin: 4, idadeMax: 11, tipo: "percentual_adicional", valor: 50 },
  ];
  const leituras = (extra: Record<string, unknown> = {}) => ({ "GET /api/tarifas/faixas-crianca": FAIXAS, "PUT /api/tarifas/faixas-crianca": FAIXAS, ...extra });

  test("lista idade e cobrança de cada faixa", async () => {
    instalarApiFalsa(leituras());
    renderizar(<TelaCriancas />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Crianças" });
    expect(await within(lista).findByText("4 a 11 anos")).toBeInTheDocument();
    expect(within(lista).getByText("50% do adulto extra")).toBeInTheDocument();
    expect(within(lista).getByText("Grátis")).toBeInTheDocument();
  });

  test("nova faixa de valor fixo envia a lista completa", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras());
    renderizar(<TelaCriancas />, { usuario: USUARIO });
    await screen.findByText("4 a 11 anos");
    await u.click(screen.getByRole("button", { name: "+ Nova faixa" }));
    const painel = await screen.findByRole("dialog");
    await u.type(within(painel).getByLabelText("Idade a partir de"), "12");
    await u.type(within(painel).getByLabelText("Até a idade"), "15");
    await u.selectOptions(within(painel).getByLabelText("Cobrança"), "fixo");
    await u.type(within(painel).getByLabelText("Valor por noite"), "60");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(feitas("PUT", "/api/tarifas/faixas-crianca")).toHaveLength(1));
    expect(feitas("PUT", "/api/tarifas/faixas-crianca")[0]!.corpo).toEqual([...FAIXAS, { idadeMin: 12, idadeMax: 15, tipo: "fixo", valor: 6000 }]);
  });

  test("faixa que cruza outra não salva; remover envia a lista sem ela", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras());
    renderizar(<TelaCriancas />, { usuario: USUARIO });
    await screen.findByText("4 a 11 anos");
    await u.click(screen.getByRole("button", { name: "+ Nova faixa" }));
    let painel = await screen.findByRole("dialog");
    await u.type(within(painel).getByLabelText("Idade a partir de"), "10");
    await u.type(within(painel).getByLabelText("Até a idade"), "14");
    expect(within(painel).getByText("Essa faixa cruza com outra já cadastrada.")).toBeInTheDocument();
    expect(within(painel).getByRole("button", { name: "Salvar" })).toBeDisabled();
    await u.click(within(painel).getByRole("button", { name: "Fechar" }));
    const lista = screen.getByRole("region", { name: "Crianças" });
    await u.click((await within(lista).findAllByRole("button", { name: "Editar" }))[1]!);
    painel = await screen.findByRole("dialog");
    await u.click(within(painel).getByRole("button", { name: "Remover faixa" }));
    await vi.waitFor(() => expect(feitas("PUT", "/api/tarifas/faixas-crianca")).toHaveLength(1));
    expect(feitas("PUT", "/api/tarifas/faixas-crianca")[0]!.corpo).toEqual([FAIXAS[0]]);
  });

  test("erro do servidor aparece junto do salvar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/tarifas/faixas-crianca": { __status: 422, codigo: "X", mensagem: "Faixas de idade inválidas." } }));
    renderizar(<TelaCriancas />, { usuario: USUARIO });
    const lista = await screen.findByRole("region", { name: "Crianças" });
    await u.click((await within(lista).findAllByRole("button", { name: "Editar" }))[0]!);
    const painel = await screen.findByRole("dialog");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Faixas de idade inválidas.");
  });
});
