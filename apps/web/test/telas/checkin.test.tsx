import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GavetaReserva } from "../../src/telas/reserva/GavetaReserva";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";
import { criarReserva } from "../fixtures/reserva";

function Local() {
  const l = useLocation();
  return <output data-testid="local">{l.pathname + l.search}</output>;
}

const q = (id: string, numero: string, categoriaId = "c1", situacao = "livre") => ({ id, numero, categoriaId, bloco: null, situacao });
const categorias = [
  { id: "c1", nome: "Standard", maxAdultos: 2, maxCriancas: 1, comodidades: [] },
  { id: "c2", nome: "Suíte", maxAdultos: 3, maxCriancas: 1, comodidades: [] },
];
const completo = (o: object = {}) => ({
  id: "h2", nome: "João Souza", documentoTipo: "cpf", documento: "52998224725", nascimento: "1990-05-05", nacionalidade: "BR",
  telefone: "11988887777", endereco: { logradouro: "Rua B", cidade: "Olinda", uf: "PE", pais: "BR" }, ...o,
});

const reservaBase = () => criarReserva({ estado: "confirmada", quartoId: "q101", quartoNumero: "101", chegada: "2026-11-20", saida: "2026-11-23" });

function montar(extras: Record<string, unknown> = {}, rota = "/mapa?reserva=r1&fluxo=checkin") {
  instalarApiFalsa({
    "GET /api/painel": criarPainel(),
    "GET /api/reservas/r1": reservaBase(),
    "GET /api/reservas/r1/quartos-sugeridos": [q("q102", "102"), q("q101", "101")],
    "GET /api/categorias": categorias,
    ...extras,
  });
  return renderizar(<><GavetaReserva /><Local /></>, { rota });
}

afterEach(() => vi.unstubAllGlobals());

const postou = (caminho: string) => chamadas.filter((c) => c.metodo === "POST" && c.caminho === caminho);

async function adicionarJoao(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.type(await screen.findByLabelText("Buscar acompanhante (nome ou CPF)"), "Joao");
  await usuario.click(await screen.findByRole("button", { name: "Adicionar João Souza" }));
}

