import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation, useSearchParams } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ReservaDetalhe } from "../../src/api/tipos";
import { GavetaReserva } from "../../src/telas/reserva/GavetaReserva";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";
import { criarReserva, titular } from "../fixtures/reserva";

function Local() {
  const l = useLocation();
  const [, definir] = useSearchParams();
  return (
    <>
      <output data-testid="local">{l.pathname + l.search}</output>
      <button onClick={() => definir({ reserva: "r2", tela: "mapa" })}>outra barra</button>
    </>
  );
}

function montar(reserva: ReservaDetalhe, rota = "/mapa?reserva=r1", extras: Record<string, unknown> = {}) {
  instalarApiFalsa({
    "GET /api/painel": criarPainel(),
    "GET /api/reservas/r1": reserva,
    // A aba Conta (testada em conta.test.tsx) consulta estas rotas quando a URL a abre.
    "GET /api/contas/ct1": { saldo: { debitos: 0, creditos: 0, saldo: 0 }, extrato: [] },
    "GET /api/produtos": [],
    "GET /api/formas-pagamento": [],
    "GET /api/caixa/atual": null,
    // O fluxo de check-in (checkin.test.tsx) consulta estas rotas quando a URL o abre.
    "GET /api/reservas/r1/quartos-sugeridos": [],
    "GET /api/categorias": [],
    // O fluxo de check-out (checkout.test.tsx) consulta a prévia quando a URL o abre.
    "GET /api/reservas/r1/checkout": { extrato: [], saldo: 0, saidaAntecipada: false },
    ...extras,
  });
  return renderizar(
    <>
      <GavetaReserva />
      <Local />
    </>,
    { rota },
  );
}

afterEach(() => vi.unstubAllGlobals());

const supervisor = async (usuario: ReturnType<typeof userEvent.setup>, titulo: string, motivo: string) => {
  const janela = await screen.findByRole("dialog", { name: titulo });
  await usuario.type(within(janela).getByLabelText("Motivo"), motivo);
  await usuario.type(within(janela).getByLabelText("Login do supervisor"), "admin");
  await usuario.type(within(janela).getByLabelText("Senha do supervisor"), "segredo");
  await usuario.click(within(janela).getByRole("button", { name: "Autorizar" }));
};

