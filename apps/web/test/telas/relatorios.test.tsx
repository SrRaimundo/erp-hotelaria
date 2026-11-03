import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Relatorio } from "../../src/api/tipos";
import { formatarCelula, tabelaDaSecao } from "../../src/telas/relatorios/formatar";
import { TelaCaixa } from "../../src/telas/caixa/TelaCaixa";
import { TelaRelatorio } from "../../src/telas/relatorios/TelaRelatorio";
import { TelaRelatorios } from "../../src/telas/relatorios/TelaRelatorios";
import { GavetaReserva } from "../../src/telas/reserva/GavetaReserva";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { aguardarConsultas, renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";
import { criarReserva } from "../fixtures/reserva";

afterEach(() => vi.unstubAllGlobals());

const GERADO_EM = "2026-11-20T15:30:00.000Z";

const completo: Relatorio = {
  id: "check-in",
  titulo: "Lista de check-in",
  subtitulo: "Chegadas em 20/11/2026",
  geradoEm: GERADO_EM,
  resumo: [{ rotulo: "Reservas", valor: "2" }],
  secoes: [
    {
      colunas: [
        { chave: "hospede", titulo: "Hóspede", tipo: "texto" },
        { chave: "pessoas", titulo: "Pessoas", tipo: "numero" },
        { chave: "saldo", titulo: "Saldo", tipo: "dinheiro" },
        { chave: "chegada", titulo: "Chegada", tipo: "data" },
        { chave: "feito", titulo: "Feito", tipo: "em-branco" },
      ],
      linhas: [
        { hospede: "Conceição Silva", pessoas: 2, saldo: 123456, chegada: "2026-11-20", feito: null },
        { hospede: "João Souza", pessoas: 1, saldo: null, chegada: "2026-11-21", feito: null },
      ],
      totais: { pessoas: 3, saldo: 123456 },
    },
  ],
};

const vazio: Relatorio = { ...completo, resumo: [], secoes: [{ ...completo.secoes[0]!, linhas: [], totais: undefined }] };

function Rotas() {
  const l = useLocation();
  return (
    <>
      <output data-testid="local">{l.pathname + l.search}</output>
      <Routes>
        <Route path="/relatorios" element={<TelaRelatorios />} />
        <Route path="/relatorios/:id" element={<TelaRelatorio />} />
        <Route path="/caixa" element={<TelaCaixa />} />
        <Route path="*" element={null} />
      </Routes>
      <GavetaReserva />
    </>
  );
}

describe("catálogo", () => {
  test("mostra os relatórios da permissão e o 'Em breve'; o caixa só com caixa.operar", async () => {
    const r = renderizar(<Rotas />, { rota: "/relatorios", usuario: { permissoes: ["reservas.gerenciar"] } });
    expect(screen.getByRole("link", { name: /Lista de check-in/ })).toHaveAttribute("href", "/relatorios/check-in");
    expect(screen.getByText(/Chegadas do dia/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Fechamento de caixa/ })).not.toBeInTheDocument();
    for (const nome of ["Resumo do dia", "Previsão de ocupação", "Desempenho"]) expect(screen.getByText(nome)).toBeInTheDocument();
    // Reservas por canal saiu do "Em breve" e virou cartão
    expect(screen.getByRole("link", { name: /Reservas por canal/ })).toHaveAttribute("href", "/relatorios/canais");
    expect(screen.getAllByText("Reservas por canal")).toHaveLength(1);
    await aguardarConsultas(r.cliente);
  });

  test("com caixa.operar aparece o cartão de caixa", async () => {
    const r = renderizar(<Rotas />, { rota: "/relatorios", usuario: { permissoes: ["reservas.gerenciar", "caixa.operar"] } });
    expect(screen.getByRole("link", { name: /Fechamento de caixa/ })).toBeInTheDocument();
    await aguardarConsultas(r.cliente);
  });
});