describe("fluxo de check-in", () => {
  test("sugere quartos limpos com o atribuído primeiro", async () => {
    montar();
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.closest("label")!.textContent)).toEqual(["Qto 101 · Standard (atribuído)", "Qto 102 · Standard"]);
    expect(radios[0]).toBeChecked();
    expect(screen.getByRole("heading", { name: "Quarto" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hóspedes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confirmar" })).toBeInTheDocument();
    expect(screen.getByLabelText("Cobrar early check-in, se aplicável")).toBeChecked();
  });

  test("upgrade lista quartos livres de outras categorias com aviso de preço mantido", async () => {
    const usuario = userEvent.setup();
    montar({
      "GET /api/quartos": [q("q101", "101"), q("q201", "201", "c2"), q("q202", "202", "c2", "sujo")],
      "POST /api/reservas/r1/checkin": reservaBase(),
    });
    await usuario.click(await screen.findByLabelText("Outra categoria (upgrade)"));
    const upgrade = await screen.findByRole("radio", { name: "Qto 201 · Suíte (upgrade — preço mantido)" });
    expect(screen.queryByRole("radio", { name: /Qto 202/ })).not.toBeInTheDocument();
    await usuario.click(upgrade);
    await usuario.click(screen.getByRole("button", { name: "Concluir check-in" }));
    await waitFor(() => expect(postou("/api/reservas/r1/checkin")).toHaveLength(1));
    expect(postou("/api/reservas/r1/checkin")[0]!.corpo).toEqual({ quartoId: "q201", acompanhantes: [], cobrarEarlyCheckin: true });
  });

  test("busca acompanhante com debounce e mostra pendências calculadas", async () => {
    const usuario = userEvent.setup();
    montar({ "GET /api/hospedes": [completo({ documento: null, nascimento: null })] });
    await adicionarJoao(usuario);
    const buscas = chamadas.filter((c) => c.caminho.startsWith("/api/hospedes?q="));
    expect(buscas.map((b) => b.caminho)).toEqual(["/api/hospedes?q=Joao"]);
    expect(screen.getByText("Faltam: documento, data de nascimento")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Remover João Souza" }));
    expect(screen.queryByRole("button", { name: "Remover João Souza" })).not.toBeInTheDocument();
  });

  test("FNRH_INCOMPLETA destaca o hóspede e os campos faltantes", async () => {
    const usuario = userEvent.setup();
    montar({
      "GET /api/hospedes": [completo()],
      "POST /api/reservas/r1/checkin": {
        __status: 422, codigo: "FNRH_INCOMPLETA", mensagem: "A ficha do hóspede (FNRH) está incompleta. Complete o cadastro antes do check-in.",
        detalhes: { h2: ["documento", "endereco.cidade", "contato"] },
      },
    });
    await adicionarJoao(usuario);
    await usuario.click(screen.getByRole("button", { name: "Concluir check-in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A ficha do hóspede (FNRH) está incompleta.");
    const linha = screen.getByText("João Souza").closest("li")!;
    expect(linha).toHaveClass("checkin-pessoa--pendente");
    expect(within(linha).getByText("Faltam: documento, cidade, telefone ou e-mail")).toBeInTheDocument();
    expect(within(linha).getByRole("button", { name: "Completar João Souza" })).toBeInTheDocument();
    expect(screen.getByTestId("local")).toHaveTextContent("fluxo=checkin");
  });

  test("Completar abre o cadastro preenchido e salva pelo id", async () => {
    const usuario = userEvent.setup();
    const incompleto = completo({ documento: null });
    montar({
      "GET /api/hospedes": [incompleto],
      "POST /api/hospedes": (corpo: object) => ({ ...incompleto, ...corpo }),
    });
    await adicionarJoao(usuario);
    const linha = screen.getByText("João Souza").closest("li")!;
    expect(within(linha).getByText("Faltam: documento")).toBeInTheDocument();
    await usuario.click(within(linha).getByRole("button", { name: "Completar João Souza" }));
    const janela = await screen.findByRole("dialog", { name: "Completar cadastro" });
    expect(within(janela).getByLabelText("Nome")).toHaveValue("João Souza");
    expect(within(janela).getByLabelText("Cidade")).toHaveValue("Olinda");
    await usuario.type(within(janela).getByLabelText("Documento"), "52998224725");
    await usuario.click(within(janela).getByRole("button", { name: "Salvar hóspede" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /cadastr/i })).not.toBeInTheDocument());
    const corpo = postou("/api/hospedes")[0]!.corpo as { endereco: object };
    expect(corpo).toMatchObject({ id: "h2", nome: "João Souza", documentoTipo: "cpf", documento: "52998224725", nascimento: "1990-05-05", nacionalidade: "BR" });
    expect(corpo.endereco).toMatchObject({ cidade: "Olinda", uf: "PE" });
    expect(within(screen.getByText("João Souza").closest("li")!).queryByText(/Faltam/)).not.toBeInTheDocument();
  });

  test("cadastro rápido mostra CPF inválido no campo", async () => {
    const usuario = userEvent.setup();
    montar({
      "POST /api/hospedes": { __status: 422, codigo: "CPF_INVALIDO", mensagem: "CPF inválido. Confira os números digitados." },
    });
    await usuario.click(await screen.findByRole("button", { name: "Cadastrar novo" }));
    const janela = await screen.findByRole("dialog", { name: "Cadastrar hóspede" });
    await usuario.type(within(janela).getByLabelText("Nome"), "Ana Lima");
    await usuario.type(within(janela).getByLabelText("Documento"), "11111111111");
    await usuario.click(within(janela).getByRole("button", { name: "Salvar hóspede" }));
    const campo = within(janela).getByLabelText("Documento");
    await waitFor(() => expect(campo).toHaveAccessibleDescription("CPF inválido. Confira os números digitados."));
    expect(campo).toBeInvalid();
    expect(screen.getByRole("dialog", { name: "Cadastrar hóspede" })).toBeInTheDocument();
  });

  test("cadastro rápido mostra erros por campo de DADOS_INVALIDOS", async () => {
    const usuario = userEvent.setup();
    montar({
      "POST /api/hospedes": {
        __status: 400, codigo: "DADOS_INVALIDOS", mensagem: "Há dados inválidos. Corrija os campos indicados.",
        campos: [{ campo: "nome", mensagem: "Campo obrigatório" }, { campo: "nascimento", mensagem: "Data inválida" }],
      },
    });
    await usuario.click(await screen.findByRole("button", { name: "Cadastrar novo" }));
    const janela = await screen.findByRole("dialog", { name: "Cadastrar hóspede" });
    await usuario.click(within(janela).getByRole("button", { name: "Salvar hóspede" }));
    await waitFor(() => expect(within(janela).getByLabelText("Nome")).toHaveAccessibleDescription("Campo obrigatório"));
    expect(within(janela).getByLabelText("Data de nascimento")).toHaveAccessibleDescription("Data inválida");
  });

  test("hóspede cadastrado entra como acompanhante", async () => {
    const usuario = userEvent.setup();
    montar({ "POST /api/hospedes": completo({ id: "h9", nome: "Ana Lima" }) });
    await usuario.click(await screen.findByRole("button", { name: "Cadastrar novo" }));
    const janela = await screen.findByRole("dialog", { name: "Cadastrar hóspede" });
    await usuario.type(within(janela).getByLabelText("Nome"), "Ana Lima");
    await usuario.click(within(janela).getByRole("button", { name: "Salvar hóspede" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /cadastr/i })).not.toBeInTheDocument());
    expect(screen.getByText("Ana Lima")).toBeInTheDocument();
  });

  test("concluir envia quarto, acompanhantes e escolha de early check-in e volta ao resumo", async () => {
    const usuario = userEvent.setup();
    montar({
      "GET /api/hospedes": [completo()],
      "POST /api/reservas/r1/checkin": reservaBase(),
    });
    await adicionarJoao(usuario);
    await usuario.click(screen.getByLabelText("Cobrar early check-in, se aplicável"));
    await usuario.click(screen.getByRole("button", { name: "Concluir check-in" }));
    expect(await screen.findByText("Check-in concluído · Qto 101")).toBeInTheDocument();
    expect(postou("/api/reservas/r1/checkin")[0]!.corpo).toEqual({ quartoId: "q101", acompanhantes: ["h2"], cobrarEarlyCheckin: false });
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent("/mapa?reserva=r1&aba=resumo"), { timeout: 3000 });
    expect(screen.getByTestId("local")).not.toHaveTextContent("fluxo");
  });

  test("erro do servidor aparece junto da ação e mantém o fluxo", async () => {
    const usuario = userEvent.setup();
    montar({
      "POST /api/reservas/r1/checkin": { __status: 422, codigo: "QUARTO_INDISPONIVEL", mensagem: "O quarto 101 não está livre (sujo). Escolha outro quarto." },
    });
    await usuario.click(await screen.findByRole("button", { name: "Concluir check-in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("O quarto 101 não está livre (sujo). Escolha outro quarto.");
    expect(screen.getByTestId("local")).toHaveTextContent("fluxo=checkin");
  });

  test("Cancelar remove o fluxo da URL", async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(screen.getByTestId("local")).toHaveTextContent("/mapa?reserva=r1");
    expect(screen.getByTestId("local")).not.toHaveTextContent("fluxo");
  });
});