describe("painel da reserva", () => {
  test("abre pelo parâmetro ?reserva e mostra cabeçalho", async () => {
    montar(criarReserva());
    expect(await screen.findByRole("dialog", { name: "#128 · Maria Silva · Qto 101" })).toBeInTheDocument();
    expect(screen.getByText("20/11 → 23/11 · 2 adultos + 1 criança")).toBeInTheDocument();
    expect(screen.getByText("hospedada")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Resumo" })).toHaveAttribute("aria-selected", "true");
  });

  test("sem quarto o cabeçalho diz 'sem quarto'", async () => {
    montar(criarReserva({ quartoId: null, quartoNumero: null, estado: "confirmada" }));
    expect(await screen.findByRole("dialog", { name: "#128 · Maria Silva · sem quarto" })).toBeInTheDocument();
  });

  test("sem ?reserva a gaveta não existe", () => {
    montar(criarReserva(), "/mapa");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("erro ao carregar mostra a mensagem do servidor", async () => {
    montar(criarReserva(), "/mapa?reserva=r1", {
      "GET /api/reservas/r1": { __status: 404, codigo: "RESERVA_NAO_ENCONTRADA", mensagem: "Reserva não encontrada. Confira o número informado." },
    });
    expect(await screen.findByText("Reserva não encontrada. Confira o número informado.")).toBeInTheDocument();
  });

  test("resumo mostra canal, observações, diárias e total", async () => {
    montar(criarReserva());
    expect(await screen.findByText("Balcão")).toBeInTheDocument();
    expect(screen.getByText("Chegada tarde")).toBeInTheDocument();
    expect(screen.getByText("R$ 300,00")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("R$ 902,00")).toBeInTheDocument();
    expect(screen.queryByText(/prazo/)).not.toBeInTheDocument();
  });

  test("pré-reserva mostra sinal, valor pago e prazo", async () => {
    const prazo = "2026-11-12T15:00:00.000Z";
    const d = new Date(prazo);
    const p = (n: number) => String(n).padStart(2, "0");
    montar(criarReserva({ estado: "pre_reserva", quartoId: null, quartoNumero: null, pago: 5000, prazoSinal: prazo }));
    expect(
      await screen.findByText(`R$ 270,00 · pago R$ 50,00 · prazo ${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`),
    ).toBeInTheDocument();
  });

  test("diárias mostram o detalhamento do cálculo", async () => {
    const usuario = userEvent.setup();
    montar(criarReserva());
    await screen.findByText("Balcão");
    expect(screen.queryByText(/Sábado \+15%/)).not.toBeInTheDocument();
    const botoes = screen.getAllByRole("button", { name: "Ver cálculo" });
    expect(botoes).toHaveLength(3);
    expect(botoes[1]).toHaveAttribute("aria-expanded", "false");
    await usuario.click(botoes[1]!);
    expect(botoes[1]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Base R$ 280,00 → Sábado +15% R$ 42,00")).toBeInTheDocument();
    await usuario.click(botoes[1]!);
    expect(screen.queryByText(/Sábado \+15%/)).not.toBeInTheDocument();
  });

  test("aba Hóspedes lista titular, acompanhantes e campos faltantes da FNRH", async () => {
    const usuario = userEvent.setup();
    montar(
      criarReserva({
        titular: { ...titular, pendenciasFnrh: ["documento", "endereco.cidade"] },
        acompanhantes: [{ ...titular, id: "h2", nome: "Pedro Silva", pendenciasFnrh: [] }],
      }),
    );
    await usuario.click(await screen.findByRole("tab", { name: "Hóspedes" }));
    expect(screen.getByTestId("local")).toHaveTextContent("/mapa?reserva=r1&aba=hospedes");
    expect(screen.getByText("Maria Silva")).toBeInTheDocument();
    expect(screen.getByText("Pedro Silva")).toBeInTheDocument();
    expect(screen.getByText("FNRH incompleta: documento, cidade")).toBeInTheDocument();
    expect(screen.getByText("FNRH completa")).toBeInTheDocument();
  });

  test("fluxo=checkin mostra o marcador no lugar das abas", async () => {
    montar(criarReserva({ estado: "confirmada" }), "/mapa?reserva=r1&fluxo=checkin");
    expect(await screen.findByRole("heading", { name: "Check-in" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  test("fluxo=checkout mostra o fluxo no lugar das abas", async () => {
    montar(criarReserva(), "/mapa?reserva=r1&fluxo=checkout");
    expect(await screen.findByRole("heading", { name: "Check-out" })).toBeInTheDocument();
  });

  test("fechar remove os parâmetros da reserva e preserva os demais", async () => {
    const usuario = userEvent.setup();
    montar(criarReserva(), "/mapa?inicio=2026-11-01&reserva=r1&aba=conta&receber=500");
    await usuario.click(await screen.findByRole("button", { name: "Fechar" }));
    expect(screen.getByTestId("local")).toHaveTextContent(/^\/mapa\?inicio=2026-11-01$/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("clicar em outra barra troca a reserva sem fechar a gaveta", async () => {
    const usuario = userEvent.setup();
    montar(criarReserva(), "/mapa?reserva=r1", {
      "GET /api/reservas/r2": criarReserva({ id: "r2", codigo: 200, titular: { ...titular, nome: "João Souza" }, quartoNumero: "102" }),
    });
    await screen.findByRole("dialog", { name: "#128 · Maria Silva · Qto 101" });
    await usuario.click(screen.getByRole("button", { name: "outra barra" }));
    expect(await screen.findByRole("dialog", { name: "#200 · João Souza · Qto 102" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});

describe("ações por estado", () => {
  test("pré-reserva: registrar sinal, prorrogar e cancelar", async () => {
    montar(criarReserva({ estado: "pre_reserva", pago: 5000 }));
    await screen.findByRole("button", { name: "Registrar sinal" });
    expect(screen.getByRole("button", { name: "Prorrogar sinal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar reserva" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fazer check-in" })).not.toBeInTheDocument();
  });

  test("registrar sinal abre a aba Conta com o valor pendente", async () => {
    const usuario = userEvent.setup();
    montar(criarReserva({ estado: "pre_reserva", pago: 5000 }));
    await usuario.click(await screen.findByRole("button", { name: "Registrar sinal" }));
    expect(screen.getByTestId("local")).toHaveTextContent("/mapa?reserva=r1&aba=conta&receber=22000");
  });

  test("hospedada: lançar extra e check-out", async () => {
    const usuario = userEvent.setup();
    montar(criarReserva());
    await screen.findByRole("button", { name: "Lançar extra" });
    expect(screen.queryByRole("button", { name: "Registrar sinal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar reserva" })).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Lançar extra" }));
    expect(screen.getByTestId("local")).toHaveTextContent("/mapa?reserva=r1&aba=conta");
    await usuario.click(screen.getByRole("button", { name: "Fazer check-out" }));
    expect(screen.getByTestId("local")).toHaveTextContent("fluxo=checkout");
  });

  test("confirmada: check-in e cancelar; no-show só depois da data de chegada", async () => {
    const usuario = userEvent.setup();
    montar(criarReserva({ estado: "confirmada", chegada: "2026-11-20" }));
    await screen.findByRole("button", { name: "Fazer check-in" });
    expect(screen.getByRole("button", { name: "Cancelar reserva" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar no-show" })).not.toBeInTheDocument(); // painel.dia = 2026-11-20
    await usuario.click(screen.getByRole("button", { name: "Fazer check-in" }));
    expect(screen.getByTestId("local")).toHaveTextContent("fluxo=checkin");
  });

  test("chegada anterior ao dia mostra Marcar no-show e envia motivo e supervisor", async () => {
    const usuario = userEvent.setup();
    montar(criarReserva({ estado: "confirmada", chegada: "2026-11-18", saida: "2026-11-21" }), "/mapa?reserva=r1", {
      "POST /api/reservas/r1/no-show": criarReserva({ estado: "no_show" }),
    });
    await usuario.click(await screen.findByRole("button", { name: "Marcar no-show" }));
    await supervisor(usuario, "Marcar no-show", "Não apareceu");
    await waitFor(() =>
      expect(chamadas.find((c) => c.caminho === "/api/reservas/r1/no-show")?.corpo).toEqual({ motivo: "Não apareceu", supervisor: { login: "admin", senha: "segredo" } }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Marcar no-show" })).not.toBeInTheDocument());
  });

  test.each(["finalizada", "cancelada", "no_show"] as const)("%s não tem ações", async (estado) => {
    montar(criarReserva({ estado }));
    await screen.findByText("Balcão");
    expect(screen.queryByRole("button", { name: /Registrar|Prorrogar|Cancelar|check|Lançar|no-show/i })).not.toBeInTheDocument();
  });

  test("cancelar pede supervisor e envia motivo", async () => {
    const usuario = userEvent.setup();
    montar(criarReserva({ estado: "pre_reserva" }), "/mapa?reserva=r1", {
      "POST /api/reservas/r1/cancelar": criarReserva({ estado: "cancelada" }),
    });
    await usuario.click(await screen.findByRole("button", { name: "Cancelar reserva" }));
    await supervisor(usuario, "Cancelar reserva", "Hóspede desistiu");
    await waitFor(() =>
      expect(chamadas.find((c) => c.caminho === "/api/reservas/r1/cancelar")?.corpo).toEqual({ motivo: "Hóspede desistiu", supervisor: { login: "admin", senha: "segredo" } }),
    );
  });

  test("erro do servidor ao cancelar aparece na janela e ela continua aberta", async () => {
    const usuario = userEvent.setup();
    montar(criarReserva({ estado: "pre_reserva" }), "/mapa?reserva=r1", {
      "POST /api/reservas/r1/cancelar": { __status: 403, codigo: "SUPERVISOR_INVALIDO", mensagem: "Login ou senha do supervisor inválidos." },
    });
    await usuario.click(await screen.findByRole("button", { name: "Cancelar reserva" }));
    await supervisor(usuario, "Cancelar reserva", "Teste");
    expect(await screen.findByText("Login ou senha do supervisor inválidos.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Cancelar reserva" })).toBeInTheDocument();
  });

  test("prorrogar sinal escolhe o prazo, autoriza e envia", async () => {
    const usuario = userEvent.setup();
    montar(criarReserva({ estado: "pre_reserva" }), "/mapa?reserva=r1", {
      "POST /api/reservas/r1/prorrogar-sinal": criarReserva({ estado: "pre_reserva" }),
    });
    await usuario.click(await screen.findByRole("button", { name: "Prorrogar sinal" }));
    await usuario.click(await screen.findByRole("button", { name: "Continuar" }));
    await supervisor(usuario, "Prorrogar sinal", "Cliente pediu");
    await waitFor(() => {
      const c = chamadas.find((x) => x.caminho === "/api/reservas/r1/prorrogar-sinal");
      expect(c?.corpo).toMatchObject({ motivo: "Cliente pediu", supervisor: { login: "admin", senha: "segredo" } });
      expect((c?.corpo as { novoPrazo: string }).novoPrazo).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  test("resumo mostra a última arrumação", async () => {
    const em = new Date(2026, 10, 20, 9, 5).toISOString();
    const { unmount } = montar(criarReserva({ ultimaArrumacao: { em, por: "Rita Camareira" } }));
    expect(await screen.findByText("Última arrumação: hoje às 09:05 por Rita Camareira")).toBeInTheDocument();
    unmount();
    montar(criarReserva());
    expect(await screen.findByText("Sem arrumação hoje")).toBeInTheDocument();
  });

  test("reserva que não está hospedada não mostra arrumação", async () => {
    montar(criarReserva({ estado: "confirmada" }));
    await screen.findByText("Chegada tarde");
    expect(screen.queryByText(/arrumação/i)).not.toBeInTheDocument();
  });
});
