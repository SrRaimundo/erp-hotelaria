import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { describe, expect, test, vi } from "vitest";
import type { Mapa } from "../../src/api/tipos";
import { TelaMapa } from "../../src/telas/mapa/TelaMapa";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";

function Local() {
  const l = useLocation();
  return <output data-testid="local">{l.pathname + l.search}</output>;
}

const barra = (o: Partial<Mapa["barras"][number]>): Mapa["barras"][number] => ({
  reservaId: "r1", codigo: 12, quartoId: "q101", categoriaId: "c1", chegada: "2026-11-20", saida: "2026-11-23", estado: "confirmada", titular: "Ana Souza", ...o,
});

const mapa: Mapa = {
  quartos: [
    { id: "q101", numero: "101", categoria: "Standard", situacao: "livre" },
    { id: "q102", numero: "102", categoria: "Standard", situacao: "sujo" },
    { id: "q201", numero: "201", categoria: "Luxo", situacao: "em_manutencao" },
  ],
  barras: [
    barra({}),
    barra({ reservaId: "r2", codigo: 13, quartoId: "q102", estado: "hospedada", titular: "Bruno Lima", chegada: "2026-11-18", saida: "2026-11-21" }),
    barra({ reservaId: "r3", codigo: 14, quartoId: "q201", categoriaId: "c2", estado: "pre_reserva", titular: "Carla Dias", chegada: "2026-11-25", saida: "2026-11-26" }),
    barra({ reservaId: "r4", codigo: 15, quartoId: null, estado: "finalizada", titular: "Davi Melo", chegada: "2026-11-22", saida: "2026-11-24" }),
  ],
};

function montar(rota = "/mapa") {
  instalarApiFalsa({
    "GET /api/painel": criarPainel({ dia: "2026-11-20" }),
    "GET /api/categorias": [
      { id: "c1", nome: "Standard", maxAdultos: 2, maxCriancas: 1, comodidades: [] },
      { id: "c2", nome: "Luxo", maxAdultos: 3, maxCriancas: 1, comodidades: [] },
    ],
    "GET /api/mapa": mapa,
  });
  return renderizar(<><TelaMapa /><Local /></>, { rota });
}

