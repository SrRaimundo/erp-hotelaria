import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TelaNovaReserva } from "../../src/telas/nova-reserva/TelaNovaReserva";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";

function Local() {
  const l = useLocation();
  return <output data-testid="local">{l.pathname + l.search}</output>;
}

const maria = { id: "h1", nome: "Maria Souza", documentoTipo: "cpf", documento: "52998224725", nascimento: "1990-02-01", nacionalidade: "BR" };
const categorias = [
  { id: "c1", nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] },
  { id: "c2", nome: "Luxo", maxAdultos: 3, maxCriancas: 1, comodidades: [] },
];
const quartos = [
  { id: "q101", numero: "101", categoriaId: "c1", bloco: null, situacao: "livre" },
  { id: "q201", numero: "201", categoriaId: "c2", bloco: null, situacao: "livre" },
];
const canais = [
  { id: "k1", nome: "Balcão", percentual: 0, exigeSinal: true },
  { id: "k2", nome: "Booking", percentual: 10, exigeSinal: false },
];
const config = { sinal: { exigir: true, tipo: "percentual", percentual: 30, prazoHoras: 48, toleranciaHoras: 12 } };
const cotacao = (violacoes: unknown[] = []) => ({
  noites: [
    { data: "2026-12-30", valor: 30000, passos: [{ rotulo: "Tabela base (2 adultos)", valor: 30000 }] },
    { data: "2026-12-31", valor: 30000, passos: [] },
    { data: "2027-01-01", valor: 30000, passos: [] },
  ],
  total: 90000,
  violacoes,
});
const reservaCriada = (id: string, codigo: number) => ({ id, codigo, estado: "aguardando_sinal", valorSinal: 27000, prazoSinal: "2026-12-02T10:00:00.000Z" });

function montar(rota: string, extras: Record<string, unknown> = {}, usuario = {}) {
  instalarApiFalsa({
    "GET /api/painel": criarPainel({ dia: "2026-12-30" }),
    "GET /api/categorias": categorias,
    "GET /api/quartos": quartos,
    "GET /api/tarifas/canais": canais,
    "GET /api/config": config,
    "POST /api/tarifas/simular": cotacao(),
    "GET /api/hospedes": [maria],
    ...extras,
  });
  return renderizar(
    <>
      <TelaNovaReserva />
      <Local />
    </>,
    { rota, usuario },
  );
}

afterEach(() => vi.unstubAllGlobals());

async function escolherTitular(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.type(screen.getByLabelText("Buscar hóspede"), "Maria");
  await usuario.click(await screen.findByRole("button", { name: /Maria Souza/ }));
  await screen.findByText(/Titular: Maria Souza/);
}

