import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Painel } from "../../src/api/tipos";
import { AppRotas } from "../../src/rotas";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";
import { criarReserva } from "../fixtures/reserva";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const recepcao = {
  nome: "Maria Recepção",
  perfil: "recepcao",
  permissoes: ["reservas.gerenciar", "caixa.operar", "quartos.situacao"],
};
const painel = (atencao: Painel["atencao"] = []) => ({
  "GET /api/painel": criarPainel({ atencao }),
  "GET /api/config": { horaCheckin: "14:00", horaCheckout: "12:00" },
});

describe("casca", () => {
  test("menu mostra só o que o perfil permite", async () => {
    instalarApiFalsa({ "GET /api/governanca": [] });
    renderizar(<AppRotas />, { rota: "/governanca", usuario: { nome: "Gil", perfil: "governanca", permissoes: ["quartos.situacao"] } });
    const menu = screen.getByRole("navigation", { name: "Menu principal" });
    const links = Array.from(menu.querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual(["Governança"]);
    expect(screen.queryByRole("button", { name: "+ Nova reserva" })).not.toBeInTheDocument();
  });

  test("sem permissão de reservas não há campo de busca vazio na barra do topo", async () => {
    instalarApiFalsa({ "GET /api/governanca": [] });
    const { container } = renderizar(<AppRotas />, { rota: "/governanca", usuario: { nome: "Gil", perfil: "governanca", permissoes: ["quartos.situacao"] } });
    expect(container.querySelector(".topo__busca")).toBeNull();
    expect(container.querySelector(".topo")).not.toBeNull();
  });

  test("recepção vê todos os itens, o ativo é destacado e o rodapé mostra usuário e Sair", async () => {
    instalarApiFalsa(painel());
    renderizar(<AppRotas />, { rota: "/mapa", usuario: recepcao });
    const menu = screen.getByRole("navigation", { name: "Menu principal" });
    expect(Array.from(menu.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Hoje", "Mapa", "Reservas", "Caixa", "Governança"]);
    expect(screen.getByRole("link", { name: "Mapa" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Hoje" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Maria Recepção")).toBeInTheDocument();
    expect(screen.getByText("recepcao")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  test("Hoje mostra o contador de atenção só quando maior que zero", async () => {
    instalarApiFalsa(painel(criarPainel().atencao));
    renderizar(<AppRotas />, { usuario: recepcao });
    expect(await screen.findByLabelText("2 itens de atenção")).toHaveTextContent("2");
  });

  test("sem itens de atenção não há contador", async () => {
    instalarApiFalsa(painel([]));
    renderizar(<AppRotas />, { usuario: recepcao });
    await screen.findByText(/ocupação hoje/);
    await waitFor(() => expect(screen.queryByLabelText(/itens de atenção/)).not.toBeInTheDocument());
  });

  test("Review Focus 5: sem conexão mostra a faixa e desabilita ações; volta sozinho", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("falha de rede")));
    renderizar(<AppRotas />, { usuario: recepcao });
    expect(await screen.findByText("Sem conexão com o servidor da pousada — tentando novamente…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Nova reserva" })).toBeDisabled();
    expect(screen.getByText("Sem conexão", { selector: "[data-conexao]" })).toBeInTheDocument();

    instalarApiFalsa(painel());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await waitFor(() => expect(screen.queryByText(/Sem conexão com o servidor/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "+ Nova reserva" })).toBeEnabled();
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  test("a rota / mostra a tela Hoje", async () => {
    instalarApiFalsa(painel());
    renderizar(<AppRotas />, { usuario: recepcao });
    expect(await screen.findByRole("heading", { level: 1, name: /, Maria$/ })).toBeInTheDocument();
    expect(screen.getByText(/ocupação hoje: 9 de 12 quartos \(75%\)/)).toBeInTheDocument();
  });

  test("busca abre pelo gatilho e por Ctrl+K, e fecha com Esc", async () => {
    instalarApiFalsa(painel());
    const u = userEvent.setup();
    renderizar(<AppRotas />, { usuario: recepcao });
    await u.click(screen.getByRole("button", { name: /Buscar quarto, hóspede, CPF ou nº da reserva/ }));
    expect(screen.getByRole("dialog", { name: "Buscar" })).toBeInTheDocument();
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await u.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("dialog", { name: "Buscar" })).toBeInTheDocument();
  });

  test("?reserva= abre o painel da reserva em qualquer rota", async () => {
    instalarApiFalsa({ ...painel(), "GET /api/governanca": [], "GET /api/reservas/r1": criarReserva() });
    renderizar(<AppRotas />, { rota: "/governanca?reserva=r1", usuario: recepcao });
    expect(await screen.findByRole("dialog", { name: "#128 · Maria Silva · Qto 101" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Governança" })).toBeInTheDocument();
  });

  test("I2: governança abrindo / cai em /governanca sem consultar o painel", async () => {
    instalarApiFalsa({ "GET /api/governanca": [] });
    renderizar(<AppRotas />, { rota: "/", usuario: { nome: "Gil", perfil: "governanca", permissoes: ["quartos.situacao"] } });
    expect(await screen.findByRole("heading", { name: "Governança" })).toBeInTheDocument();
    expect(chamadas.some((c) => c.caminho === "/api/painel")).toBe(false);
    expect(screen.queryByText(/ocupação hoje/)).not.toBeInTheDocument();
  });

  test("I2: governança não abre Caixa nem Mapa digitando a URL", async () => {
    instalarApiFalsa({ "GET /api/governanca": [] });
    renderizar(<AppRotas />, { rota: "/caixa", usuario: { nome: "Gil", perfil: "governanca", permissoes: ["quartos.situacao"] } });
    expect(await screen.findByRole("heading", { name: "Governança" })).toBeInTheDocument();
    expect(chamadas.map((c) => c.caminho)).toEqual(["/api/governanca"]);
  });

  test("I2: recepção continua abrindo /governanca", async () => {
    instalarApiFalsa({ ...painel(), "GET /api/governanca": [] });
    renderizar(<AppRotas />, { rota: "/governanca", usuario: recepcao });
    expect(await screen.findByRole("heading", { name: "Governança" })).toBeInTheDocument();
  });

  test("I2: sem nenhuma permissão da rota inicial mostra aviso em vez de redirecionar sem fim", async () => {
    instalarApiFalsa({});
    renderizar(<AppRotas />, { rota: "/", usuario: { nome: "Zé", perfil: "x", permissoes: ["caixa.operar"] } });
    expect(await screen.findByText("Você não tem permissão para abrir esta tela.")).toBeInTheDocument();
  });
});