describe("tela Mapa", () => {
  test("mostra quartos por categoria e barras com cores por estado", async () => {
    montar();
    const barraAna = await screen.findByRole("button", { name: "Ana Souza · 20/11–23/11 · confirmada" });
    expect(barraAna).toHaveAttribute("data-estado", "confirmada");
    expect(barraAna).toHaveTextContent("Ana Souza #12");
    expect(screen.getByRole("button", { name: "Bruno Lima · 18/11–21/11 · hospedada" })).toHaveAttribute("data-estado", "hospedada");
    const carla = screen.getByRole("button", { name: "Carla Dias · 25/11–26/11 · pré-reserva" });
    expect(carla).toHaveAttribute("data-estado", "pre_reserva");
    expect(carla).toHaveTextContent(/^Carla Dias$/);
    expect(screen.getByRole("button", { name: "Davi Melo · 22/11–24/11 · finalizada" })).toHaveAttribute("data-estado", "finalizada");

    expect(screen.getByRole("heading", { name: "Standard" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Luxo" })).toBeInTheDocument();
    expect(screen.getByText("101")).toBeInTheDocument();
    expect(screen.getByText("sujo")).toBeInTheDocument();
    expect(screen.getByText("manutenção")).toBeInTheDocument();
    expect(screen.getAllByText("Sem quarto")).toHaveLength(1);

    expect(chamadas.find((c) => c.caminho.startsWith("/api/mapa"))!.caminho).toBe("/api/mapa?inicio=2026-11-19&fim=2026-12-02");
    expect(screen.getByRole("columnheader", { name: "Sex 20/11" })).toHaveAttribute("aria-current", "date");
    expect(screen.getAllByRole("columnheader")).toHaveLength(14);
    expect(screen.getByRole("columnheader", { name: "Qui 19/11" })).not.toHaveAttribute("aria-current");
  });

  test("navegar ▶ pede o próximo período à API", async () => {
    montar();
    await screen.findByRole("button", { name: /Ana Souza/ });
    await userEvent.click(screen.getByRole("button", { name: "▶" }));
    expect(await screen.findByRole("columnheader", { name: "Qui 03/12" })).toBeInTheDocument();
    expect(chamadas.map((c) => c.caminho)).toContain("/api/mapa?inicio=2026-12-03&fim=2026-12-16");
    expect(screen.getByTestId("local")).toHaveTextContent("inicio=2026-12-03");
    await userEvent.click(screen.getByRole("button", { name: "Hoje" }));
    expect(await screen.findByRole("columnheader", { name: "Qui 19/11" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "◀" }));
    expect(await screen.findByRole("columnheader", { name: "Qui 05/11" })).toBeInTheDocument();
  });

  test("período de 7 dias e filtro de categoria vão para a API", async () => {
    montar();
    await screen.findByRole("button", { name: /Ana Souza/ });
    await userEvent.selectOptions(screen.getByLabelText("Período"), "7");
    await screen.findByRole("button", { name: /Ana Souza/ });
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
    expect(chamadas.map((c) => c.caminho)).toContain("/api/mapa?inicio=2026-11-19&fim=2026-11-25");
    await userEvent.selectOptions(screen.getByLabelText("Categoria"), "Luxo");
    await screen.findByRole("button", { name: /Ana Souza/ });
    expect(screen.getByTestId("local")).toHaveTextContent("categoria=c2");
    expect(chamadas.map((c) => c.caminho)).toContain("/api/mapa?inicio=2026-11-19&fim=2026-11-25&categoriaId=c2");
  });

  test("clicar na barra abre a reserva mantendo a visão; em célula vazia abre nova reserva com quarto e data", async () => {
    montar("/mapa?inicio=2026-11-19&dias=14");
    await userEvent.click(await screen.findByRole("button", { name: "Ana Souza · 20/11–23/11 · confirmada" }));
    const local = screen.getByTestId("local").textContent!;
    expect(local).toContain("/mapa?");
    expect(local).toContain("reserva=r1");
    expect(local).toContain("inicio=2026-11-19");

    // Dia ocupado por barra e linha 'sem quarto' não têm célula vazia.
    expect(screen.queryByRole("button", { name: "Nova reserva no quarto 101 em 21/11" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nova reserva no quarto Sem quarto/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Nova reserva no quarto 101 em 24/11" }));
    expect(screen.getByTestId("local")).toHaveTextContent("/reservas/nova?quarto=q101&chegada=2026-11-24");
  });

  test("células vazias ficam fora da ordem de tabulação; barras continuam tabuláveis", async () => {
    montar();
    const barraAna = await screen.findByRole("button", { name: /Ana Souza/ });
    expect(barraAna).not.toHaveAttribute("tabindex");
    expect(barraAna.tabIndex).toBe(0);
    const celula = screen.getByRole("button", { name: "Nova reserva no quarto 101 em 24/11" });
    expect(celula).toHaveAttribute("tabindex", "-1");
    const tabulaveis = screen.getAllByRole("button").filter((b) => b.tabIndex >= 0 && /^Nova reserva no quarto/.test(b.getAttribute("aria-label") ?? ""));
    expect(tabulaveis).toHaveLength(0);
  });

  test("não desenha a grade antes de carregar as categorias", async () => {
    instalarApiFalsa({
      "GET /api/painel": criarPainel({ dia: "2026-11-20" }),
      "GET /api/categorias": [{ id: "c1", nome: "Standard", maxAdultos: 2, maxCriancas: 1, comodidades: [] }],
      "GET /api/mapa": { quartos: [], barras: [barra({ quartoId: null })] },
    });
    const real = globalThis.fetch;
    let liberar!: () => void;
    const portao = new Promise<void>((r) => (liberar = r));
    vi.stubGlobal("fetch", async (entrada: RequestInfo | URL, init?: RequestInit) => {
      if (String(entrada).includes("/api/categorias")) await portao;
      return real(entrada, init);
    });
    renderizar(<TelaMapa />, { rota: "/mapa" });
    await waitFor(() => expect(chamadas.some((c) => c.caminho.startsWith("/api/mapa"))).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); }); // dá tempo de a resposta do mapa chegar
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("c1")).not.toBeInTheDocument();
    liberar();
    expect(await screen.findByRole("heading", { name: "Standard" })).toBeInTheDocument();
    expect(screen.queryByText("c1")).not.toBeInTheDocument();
  });

  test("erro ao carregar o mapa mostra aviso e a mensagem do servidor", async () => {
    instalarApiFalsa({
      "GET /api/painel": criarPainel({ dia: "2026-11-20" }),
      "GET /api/categorias": [],
      "GET /api/mapa": { __status: 500, codigo: "ERRO", mensagem: "Banco indisponível." },
    });
    renderizar(<TelaMapa />, { rota: "/mapa" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar o mapa. Banco indisponível.");
  });
});