describe("nova reserva", () => {
  test("vem do mapa com quarto e chegada preenchidos", async () => {
    montar("/reservas/nova?quarto=q201&chegada=2026-12-30");
    await waitFor(() => expect(screen.getByLabelText("Categoria")).toHaveValue("c2"));
    await waitFor(() => expect(screen.getByLabelText("Quarto")).toHaveValue("q201"));
    expect(screen.getByLabelText("Chegada")).toHaveValue("2026-12-30");
    expect(screen.getByLabelText("Saída")).toHaveValue("2026-12-31");
    expect(screen.getByLabelText("Canal")).toHaveValue("Balcão");
  });

  test("pré-seleciona o hóspede de ?hospede=", async () => {
    montar("/reservas/nova?hospede=h1", { "GET /api/hospedes/h1": maria });
    expect(await screen.findByText(/Titular: Maria Souza/)).toBeInTheDocument();
  });

  test("mostra cotação com sinal e restrições", async () => {
    const aviso = { codigo: "MIN_NOITES", data: "2026-12-30", mensagem: "Para chegar em 30/12 a estadia mínima é de 3 noites." };
    montar("/reservas/nova?quarto=q201&chegada=2026-12-30", { "POST /api/tarifas/simular": cotacao([aviso]) });
    expect(await screen.findByText(/Sinal de R\$ 270,00 até \d{2}\/\d{2} \d{2}:\d{2}/, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/estadia mínima é de 3 noites/)).toBeInTheDocument();
    expect(screen.getByText("R$ 900,00")).toBeInTheDocument();
    const pedido = chamadas.find((c) => c.caminho === "/api/tarifas/simular")!.corpo;
    expect(pedido).toEqual({ categoriaId: "c2", chegada: "2026-12-30", saida: "2026-12-31", hospedes: { adultos: 2, criancasNascimento: [] }, canal: "Balcão" });
  });

  test("desconto aparece na cotação e canal sem sinal omite o sinal", async () => {
    const usuario = userEvent.setup();
    montar("/reservas/nova?quarto=q201&chegada=2026-12-30");
    await screen.findByText(/Sinal de R\$ 270,00/, undefined, { timeout: 3000 });
    await usuario.type(screen.getByLabelText("Desconto (%)"), "10");
    expect(await screen.findByText("Desconto −10%", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("R$ 810,00")).toBeInTheDocument();
    expect(screen.getByText(/Sinal de R\$ 243,00/)).toBeInTheDocument();
    await usuario.selectOptions(screen.getByLabelText("Canal"), "Booking");
    await waitFor(() => expect(screen.queryByText(/Sinal de/)).not.toBeInTheDocument(), { timeout: 3000 });
  });

  test("desconto acima do limite pede supervisor e reenvia", async () => {
    const usuario = userEvent.setup();
    let n = 0;
    montar("/reservas/nova?quarto=q201&chegada=2026-12-30", {
      "POST /api/reservas": () => {
        n += 1;
        return n === 1
          ? { __status: 422, codigo: "SUPERVISOR_NECESSARIO", mensagem: "Esta ação precisa da autorização de um supervisor." }
          : reservaCriada("r9", 9);
      },
    });
    await escolherTitular(usuario);
    await usuario.type(screen.getByLabelText("Desconto (%)"), "20");
    await usuario.click(screen.getByRole("button", { name: "Reservar" }));
    const janela = await screen.findByRole("dialog", { name: /supervisor/i });
    await usuario.type(within(janela).getByLabelText("Motivo"), "cliente antigo");
    await usuario.type(within(janela).getByLabelText("Login do supervisor"), "admin");
    await usuario.type(within(janela).getByLabelText("Senha do supervisor"), "segredo");
    await usuario.click(within(janela).getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent("/mapa?reserva=r9"));
    const posts = chamadas.filter((c) => c.metodo === "POST" && c.caminho === "/api/reservas");
    expect(posts).toHaveLength(2);
    expect(posts[0]!.corpo).not.toHaveProperty("autorizacao");
    expect(posts[1]!.corpo).toMatchObject({
      titularId: "h1", categoriaId: "c2", quartoId: "q201", chegada: "2026-12-30", saida: "2026-12-31", adultos: 2, canal: "Balcão", descontoPercentual: 20,
      autorizacao: { motivo: "cliente antigo", supervisor: { login: "admin", senha: "segredo" } },
    });
  });

  test("datas inválidas (saída antes da chegada) bloqueiam o envio", async () => {
    const usuario = userEvent.setup();
    montar("/reservas/nova?chegada=2026-12-30", { "POST /api/tarifas/simular": cotacao() });
    await escolherTitular(usuario);
    const saida = screen.getByLabelText("Saída");
    await usuario.clear(saida);
    await usuario.type(saida, "2026-12-29");
    expect(await screen.findByText("A saída deve ser depois da chegada.")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Reservar" }));
    expect(chamadas.some((c) => c.caminho === "/api/reservas")).toBe(false);
    expect(screen.getByTestId("local")).toHaveTextContent("/reservas/nova");
  });

  test("exige titular e nascimento válido da criança", async () => {
    const usuario = userEvent.setup();
    montar("/reservas/nova?chegada=2026-12-30");
    await usuario.click(screen.getByRole("button", { name: "+ criança" }));
    await usuario.click(screen.getByRole("button", { name: "Reservar" }));
    expect(screen.getByText("Escolha o hóspede titular.")).toBeInTheDocument();
    expect(screen.getByText("Informe a data de nascimento da criança 1.")).toBeInTheDocument();
    expect(chamadas.some((c) => c.caminho === "/api/reservas")).toBe(false);
  });

  test("mostra o erro da API junto da ação", async () => {
    const usuario = userEvent.setup();
    montar("/reservas/nova?quarto=q201&chegada=2026-12-30", {
      "POST /api/reservas": { __status: 422, codigo: "QUARTO_INDISPONIVEL", mensagem: "O quarto 201 está ocupado nessas datas." },
    });
    await escolherTitular(usuario);
    await usuario.click(screen.getByRole("button", { name: "Reservar" }));
    expect(await screen.findByText("O quarto 201 está ocupado nessas datas.")).toBeInTheDocument();
    expect(screen.getByText("Não foi possível reservar.")).toBeInTheDocument();
  });

  async function prepararGrupo(usuario: ReturnType<typeof userEvent.setup>) {
    await escolherTitular(usuario);
    await usuario.click(screen.getByLabelText("Reserva de grupo"));
    await usuario.selectOptions(screen.getByLabelText("Cobrança"), "separada");
    await usuario.click(screen.getByRole("button", { name: "+ quarto" }));
    await usuario.selectOptions(screen.getByLabelText("Categoria da linha 2"), "Luxo");
    await usuario.selectOptions(screen.getByLabelText("Quarto da linha 2"), "201");
  }

  test("grupo cria um grupo e uma reserva por quarto", async () => {
    const usuario = userEvent.setup();
    let n = 0;
    montar("/reservas/nova?chegada=2026-12-30", {
      "POST /api/grupos": { id: "g1", titularId: "h1", cobranca: "separada" },
      "POST /api/reservas": () => reservaCriada(`r${++n}`, 100 + n),
    });
    await prepararGrupo(usuario);
    await usuario.click(screen.getByRole("button", { name: "Reservar grupo" }));
    expect(await screen.findByText("Grupo criado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#101" })).toHaveAttribute("href", "/mapa?reserva=r1");
    expect(screen.getByRole("link", { name: "#102" })).toHaveAttribute("href", "/mapa?reserva=r2");
    expect(chamadas.find((c) => c.caminho === "/api/grupos")!.corpo).toEqual({ titularId: "h1", cobranca: "separada" });
    const posts = chamadas.filter((c) => c.metodo === "POST" && c.caminho === "/api/reservas").map((c) => c.corpo);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ grupoId: "g1", categoriaId: "c1", titularId: "h1", canal: "Balcão" });
    expect(posts[1]).toMatchObject({ grupoId: "g1", categoriaId: "c2", quartoId: "q201" });
  });

  test("grupo mostra o erro da linha e segue com as outras", async () => {
    const usuario = userEvent.setup();
    let n = 0;
    montar("/reservas/nova?chegada=2026-12-30", {
      "POST /api/grupos": { id: "g1", titularId: "h1", cobranca: "separada" },
      "POST /api/reservas": (corpo: { categoriaId: string }) =>
        corpo.categoriaId === "c1" ? { __status: 422, codigo: "CATEGORIA_LOTADA", mensagem: "Não há quartos Standard livres." } : reservaCriada(`r${++n}`, 200 + n),
    });
    await prepararGrupo(usuario);
    await usuario.click(screen.getByRole("button", { name: "Reservar grupo" }));
    expect(await screen.findByText("Não há quartos Standard livres.")).toBeInTheDocument();
    expect(screen.getByText("Grupo criado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#201" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "#202" })).not.toBeInTheDocument();
  });

  test("grupo: reenviar cria o grupo uma vez, não repete a linha criada e refaz a que falhou", async () => {
    const usuario = userEvent.setup();
    let tentativasLuxo = 0;
    let n = 0;
    montar("/reservas/nova?chegada=2026-12-30", {
      "POST /api/grupos": { id: "g1", titularId: "h1", cobranca: "separada" },
      "POST /api/reservas": (corpo: { categoriaId: string }) => {
        if (corpo.categoriaId === "c2" && ++tentativasLuxo === 1) return { __status: 422, codigo: "CATEGORIA_LOTADA", mensagem: "Não há quartos Luxo livres." };
        return reservaCriada(`r${++n}`, 300 + n);
      },
    });
    await prepararGrupo(usuario);
    await usuario.click(screen.getByRole("button", { name: "Reservar grupo" }));
    expect(await screen.findByText("Não há quartos Luxo livres.")).toBeInTheDocument();
    expect(screen.getByLabelText("Categoria da linha 1")).toBeDisabled();
    await usuario.click(screen.getByRole("button", { name: "Reservar grupo" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "#302" })).toBeInTheDocument());
    expect(screen.queryByText("Não há quartos Luxo livres.")).not.toBeInTheDocument();
    expect(chamadas.filter((c) => c.caminho === "/api/grupos")).toHaveLength(1);
    const posts = chamadas.filter((c) => c.metodo === "POST" && c.caminho === "/api/reservas").map((c) => c.corpo as { categoriaId: string });
    expect(posts.map((p) => p.categoriaId)).toEqual(["c1", "c2", "c2"]);
  });

  test("hóspede da URL inexistente mostra o erro", async () => {
    montar("/reservas/nova?hospede=h9", {
      "GET /api/hospedes/h9": { __status: 422, codigo: "HOSPEDE_NAO_ENCONTRADO", mensagem: "Hóspede não encontrado. Busque de novo pelo nome ou documento." },
    });
    expect(await screen.findByText("Não foi possível carregar o hóspede.")).toBeInTheDocument();
    expect(screen.getByText("Hóspede não encontrado. Busque de novo pelo nome ou documento.")).toBeInTheDocument();
  });

  test("falha ao carregar o catálogo mostra o erro", async () => {
    montar("/reservas/nova", { "GET /api/categorias": { __status: 500, codigo: "ERRO_INTERNO", mensagem: "Falha no servidor." } });
    expect(await screen.findByText("Não foi possível carregar categorias, quartos ou canais.")).toBeInTheDocument();
    expect(screen.getByText("Falha no servidor.")).toBeInTheDocument();
  });
});
