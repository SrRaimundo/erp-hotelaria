import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ItemListaReserva } from "../../src/api/tipos";
import { TelaReservas } from "../../src/telas/reservas/TelaReservas";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";

afterEach(() => vi.unstubAllGlobals());

function Local() {
  const l = useLocation();
  return <output data-testid="local">{l.pathname + l.search}</output>;
}

const item = (n: number, extras: Partial<ItemListaReserva> = {}): ItemListaReserva => ({
  reservaId: `r${n}`,
  codigo: n,
  titular: `Hóspede ${n}`,
  quartoNumero: "101",
  chegada: "2026-11-20",
  saida: "2026-11-22",
  estado: "confirmada",
  canal: "Balcão",
  categoria: "Standard",
  total: 123456,
  ...extras,
});

type Lista = { itens: ItemListaReserva[]; total: number };

function montar(lista: Lista | ((url: URL) => Lista), rota = "/reservas") {
  instalarApiFalsa({
    "GET /api/painel": criarPainel(),
    "GET /api/tarifas/canais": [
      { id: "c1", nome: "Balcão", percentual: 0, exigeSinal: false },
      { id: "c2", nome: "Booking", percentual: 15, exigeSinal: true },
    ],
    "GET /api/reservas": (_c: unknown, url: URL) => (typeof lista === "function" ? lista(url) : lista),
  });
  return renderizar(
    <>
      <TelaReservas />
      <Local />
    </>,
    { rota },
  );
}

const ultimaLista = () => {
  const c = chamadas.filter((x) => x.caminho.startsWith("/api/reservas")).at(-1)!;
  return new URL(c.caminho, "http://localhost");
};

