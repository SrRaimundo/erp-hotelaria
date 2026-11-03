import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useLocation } from "react-router";
import { AppRotas } from "../../src/rotas";
import { TelaPacotes } from "../../src/telas/tarifas/TelaPacotes";
import { TelaRestricoes } from "../../src/telas/tarifas/TelaRestricoes";
import { TelaSimulador } from "../../src/telas/tarifas/TelaSimulador";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { criarPainel } from "../fixtures/painel";
import { renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const Sonda = () => <output data-testid="local">{useLocation().pathname}</output>;
const ADMIN = { permissoes: ["reservas.gerenciar", "tarifas.gerenciar"] };
const RECEPCAO = { permissoes: ["reservas.gerenciar"] };
const STD = { id: "c1", nome: "Standard", maxAdultos: 2, maxCriancas: 1, comodidades: [], ativo: true };
const LUXO = { id: "c2", nome: "Luxo", maxAdultos: 3, maxCriancas: 2, comodidades: [], ativo: true };
const CANAIS = [
  { id: "k1", nome: "Balcão", percentual: 0, exigeSinal: false, tipo: "direta", comissaoPercentual: 0 },
  { id: "k2", nome: "Booking", percentual: 15, exigeSinal: true, tipo: "ota", comissaoPercentual: 12 },
];
const feitas = (metodo: string, caminho: string) => chamadas.filter((c) => c.metodo === metodo && c.caminho === caminho);

describe("aba Pacotes", () => {
  const VERAO = { id: "p1", nome: "Verão", categoriaId: "c1", inicio: "2027-01-02", fim: "2027-01-09", minNoites: 5, valorNoite: { 1: 20000, 2: 28000, 3: 33000 }, ativo: true };
  const VELHO = { ...VERAO, id: "p2", nome: "Antigo", ativo: false };
  const leituras = (extra: Record<string, unknown> = {}) => ({ "GET /api/tarifas/pacotes": [VERAO, VELHO], "GET /api/categorias": [STD, LUXO], ...extra });

  test("lista os ativos e mostra os desativados sob demanda", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras());
    renderizar(<TelaPacotes />, { usuario: ADMIN });
    const lista = await screen.findByRole("region", { name: "Pacotes" });
    expect(await within(lista).findByText("Verão")).toBeInTheDocument();
    expect(within(lista).getByText("5 noites")).toBeInTheDocument();
    expect(within(lista).getByText("R$ 280,00")).toBeInTheDocument();
    expect(within(lista).queryByText("Antigo")).not.toBeInTheDocument();
    await u.click(within(lista).getByLabelText("Mostrar desativados"));
    expect(within(lista).getByText("Antigo")).toBeInTheDocument();
  });

  test("novo pacote envia o corpo completo", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/tarifas/pacotes": VERAO }));
    renderizar(<TelaPacotes />, { usuario: ADMIN });
    await screen.findByText("Verão");
    await u.click(screen.getByRole("button", { name: "+ Novo" }));
    const painel = await screen.findByRole("dialog");
    expect(within(painel).getByRole("button", { name: "Salvar" })).toBeDisabled();
    await u.type(within(painel).getByLabelText("Nome"), "Páscoa");
    await vi.waitFor(() => expect(within(painel).getByLabelText("Categoria")).toHaveValue("c1"));
    await u.selectOptions(within(painel).getByLabelText("Categoria"), "c2");
    await u.type(within(painel).getByLabelText("Início"), "2027-03-26");
    await u.type(within(painel).getByLabelText("Fim"), "2027-03-29");
    await u.clear(within(painel).getByLabelText("Mínimo de noites"));
    await u.type(within(painel).getByLabelText("Mínimo de noites"), "3");
    await u.type(within(painel).getByLabelText("Preço da noite para 1 adulto"), "300");
    await u.type(within(painel).getByLabelText("Preço da noite para 2 adultos"), "400");
    await u.type(within(painel).getByLabelText("Preço da noite para 3 adultos"), "500");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(feitas("PUT", "/api/tarifas/pacotes")).toHaveLength(1));
    expect(feitas("PUT", "/api/tarifas/pacotes")[0]!.corpo).toEqual({
      nome: "Páscoa", categoriaId: "c2", inicio: "2027-03-26", fim: "2027-03-29", minNoites: 3,
      valorNoite: { 1: 30000, 2: 40000, 3: 50000 }, ativo: true,
    });
  });

  test("desativar um pacote envia ativo falso com o id", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/tarifas/pacotes": VERAO }));
    renderizar(<TelaPacotes />, { usuario: ADMIN });
    await u.click(await screen.findByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog");
    await u.click(within(painel).getByLabelText("Pacote ativo"));
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(feitas("PUT", "/api/tarifas/pacotes")).toHaveLength(1));
    expect(feitas("PUT", "/api/tarifas/pacotes")[0]!.corpo).toMatchObject({ id: "p1", ativo: false, valorNoite: { 1: 20000, 2: 28000, 3: 33000 } });
  });

  test("erro do servidor aparece junto do salvar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/tarifas/pacotes": { __status: 422, codigo: "X", mensagem: "Pacote inválido." } }));
    renderizar(<TelaPacotes />, { usuario: ADMIN });
    await u.click(await screen.findByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Pacote inválido.");
  });
});