describe("relatório por canal", () => {
  test("filtro de período sem turno; datas viram consulta ao servidor", async () => {
    instalarApiFalsa({ "GET /api/relatorios/canais": completo });
    const r = renderizar(<Rotas />, { rota: "/relatorios/canais", usuario: { permissoes: ["reservas.gerenciar"] } });
    await screen.findByRole("table");
    expect(screen.queryByLabelText("Turno")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-11-15" } });
    await waitFor(() => expect(chamadas.some((c) => c.caminho === "/api/relatorios/canais?inicio=2026-11-01&fim=2026-11-15")).toBe(true));
    await aguardarConsultas(r.cliente);
  });

  test("sem reservas.gerenciar o cartão não aparece", async () => {
    const r = renderizar(<Rotas />, { rota: "/relatorios", usuario: { permissoes: ["caixa.operar"] } });
    expect(screen.queryByRole("link", { name: /Reservas por canal/ })).not.toBeInTheDocument();
    await aguardarConsultas(r.cliente);
  });
});

describe("formatação", () => {
  test("cada tipo de coluna, null como traço e em-branco vazio", () => {
    const [texto, numero, dinheiro, data, branco] = completo.secoes[0]!.colunas as [never, never, never, never, never];
    expect(formatarCelula(texto, "Conceição")).toBe("Conceição");
    expect(formatarCelula(numero, 2)).toBe("2");
    expect(formatarCelula(dinheiro, 123456)).toBe("R$ 1.234,56");
    expect(formatarCelula(dinheiro, null)).toBe("—");
    expect(formatarCelula(data, "2026-11-20")).toBe("20/11/2026");
    expect(formatarCelula(branco, null)).toBe("");
  });

  test("totais: 'Total' na primeira coluna e valores formatados por tipo", () => {
    expect(tabelaDaSecao(completo.secoes[0]!).totais).toEqual(["Total", "3", "R$ 1.234,56", "", ""]);
  });
});

describe("visor", () => {
  test("desenha todos os tipos de coluna, o saldo nulo como traço e as colunas em branco com borda", async () => {
    instalarApiFalsa({ "GET /api/relatorios/check-in": completo });
    const r = renderizar(<Rotas />, { rota: "/relatorios/check-in", usuario: { permissoes: ["reservas.gerenciar"] } });
    const tabela = await screen.findByRole("table");
    const linhas = within(tabela).getAllByRole("row");
    // cabeçalho, 2 linhas e totais
    expect(linhas).toHaveLength(4);
    const l1 = within(linhas[1]!).getAllByRole("cell").map((c) => c.textContent);
    expect(l1).toEqual(["Conceição Silva", "2", "R$ 1.234,56", "20/11/2026", ""]);
    const l2 = within(linhas[2]!).getAllByRole("cell");
    expect(l2[2]).toHaveTextContent("—");
    expect(l2[4]).toHaveClass("rel-em-branco");
    expect(l2[4]).toBeEmptyDOMElement();
    expect(within(linhas[3]!).getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("Reservas")).toBeInTheDocument();
    await aguardarConsultas(r.cliente);
  });

  test("relatório vazio mostra a mensagem e continua imprimível", async () => {
    instalarApiFalsa({ "GET /api/relatorios/check-in": vazio });
    const r = renderizar(<Rotas />, { rota: "/relatorios/check-in", usuario: { permissoes: ["reservas.gerenciar"] } });
    expect(await screen.findByText("Nada para mostrar neste filtro")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimir" })).toBeEnabled();
    await aguardarConsultas(r.cliente);
  });

  test("trocar a data consulta o servidor com o filtro", async () => {
    instalarApiFalsa({ "GET /api/relatorios/check-in": completo });
    const r = renderizar(<Rotas />, { rota: "/relatorios/check-in", usuario: { permissoes: ["reservas.gerenciar"] } });
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-11-25" } });
    await waitFor(() => expect(chamadas.some((c) => c.caminho === "/api/relatorios/check-in?data=2026-11-25")).toBe(true));
    expect(screen.getByTestId("local")).toHaveTextContent("/relatorios/check-in?data=2026-11-25");
    await aguardarConsultas(r.cliente);
  });

  test("busca de hóspedes envia o termo digitado", async () => {
    instalarApiFalsa({ "GET /api/relatorios/hospedes": completo });
    const r = renderizar(<Rotas />, { rota: "/relatorios/hospedes", usuario: { permissoes: ["reservas.gerenciar"] } });
    await screen.findByRole("table");
    await userEvent.setup().type(screen.getByLabelText("Nome ou documento"), "Concei");
    await waitFor(() => expect(chamadas.some((c) => c.caminho === "/api/relatorios/hospedes?busca=Concei")).toBe(true));
    await aguardarConsultas(r.cliente);
  });

  test("caixa: escolhe o turno entre os do período e consulta com ele", async () => {
    instalarApiFalsa({
      "GET /api/relatorios/caixa/turnos": [{ id: "t9", operador: "Maria Recepção", abertoEm: GERADO_EM, fechadoEm: null, situacao: "aberto", valorInicial: 5000 }],
      "GET /api/relatorios/caixa": completo,
    });
    const r = renderizar(<Rotas />, { rota: "/relatorios/caixa", usuario: { permissoes: ["caixa.operar"] } });
    await screen.findByRole("table");
    const turno = screen.getByLabelText("Turno");
    await waitFor(() => expect(within(turno).getAllByRole("option")).toHaveLength(2));
    await userEvent.setup().selectOptions(turno, "t9");
    await waitFor(() => expect(chamadas.some((c) => c.caminho === "/api/relatorios/caixa?turno=t9")).toBe(true));
    await aguardarConsultas(r.cliente);
  });

  test("sem a permissão do relatório não consulta nada", async () => {
    const r = renderizar(<Rotas />, { rota: "/relatorios/caixa", usuario: { permissoes: ["reservas.gerenciar"] } });
    await aguardarConsultas(r.cliente);
    expect(screen.queryByRole("heading", { name: "Fechamento de caixa" })).not.toBeInTheDocument();
    expect(chamadas.filter((c) => c.caminho.startsWith("/api/relatorios"))).toHaveLength(0);
  });
});

describe("impressão", () => {
  test("Imprimir chama window.print", async () => {
    instalarApiFalsa({ "GET /api/relatorios/check-in": completo });
    const imprimir = vi.fn();
    vi.stubGlobal("print", imprimir);
    const r = renderizar(<Rotas />, { rota: "/relatorios/check-in", usuario: { permissoes: ["reservas.gerenciar"] } });
    await screen.findByRole("table");
    await userEvent.setup().click(screen.getByRole("button", { name: "Imprimir" }));
    expect(imprimir).toHaveBeenCalledTimes(1);
    await aguardarConsultas(r.cliente);
  });

  test("cabeçalho de impressão: estabelecimento, razão social, CNPJ, endereço, título, filtros e usuário", async () => {
    instalarApiFalsa({
      "GET /api/config": { nomeEstabelecimento: "Pousada Sol", razaoSocial: "Sol Hotelaria Ltda", cnpj: "12.345.678/0001-90", endereco: "Rua das Flores, 10", horaCheckin: "14:00", horaCheckout: "12:00" },
      "GET /api/relatorios/check-in": completo,
    });
    const r = renderizar(<Rotas />, { rota: "/relatorios/check-in", usuario: { permissoes: ["reservas.gerenciar"] } });
    const cab = await screen.findByTestId("cabecalho-impressao");
    for (const t of ["Pousada Sol", "Sol Hotelaria Ltda", "CNPJ 12.345.678/0001-90", "Rua das Flores, 10", "Lista de check-in", "Chegadas em 20/11/2026"]) {
      expect(within(cab).getByText(t)).toBeInTheDocument();
    }
    expect(cab).toHaveTextContent(/Gerado em 20\/11\/2026 \d{2}:\d{2} por Maria Recepção/);
    await aguardarConsultas(r.cliente);
  });
});

describe("conta do hóspede", () => {
  test("sem reserva mostra a orientação e não consulta o servidor", async () => {
    const r = renderizar(<Rotas />, { rota: "/relatorios/conta", usuario: { permissoes: ["reservas.gerenciar"] } });
    expect(screen.getByText(/Escolha uma reserva/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "lista de reservas" })).toHaveAttribute("href", "/reservas");
    expect(screen.getByRole("button", { name: "Imprimir" })).toBeDisabled();
    await aguardarConsultas(r.cliente);
    expect(chamadas.filter((c) => c.caminho.startsWith("/api/relatorios"))).toHaveLength(0);
  });

  test("com ?reserva consulta o relatório e não abre a gaveta da reserva", async () => {
    instalarApiFalsa({ "GET /api/relatorios/conta": { ...completo, id: "conta", titulo: "Conta do hóspede" } });
    const r = renderizar(<Rotas />, { rota: "/relatorios/conta?reserva=r1", usuario: { permissoes: ["reservas.gerenciar"] } });
    await screen.findByRole("table");
    expect(chamadas.some((c) => c.caminho === "/api/relatorios/conta?reserva=r1")).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await aguardarConsultas(r.cliente);
  });
});

describe("atalhos nas telas", () => {
  test("a reserva tem 'Imprimir conta', que abre o relatório da reserva", async () => {
    instalarApiFalsa({
      "GET /api/painel": criarPainel(),
      "GET /api/reservas/r1": criarReserva(),
      "GET /api/relatorios/conta": { ...completo, id: "conta" },
    });
    const r = renderizar(<Rotas />, { rota: "/mapa?reserva=r1", usuario: { permissoes: ["reservas.gerenciar"] } });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Imprimir conta" }));
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent("/relatorios/conta?reserva=r1"));
    await screen.findByRole("table");
    await aguardarConsultas(r.cliente);
  });

  test("o caixa tem 'Relatório', que leva a /relatorios/caixa", async () => {
    instalarApiFalsa({ "GET /api/caixa/atual": null, "GET /api/formas-pagamento": [], "GET /api/relatorios/caixa/turnos": [], "GET /api/relatorios/caixa": { ...completo, id: "caixa" } });
    const r = renderizar(<Rotas />, { rota: "/caixa", usuario: { permissoes: ["caixa.operar"] } });
    await userEvent.setup().click(await screen.findByRole("link", { name: "Relatório" }));
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent("/relatorios/caixa"));
    await screen.findByRole("table");
    await aguardarConsultas(r.cliente);
  });
});

