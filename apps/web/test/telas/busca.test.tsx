import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BarraTopo } from "../../src/layout/BarraTopo";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";

afterEach(() => vi.unstubAllGlobals());

function Local() {
  const l = useLocation();
  return <p data-testid="local">{l.pathname + l.search}</p>;
}
const App = () => (
  <>
    <BarraTopo />
    <Local />
  </>
);
const recepcao = { usuario: { permissoes: ["reservas.gerenciar"] } };
const resultados = [
  { tipo: "quarto", id: "q1", rotulo: "Quarto 101", acoes: ["ver_quarto"] },
  { tipo: "reserva", id: "r1", rotulo: "Reserva #7 — Maria Silva (20/11–22/11)", acoes: ["abrir", "checkin"] },
  { tipo: "hospede", id: "h1", rotulo: "Maria Silva — CPF ***.***.123-45", acoes: ["nova_reserva", "ver_historico"] },
];
const api = () => instalarApiFalsa({ "GET /api/busca": resultados, "GET /api/painel": criarPainel() });

describe("busca universal", () => {
  test("Ctrl+K abre a busca com foco e Enter executa a primeira ação", async () => {
    const u = userEvent.setup();
    api();
    renderizar(<App />, { ...recepcao, rota: "/mapa" });
    await u.keyboard("{Control>}k{/Control}");
    const campo = await screen.findByRole("combobox");
    expect(campo).toHaveFocus();
    expect(screen.getByText("Digite para buscar…")).toBeInTheDocument();
    await u.type(campo, "maria");
    expect(await screen.findByText("Reserva #7 — Maria Silva (20/11–22/11)")).toBeInTheDocument();
    expect(chamadas.filter((c) => c.caminho.startsWith("/api/busca"))).toHaveLength(1);
    expect(chamadas.at(-1)?.caminho).toBe("/api/busca?q=maria");
    expect(screen.getByRole("heading", { name: "Quartos" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reservas" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hóspedes" })).toBeInTheDocument();
    await u.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByTestId("local")).toHaveTextContent("/mapa?reserva=r1");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("Enter na reserva com check-in abre o fluxo só quando a primeira ação é checkin", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/busca": [{ tipo: "reserva", id: "r9", rotulo: "Reserva #9 — Ana", acoes: ["checkin"] }], "GET /api/painel": criarPainel() });
    renderizar(<App />, { ...recepcao, rota: "/mapa" });
    await u.keyboard("{Control>}k{/Control}");
    await u.type(await screen.findByRole("combobox"), "ana");
    await screen.findByText("Reserva #9 — Ana");
    await u.keyboard("{Enter}");
    expect(screen.getByTestId("local")).toHaveTextContent("/mapa?reserva=r9&fluxo=checkin");
  });

  test("setas navegam entre resultados", async () => {
    const u = userEvent.setup();
    api();
    renderizar(<App />, recepcao);
    await u.keyboard("{Control>}k{/Control}");
    const campo = await screen.findByRole("combobox");
    await u.type(campo, "m");
    await screen.findByText("Quarto 101");
    const opcoes = screen.getAllByRole("option");
    expect(opcoes).toHaveLength(3);
    expect(campo).toHaveAttribute("aria-activedescendant", opcoes[0]!.id);
    await u.keyboard("{ArrowDown}");
    expect(campo).toHaveAttribute("aria-activedescendant", opcoes[1]!.id);
    expect(opcoes[1]).toHaveAttribute("aria-selected", "true");
    await u.keyboard("{ArrowUp}{ArrowUp}");
    expect(campo).toHaveAttribute("aria-activedescendant", opcoes[2]!.id);
    await u.keyboard("{Enter}");
    expect(screen.getByTestId("local")).toHaveTextContent("/reservas/nova?hospede=h1");
  });

  test("botões das ações navegam conforme o contrato", async () => {
    const u = userEvent.setup();
    api();
    renderizar(<App />, recepcao);
    const abrirBusca = async () => {
      await u.click(screen.getByRole("button", { name: /Buscar quarto/ }));
      await u.type(await screen.findByRole("combobox"), "m");
    };
    await abrirBusca();
    await u.click(await screen.findByRole("button", { name: "Ver no mapa" }));
    expect(screen.getByTestId("local")).toHaveTextContent(/^\/mapa$/);
    await abrirBusca();
    await u.click(await screen.findByRole("button", { name: "Check-in" }));
    expect(screen.getByTestId("local")).toHaveTextContent("/mapa?reserva=r1&fluxo=checkin");
    await abrirBusca();
    await u.click(await screen.findByRole("button", { name: "Histórico" }));
    expect(screen.getByTestId("local")).toHaveTextContent("/reservas?q=Maria%20Silva&inicio=2025-11-20&estado=finalizada");
  });

  test("sem resultados mostra aviso", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/busca": [], "GET /api/painel": criarPainel() });
    renderizar(<App />, recepcao);
    await u.keyboard("{Control>}k{/Control}");
    await u.type(await screen.findByRole("combobox"), "zzz");
    expect(await screen.findByText("Nenhum resultado.")).toBeInTheDocument();
  });

  test("sem reservas.gerenciar não há gatilho nem atalho", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({});
    renderizar(<App />, { usuario: { permissoes: ["quartos.situacao"] } });
    expect(screen.queryByRole("button", { name: /Buscar quarto/ })).not.toBeInTheDocument();
    await u.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("no relatório da conta (onde ?reserva é filtro) check-in vai ao mapa, onde a gaveta abre", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/busca": [{ tipo: "reserva", id: "r9", rotulo: "Reserva #9 — Ana", acoes: ["checkin"] }], "GET /api/painel": criarPainel() });
    renderizar(<App />, { ...recepcao, rota: "/relatorios/conta?reserva=r1" });
    await u.keyboard("{Control>}k{/Control}");
    await u.type(await screen.findByRole("combobox"), "ana");
    await screen.findByText("Reserva #9 — Ana");
    await u.keyboard("{Enter}");
    expect(screen.getByTestId("local")).toHaveTextContent("/mapa?reserva=r9&fluxo=checkin");
  });
});