describe("aba Restrições", () => {
  const R1 = { categoriaId: "c1", data: "2027-02-06", minNoites: 3, fechadoChegada: false, fechadoSaida: false, fechadoVenda: false };
  const leituras = (extra: Record<string, unknown> = {}) => ({
    "GET /api/categorias": [STD, LUXO],
    "GET /api/tarifas/restricoes": (_: unknown, url: URL) => (url.searchParams.get("categoriaId") === "c1" ? [R1] : []),
    ...extra,
  });

  test("lista as restrições da categoria e troca ao mudar a categoria", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras());
    renderizar(<TelaRestricoes />, { usuario: ADMIN });
    expect(await screen.findByText("mínimo 3 noites")).toBeInTheDocument();
    expect(chamadas.find((c) => c.caminho.startsWith("/api/tarifas/restricoes"))!.caminho).toBe("/api/tarifas/restricoes?categoriaId=c1");
    await u.selectOptions(screen.getByLabelText("Categoria"), "c2");
    await vi.waitFor(() => expect(screen.queryByText("mínimo 3 noites")).not.toBeInTheDocument());
    expect(screen.getByText("Nada cadastrado ainda.")).toBeInTheDocument();
  });

  test("nova restrição envia categoria, data e marcas", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/tarifas/restricoes": R1 }));
    renderizar(<TelaRestricoes />, { usuario: ADMIN });
    await screen.findByText("mínimo 3 noites");
    await u.click(screen.getByRole("button", { name: "+ Nova restrição" }));
    const painel = await screen.findByRole("dialog");
    await u.type(within(painel).getByLabelText("Data"), "2027-02-08");
    await u.click(within(painel).getByLabelText("Fechado para chegada"));
    await u.click(within(painel).getByLabelText("Fechado para venda"));
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(feitas("PUT", "/api/tarifas/restricoes")).toHaveLength(1));
    expect(feitas("PUT", "/api/tarifas/restricoes")[0]!.corpo).toEqual({
      categoriaId: "c1", data: "2027-02-08", minNoites: null, fechadoChegada: true, fechadoSaida: false, fechadoVenda: true,
    });
  });

  test("editar mantém a data e erro do servidor aparece junto do salvar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "PUT /api/tarifas/restricoes": { __status: 422, codigo: "X", mensagem: "Restrição inválida." } }));
    renderizar(<TelaRestricoes />, { usuario: ADMIN });
    await u.click(await screen.findByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog");
    expect(within(painel).getByLabelText("Data")).toBeDisabled();
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Restrição inválida.");
  });
});