describe("gaveta da reserva, impressão e voltar", () => {
  const permissoes = { permissoes: ["reservas.gerenciar"] };

  test("em outro relatório o ?reserva abre a gaveta normalmente (só o da conta o usa como filtro)", async () => {
    instalarApiFalsa({ "GET /api/painel": criarPainel(), "GET /api/reservas/r1": criarReserva(), "GET /api/relatorios/check-in": completo });
    const r = renderizar(<Rotas />, { rota: "/relatorios/check-in?reserva=r1&data=2026-11-25", usuario: permissoes });
    expect(await screen.findByRole("dialog", { name: "#128 · Maria Silva · Qto 101" })).toBeInTheDocument();
    // o relatório não vê a reserva como filtro
    await waitFor(() => expect(chamadas.some((c) => c.caminho === "/api/relatorios/check-in?data=2026-11-25")).toBe(true));
    await aguardarConsultas(r.cliente);
  });

  test("o CSS de impressão dos relatórios só vale com um relatório montado", async () => {
    instalarApiFalsa({ "GET /api/relatorios/check-in": completo });
    const r = renderizar(<Rotas />, { rota: "/relatorios", usuario: permissoes });
    expect(document.body).not.toHaveClass("imprimindo-relatorio");
    await userEvent.setup().click(screen.getByRole("link", { name: /Lista de check-in/ }));
    await screen.findByRole("table");
    expect(document.body).toHaveClass("imprimindo-relatorio");
    await userEvent.setup().click(screen.getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent(/^\/relatorios$/));
    expect(document.body).not.toHaveClass("imprimindo-relatorio");
    await aguardarConsultas(r.cliente);
  });

  test("Voltar de um relatório aberto direto leva ao catálogo", async () => {
    instalarApiFalsa({ "GET /api/relatorios/check-in": completo });
    const a = renderizar(<Rotas />, { rota: "/relatorios/check-in", usuario: permissoes });
    await screen.findByRole("table");
    await userEvent.setup().click(screen.getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent(/^\/relatorios$/));
    await aguardarConsultas(a.cliente);
  });

  test("caixa-only: Voltar vai ao caixa, não a uma tela sem permissão", async () => {
    instalarApiFalsa({ "GET /api/relatorios/caixa/turnos": [], "GET /api/relatorios/caixa": { ...completo, id: "caixa" }, "GET /api/caixa/atual": null, "GET /api/formas-pagamento": [] });
    const r = renderizar(<Rotas />, { rota: "/relatorios/caixa", usuario: { permissoes: ["caixa.operar"] } });
    await screen.findByRole("table");
    await userEvent.setup().click(screen.getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent(/^\/caixa$/));
    await aguardarConsultas(r.cliente);
  });
});