describe("tela Reservas", () => {
  test("período padrão é painel.dia −7 a +30 e estados padrão excluem cancelada e no-show", async () => {
    montar({ itens: [item(1)], total: 1 });
    expect(await screen.findByText("Hóspede 1")).toBeInTheDocument();
    const u = ultimaLista();
    expect(u.searchParams.get("inicio")).toBe("2026-11-13");
    expect(u.searchParams.get("fim")).toBe("2026-12-20");
    expect(u.searchParams.get("estado")).toBe("pre_reserva,confirmada,hospedada,finalizada");
    expect(u.searchParams.get("pagina")).toBe("1");
    expect(screen.getByLabelText("De")).toHaveValue("2026-11-13");
    expect(screen.getByRole("button", { name: "Cancelada" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Confirmada" })).toHaveAttribute("aria-pressed", "true");
  });

  test("mostra as colunas com dinheiro, datas e estado", async () => {
    montar({ itens: [item(7, { estado: "pre_reserva", quartoNumero: null })], total: 1 });
    const linha = (await screen.findByText("Hóspede 7")).closest("tr")!;
    const t = within(linha);
    expect(t.getByText("7")).toBeInTheDocument();
    expect(t.getByText("Standard")).toBeInTheDocument();
    expect(t.getByText("20/11/2026")).toBeInTheDocument();
    expect(t.getByText("22/11/2026")).toBeInTheDocument();
    expect(t.getByText("pré-reserva")).toBeInTheDocument();
    expect(t.getByText("R$ 1.234,56")).toBeInTheDocument();
    expect(t.getByText("—")).toBeInTheDocument();
  });

  test("filtros viram parâmetros da API e da URL", async () => {
    const u = userEvent.setup();
    montar({ itens: [item(1)], total: 1 });
    await screen.findByText("Hóspede 1");

    await u.click(screen.getByRole("button", { name: "Finalizada" }));
    await u.click(screen.getByRole("button", { name: "Hospedada" }));
    await waitFor(() => expect(ultimaLista().searchParams.get("estado")).toBe("pre_reserva,confirmada"));

    await u.selectOptions(screen.getByLabelText("Canal"), "Booking");
    await waitFor(() => expect(ultimaLista().searchParams.get("canal")).toBe("Booking"));

    await u.type(screen.getByLabelText("Buscar"), "maria");
    await waitFor(() => expect(ultimaLista().searchParams.get("q")).toBe("maria"));

    const url = new URL(screen.getByTestId("local").textContent!, "http://localhost");
    expect(url.searchParams.get("estado")).toBe("pre_reserva,confirmada");
    expect(url.searchParams.get("canal")).toBe("Booking");
    expect(url.searchParams.get("q")).toBe("maria");
    expect(ultimaLista().searchParams.get("inicio")).toBe("2026-11-13");
  });

  test("o texto só vai à API depois de 300 ms sem digitar", async () => {
    const u = userEvent.setup();
    montar({ itens: [item(1)], total: 1 });
    await screen.findByText("Hóspede 1");
    await u.type(screen.getByLabelText("Buscar"), "ana");
    expect(chamadas.some((c) => c.caminho.includes("q=a"))).toBe(false);
    await waitFor(() => expect(ultimaLista().searchParams.get("q")).toBe("ana"));
    expect(chamadas.filter((c) => c.caminho.includes("q=")).map((c) => new URL(c.caminho, "http://x").searchParams.get("q"))).toEqual(["ana"]);
  });

  test("filtros da URL inicial são respeitados", async () => {
    montar({ itens: [item(1)], total: 1 }, "/reservas?inicio=2026-01-01&fim=2026-01-31&estado=cancelada&canal=Booking&q=zé&pagina=1");
    await screen.findByText("Hóspede 1");
    const u = ultimaLista();
    expect(u.searchParams.get("inicio")).toBe("2026-01-01");
    expect(u.searchParams.get("fim")).toBe("2026-01-31");
    expect(u.searchParams.get("estado")).toBe("cancelada");
    expect(u.searchParams.get("canal")).toBe("Booking");
    expect(u.searchParams.get("q")).toBe("zé");
    expect(screen.getByLabelText("Buscar")).toHaveValue("zé");
  });

  test("paginação pede a página 2 e mudar filtro volta à página 1", async () => {
    const u = userEvent.setup();
    montar((url) => ({ itens: [item(Number(url.searchParams.get("pagina")))], total: 120 }));
    expect(await screen.findByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    expect(ultimaLista().searchParams.get("porPagina")).toBe("50");

    await u.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByText("Página 2 de 3")).toBeInTheDocument();
    expect(ultimaLista().searchParams.get("pagina")).toBe("2");
    expect(screen.getByTestId("local")).toHaveTextContent("pagina=2");

    await u.click(screen.getByRole("button", { name: "Cancelada" }));
    expect(await screen.findByText("Página 1 de 3")).toBeInTheDocument();
    expect(ultimaLista().searchParams.get("pagina")).toBe("1");
  });

  test("clicar na linha abre a gaveta da reserva pela URL", async () => {
    const u = userEvent.setup();
    montar({ itens: [item(1), item(2)], total: 2 });
    await u.click(await screen.findByText("Hóspede 2"));
    expect(screen.getByTestId("local")).toHaveTextContent(/reserva=r2/);
  });

  test("abrir outra reserva descarta aba, fluxo e receber e mantém os filtros", async () => {
    const u = userEvent.setup();
    montar({ itens: [item(1), item(2)], total: 2 }, "/reservas?reserva=r1&aba=conta&fluxo=checkout&receber=5000&canal=Booking");
    await u.click(await screen.findByText("Hóspede 2"));
    const url = new URL(screen.getByTestId("local").textContent!, "http://localhost");
    expect(url.searchParams.get("reserva")).toBe("r2");
    expect(url.searchParams.has("aba")).toBe(false);
    expect(url.searchParams.has("fluxo")).toBe(false);
    expect(url.searchParams.has("receber")).toBe(false);
    expect(url.searchParams.get("canal")).toBe("Booking");
  });

  test("falha ao carregar o painel mostra o erro em vez de carregar para sempre", async () => {
    instalarApiFalsa({
      "GET /api/painel": { __status: 500, codigo: "X", mensagem: "Painel indisponível." },
      "GET /api/tarifas/canais": [],
    });
    renderizar(<TelaReservas />, { rota: "/reservas" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Painel indisponível.");
    expect(screen.queryByText("Carregando…")).not.toBeInTheDocument();
  });

  test("sem resultados mostra a mensagem vazia", async () => {
    montar({ itens: [], total: 0 });
    expect(await screen.findByText("Nenhuma reserva encontrada.")).toBeInTheDocument();
  });
});