describe("aba Simulador", () => {
  const COTACAO = {
    total: 56000, violacoes: [],
    noites: [
      { data: "2027-02-05", valor: 28000, passos: [{ rotulo: "Base", valor: 25000 }, { rotulo: "Alta +12%", valor: 28000 }] },
      { data: "2027-02-06", valor: 28000, passos: [{ rotulo: "Base", valor: 25000 }, { rotulo: "Alta +12%", valor: 28000 }] },
    ],
  };
  const leituras = (extra: Record<string, unknown> = {}) => ({ "GET /api/categorias": [STD, LUXO], "GET /api/tarifas/canais": CANAIS, ...extra });
  const preencher = async (u: ReturnType<typeof userEvent.setup>) => {
    await waitFor(() => expect(screen.getByLabelText("Canal")).toHaveValue("Balcão"));
    await u.type(screen.getByLabelText("Chegada"), "2027-02-05");
    await u.type(screen.getByLabelText("Saída"), "2027-02-07");
  };

  test("calcula e mostra o total e as camadas de cada noite", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "POST /api/tarifas/simular": COTACAO }));
    renderizar(<TelaSimulador />, { usuario: RECEPCAO });
    await preencher(u);
    await u.selectOptions(screen.getByLabelText("Canal"), "Booking");
    await u.click(screen.getByRole("button", { name: "+ criança" }));
    await u.type(screen.getByLabelText("Nascimento da criança 1"), "2020-01-01");
    await u.click(screen.getByRole("button", { name: "Simular" }));
    const resultado = await screen.findByRole("region", { name: "Resultado da simulação" });
    expect(within(resultado).getByText("Total: R$ 560,00")).toBeInTheDocument();
    expect(within(resultado).getAllByText("Alta +12%")).toHaveLength(2);
    expect(within(resultado).getAllByText("Base")).toHaveLength(2);
    expect(feitas("POST", "/api/tarifas/simular")[0]!.corpo).toEqual({
      categoriaId: "c1", chegada: "2027-02-05", saida: "2027-02-07", hospedes: { adultos: 2, criancasNascimento: ["2020-01-01"] }, canal: "Booking",
    });
  });

  test("restrições devolvidas pela rota aparecem como aviso", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "POST /api/tarifas/simular": { ...COTACAO, violacoes: [{ codigo: "MIN_NOITES", data: "2027-02-05", mensagem: "Para chegar em 05/02/2027 a estadia mínima é de 3 noites." }] } }));
    renderizar(<TelaSimulador />, { usuario: RECEPCAO });
    await preencher(u);
    await u.click(screen.getByRole("button", { name: "Simular" }));
    expect(await screen.findByText("Para chegar em 05/02/2027 a estadia mínima é de 3 noites.")).toBeInTheDocument();
  });

  test("sem datas o botão fica desligado e explica; erro do servidor aparece junto do botão", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leituras({ "POST /api/tarifas/simular": { __status: 422, codigo: "TABELA_BASE_AUSENTE", mensagem: "Esta categoria não tem tabela de preços. Cadastre a tabela base em Tarifas." } }));
    renderizar(<TelaSimulador />, { usuario: RECEPCAO });
    await waitFor(() => expect(screen.getByLabelText("Canal")).toHaveValue("Balcão"));
    expect(screen.getByRole("button", { name: "Simular" })).toBeDisabled();
    expect(screen.getByText("Informe a chegada e a saída.")).toBeInTheDocument();
    await preencher(u);
    await u.click(screen.getByRole("button", { name: "Simular" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Esta categoria não tem tabela de preços.");
    expect(screen.queryByRole("region", { name: "Resultado da simulação" })).not.toBeInTheDocument();
  });
});

describe("rotas e permissões das abas", () => {
  const rotas = { "GET /api/painel": criarPainel(), "GET /api/categorias": [STD], "GET /api/tarifas/canais": CANAIS, "GET /api/tarifas/dias-semana": [] };

  test("/reservas/tarifas leva à primeira aba e não é capturada pela tela de reservas", async () => {
    instalarApiFalsa({ ...rotas, "GET /api/tarifas/tabelas-base": [] });
    renderizar(<><AppRotas /><Sonda /></>, { rota: "/reservas/tarifas", usuario: ADMIN });
    expect(await screen.findByRole("region", { name: "Tabela base" })).toBeInTheDocument();
    expect(screen.getByTestId("local")).toHaveTextContent("/reservas/tarifas/tabela-base");
    expect(screen.getByRole("heading", { level: 1, name: "Tarifas" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Reservas" })).not.toBeInTheDocument();
  });

  test("a barra navega entre abas", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ ...rotas, "GET /api/tarifas/tabelas-base": [] });
    renderizar(<><AppRotas /><Sonda /></>, { rota: "/reservas/tarifas/tabela-base", usuario: ADMIN });
    await screen.findByRole("region", { name: "Tabela base" });
    await u.click(within(screen.getByRole("navigation", { name: "Abas de tarifas" })).getByRole("link", { name: "Dias da semana" }));
    expect(await screen.findByRole("region", { name: "Dias da semana" })).toBeInTheDocument();
    expect(screen.getByTestId("local")).toHaveTextContent("/reservas/tarifas/dias-semana");
  });

  test("quem só tem reservas.gerenciar abre o Simulador, vê só essa aba e não abre as outras", async () => {
    instalarApiFalsa({ ...rotas });
    renderizar(<><AppRotas /><Sonda /></>, { rota: "/reservas/tarifas/simulador", usuario: RECEPCAO });
    expect(await screen.findByRole("region", { name: "Simulador" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Abas de tarifas" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["Simulador"]);
  });

  test("/reservas/tarifas/canais sem tarifas.gerenciar volta à tela inicial do perfil", async () => {
    instalarApiFalsa({ ...rotas });
    renderizar(<><AppRotas /><Sonda /></>, { rota: "/reservas/tarifas/canais", usuario: RECEPCAO });
    await vi.waitFor(() => expect(screen.getByTestId("local")).not.toHaveTextContent("/reservas/tarifas"));
    expect(screen.queryByRole("region", { name: "Canais" })).not.toBeInTheDocument();
  });

  test("/reservas/tarifas sem tarifas.gerenciar cai no Simulador", async () => {
    instalarApiFalsa({ ...rotas });
    renderizar(<><AppRotas /><Sonda /></>, { rota: "/reservas/tarifas", usuario: RECEPCAO });
    expect(await screen.findByRole("region", { name: "Simulador" })).toBeInTheDocument();
    expect(screen.getByTestId("local")).toHaveTextContent("/reservas/tarifas/simulador");
  });
});

describe("correções da revisão", () => {
  test("restrição nova numa data que já tem regra não salva", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/categorias": [STD],
      "GET /api/tarifas/restricoes": [{ categoriaId: "c1", data: "2027-02-06", minNoites: 3, fechadoChegada: false, fechadoSaida: false, fechadoVenda: false }],
    });
    renderizar(<TelaRestricoes />, { usuario: ADMIN });
    await screen.findByText("mínimo 3 noites");
    await u.click(screen.getByRole("button", { name: "+ Nova restrição" }));
    const painel = await screen.findByRole("dialog");
    await u.type(within(painel).getByLabelText("Data"), "2027-02-06");
    expect(within(painel).getByText("Essa data já tem restrição. Edite a existente.")).toBeInTheDocument();
    expect(within(painel).getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  test("simulador: mexer num campo apaga o resultado antigo", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/categorias": [STD], "GET /api/tarifas/canais": CANAIS,
      "POST /api/tarifas/simular": { total: 28000, violacoes: [], noites: [{ data: "2027-02-05", valor: 28000, passos: [{ rotulo: "Base", valor: 28000 }] }] },
    });
    renderizar(<TelaSimulador />, { usuario: RECEPCAO });
    await waitFor(() => expect(screen.getByLabelText("Canal")).toHaveValue("Balcão"));
    await u.type(screen.getByLabelText("Chegada"), "2027-02-05");
    await u.type(screen.getByLabelText("Saída"), "2027-02-06");
    await u.click(screen.getByRole("button", { name: "Simular" }));
    expect(await screen.findByText("Total: R$ 280,00")).toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText("Canal"), "Booking");
    expect(screen.queryByText("Total: R$ 280,00")).not.toBeInTheDocument();
  });

  test("sem nenhuma das duas permissões, a página de Tarifas avisa em vez de ficar em branco", async () => {
    instalarApiFalsa({ "GET /api/painel": criarPainel() });
    renderizar(<AppRotas />, { rota: "/reservas/tarifas", usuario: { permissoes: ["caixa.operar"] } });
    expect(await screen.findByText("Você não tem permissão para abrir esta tela.")).toBeInTheDocument();
  });
});
