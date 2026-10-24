import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Painel } from "../../src/api/tipos";
import { TelaHoje } from "../../src/telas/hoje/TelaHoje";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";

const base = { codigo: 1, chegada: "2026-11-20", saida: "2026-11-22" };

function criarPainel(): Painel {
  return {
    dia: "2026-11-20",
    chegadas: [
      { ...base, reservaId: "r1", titular: "Ana Souza", quartoNumero: "101", estado: "confirmada", noites: 2, adultos: 2, criancas: 1, canal: "Balcão", sinalPendente: 0, pendenciasFnrh: false },
      { ...base, reservaId: "r2", titular: "Bruno Lima", quartoNumero: null, estado: "confirmada", noites: 3, adultos: 1, criancas: 0, canal: "Booking", sinalPendente: 0, pendenciasFnrh: false },
      { ...base, reservaId: "r3", titular: "Carla Dias", quartoNumero: "102", estado: "confirmada", noites: 1, adultos: 2, criancas: 0, canal: "Site", sinalPendente: 5000, pendenciasFnrh: true },
    ],
    saidas: [
      { ...base, reservaId: "r4", titular: "Davi Melo", quartoNumero: "201", contaId: "c4", saldo: 8600 },
      { ...base, reservaId: "r5", titular: "Eva Nunes", quartoNumero: "202", contaId: "c5", saldo: 0 },
    ],
    hospedados: 5,
    quartosSujos: [{ quartoId: "q103", numero: "103" }],
    sinaisVencendo: [],
    chegadasVencidas: [],
    alertas: [],
    ocupacao: { ocupados: 9, total: 12, percentual: 75 },
    numeros: { chegadas: 3, chegadasJaHospedadas: 1, saidas: 2, hospedados: 5, pessoasHospedadas: 8, quartosSujos: 1, quartosManutencao: 1, livresHoje: 3 },
    governanca: [
      { quartoId: "q103", numero: "103", situacao: "sujo", motivo: null },
      { quartoId: "q106", numero: "106", situacao: "em_manutencao", motivo: "chuveiro" },
    ],
    proximosDias: [
      { dia: "2026-11-21", chegadas: 4, saidas: 2, ocupacaoPct: 83 },
      { dia: "2026-11-22", chegadas: 1, saidas: 0, ocupacaoPct: 100 },
    ],
    atencao: [
      { tipo: "sinal_vencendo", id: "a1", titulo: "Sinal vence às 18:00", detalhe: "Reserva #8 · Fábio Reis · faltam R$ 150,00", reservaId: "r8", contaId: null, telefone: "(11) 99999-0000", sinalPendente: 15000, acoes: ["registrar_sinal", "prorrogar_sinal"] },
      { tipo: "chegada_atrasada", id: "a2", titulo: "Chegada atrasada", detalhe: "Reserva #9 · Gil Prado", reservaId: "r9", contaId: null, telefone: null, acoes: ["marcar_no_show", "abrir_reserva"] },
    ],
  };
}

function Local() {
  const l = useLocation();
  return <output data-testid="local">{l.pathname + l.search}</output>;
}

function montar(painel: Painel = criarPainel(), extras: Record<string, unknown> = {}) {
  instalarApiFalsa({
    "GET /api/painel": painel,
    "GET /api/config": { horaCheckin: "14:00", horaCheckout: "12:00" },
    ...extras,
  });
  return renderizar(
    <>
      <TelaHoje />
      <Local />
    </>,
  );
}

afterEach(() => vi.useRealTimers());

describe("tela Hoje", () => {
  test("mostra números e ocupação do dia vindos do servidor", async () => {
    montar();
    expect(await screen.findByText("Sexta-feira, 20 de novembro · ocupação hoje: 9 de 12 quartos (75%)")).toBeInTheDocument();
    expect(screen.getByText("1 já fez check-in")).toBeInTheDocument();
    expect(screen.getByText("8 pessoas")).toBeInTheDocument();
    expect(screen.getByText("1 em manutenção")).toBeInTheDocument();
    expect(screen.getByText("p/ walk-in")).toBeInTheDocument();
    expect(await screen.findByText("check-in a partir das 14:00")).toBeInTheDocument();
    expect(screen.getByText("até 12:00")).toBeInTheDocument();
  });

  test.each([
    [9, "Bom dia, Maria"],
    [15, "Boa tarde, Maria"],
    [20, "Boa noite, Maria"],
  ])("saudação pela hora local %i", async (hora, texto) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 20, hora, 0, 0));
    montar();
    expect(await screen.findByRole("heading", { level: 1, name: texto })).toBeInTheDocument();
  });

  test("atenção renderiza cada item com suas ações", async () => {
    montar();
    expect(await screen.findByRole("heading", { name: "Precisa da sua atenção (2)" })).toBeInTheDocument();
    expect(screen.getByText("Sinal vence às 18:00")).toBeInTheDocument();
    expect(screen.getByText("(11) 99999-0000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar sinal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prorrogar sinal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar no-show" })).toBeInTheDocument();
  });

  test("registrar sinal abre a reserva na aba Conta com o recebimento pré-preenchido", async () => {
    const u = userEvent.setup();
    montar();
    await u.click(await screen.findByRole("button", { name: "Registrar sinal" }));
    expect(screen.getByTestId("local")).toHaveTextContent("/?reserva=r8&aba=conta&receber=15000");
  });

  test("marcar no-show pede supervisor e chama a API", async () => {
    const u = userEvent.setup();
    montar(criarPainel(), { "POST /api/reservas/r9/no-show": { ok: true } });
    await u.click(await screen.findByRole("button", { name: "Marcar no-show" }));
    const janela = screen.getByRole("dialog", { name: "Marcar no-show" });
    await u.type(within(janela).getByLabelText("Motivo"), "Não apareceu");
    await u.type(within(janela).getByLabelText("Login do supervisor"), "sup");
    await u.type(within(janela).getByLabelText("Senha do supervisor"), "segredo");
    await u.click(within(janela).getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST" && c.caminho === "/api/reservas/r9/no-show")).toBe(true));
    const c = chamadas.find((x) => x.metodo === "POST")!;
    expect(c.corpo).toEqual({ motivo: "Não apareceu", supervisor: { login: "sup", senha: "segredo" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("prorrogar sinal coleta o novo prazo, pede supervisor e envia o prazo em UTC", async () => {
    const u = userEvent.setup();
    montar(criarPainel(), { "POST /api/reservas/r8/prorrogar-sinal": { ok: true } });
    await u.click(await screen.findByRole("button", { name: "Prorrogar sinal" }));
    const prazo = screen.getByLabelText("Novo prazo");
    await u.clear(prazo);
    await u.type(prazo, "2026-11-25T10:30");
    await u.click(screen.getByRole("button", { name: "Continuar" }));
    const janela = screen.getByRole("dialog", { name: "Prorrogar sinal" });
    await u.type(within(janela).getByLabelText("Motivo"), "Cliente pediu");
    await u.type(within(janela).getByLabelText("Login do supervisor"), "sup");
    await u.type(within(janela).getByLabelText("Senha do supervisor"), "segredo");
    await u.click(within(janela).getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST")).toBe(true));
    const c = chamadas.find((x) => x.metodo === "POST")!;
    expect(c.caminho).toBe("/api/reservas/r8/prorrogar-sinal");
    expect(c.corpo).toEqual({
      novoPrazo: new Date("2026-11-25T10:30").toISOString(),
      motivo: "Cliente pediu",
      supervisor: { login: "sup", senha: "segredo" },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("resolver alerta chama a API e abrir reserva navega", async () => {
    const u = userEvent.setup();
    const p = criarPainel();
    p.atencao = [
      { tipo: "alerta", id: "al1", titulo: "Alerta X", detalhe: "", reservaId: null, contaId: "c1", telefone: null, acoes: ["abrir_conta", "resolver_alerta"] },
      { tipo: "alerta", id: "al2", titulo: "Alerta Y", detalhe: "", reservaId: "r7", contaId: null, telefone: null, acoes: ["abrir_reserva", "resolver_alerta"] },
    ];
    montar(p, { "POST /api/alertas/al1/resolver": { ok: true } });
    const resolver = await screen.findAllByRole("button", { name: "Resolver alerta" });
    await u.click(resolver[0]!);
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST" && c.caminho === "/api/alertas/al1/resolver")).toBe(true));
    await u.click(screen.getByRole("button", { name: "Abrir reserva" }));
    expect(screen.getByTestId("local")).toHaveTextContent("/?reserva=r7");
  });

  test("chegada sem quarto oferece Escolher quarto; FNRH pendente tem prioridade na etiqueta", async () => {
    const u = userEvent.setup();
    montar();
    const lista = (await screen.findByRole("heading", { name: "Chegadas de hoje" })).closest("section")!;
    expect(within(lista).getByText("2 noites · 2 adultos + 1 criança · Balcão")).toBeInTheDocument();
    expect(within(lista).getByText("sinal pago")).toBeInTheDocument();
    expect(within(lista).getByText("sem quarto")).toBeInTheDocument();
    expect(within(lista).getByText("FNRH pendente")).toBeInTheDocument();
    expect(within(lista).queryByText("aguardando sinal")).not.toBeInTheDocument();
    const botoes = within(lista).getAllByRole("button");
    expect(botoes.map((b) => b.textContent)).toEqual(["Check-in", "Escolher quarto", "Check-in"]);
    await u.click(botoes[1]!);
    expect(screen.getByTestId("local")).toHaveTextContent("/?reserva=r2&fluxo=checkin");
  });

  test("chegada já hospedada não tem botão; sinal pendente vira aguardando sinal", async () => {
    const p = criarPainel();
    p.chegadas = [
      { ...p.chegadas[0]!, estado: "hospedada" },
      { ...p.chegadas[1]!, quartoNumero: "105", sinalPendente: 3000, reservaId: "r6", titular: "Hugo" },
    ];
    montar(p);
    const lista = (await screen.findByRole("heading", { name: "Chegadas de hoje" })).closest("section")!;
    expect(within(lista).getByText("hospedada")).toBeInTheDocument();
    expect(within(lista).getByText("aguardando sinal")).toBeInTheDocument();
    expect(within(lista).getAllByRole("button")).toHaveLength(1);
  });

  test("saída mostra saldo formatado e abre o check-out", async () => {
    const u = userEvent.setup();
    montar();
    expect(await screen.findByText("saldo R$ 86,00")).toBeInTheDocument();
    await u.click(screen.getAllByRole("button", { name: "Check-out" })[0]!);
    expect(screen.getByTestId("local")).toHaveTextContent("/?reserva=r4&fluxo=checkout");
  });

  test("governança e próximos dias", async () => {
    montar();
    expect(await screen.findByText("103 sujo")).toBeInTheDocument();
    expect(screen.getByText("106 manutenção · chuveiro")).toBeInTheDocument();
    expect(screen.getByText("Amanhã (21/11)")).toBeInTheDocument();
    expect(screen.getByText("4 chegadas · 2 saídas · ocupação 83%")).toBeInTheDocument();
    expect(screen.getByText("Domingo (22/11)")).toBeInTheDocument();
    expect(screen.getByText("lotado")).toBeInTheDocument();
  });

  test("estados vazios", async () => {
    const p = criarPainel();
    Object.assign(p, { chegadas: [], saidas: [], governanca: [], atencao: [] });
    montar(p);
    expect(await screen.findByText("Nenhuma chegada hoje.")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma saída hoje.")).toBeInTheDocument();
    expect(screen.getByText("Todos os quartos estão limpos.")).toBeInTheDocument();
  });

  test("bloco de atenção some quando a fila está vazia", async () => {
    const p = criarPainel();
    p.atencao = [];
    montar(p);
    await screen.findByText(/ocupação hoje/);
    expect(screen.queryByText(/Precisa da sua atenção/)).not.toBeInTheDocument();
  });

  test("sem permissão para a configuração, omite os horários", async () => {
    montar(criarPainel(), { "GET /api/config": { __status: 403, codigo: "PERMISSAO_NEGADA", mensagem: "Sem permissão." } });
    await screen.findByText(/ocupação hoje/);
    await waitFor(() => expect(chamadas.some((c) => c.caminho === "/api/config")).toBe(true));
    expect(screen.queryByText(/a partir das/)).not.toBeInTheDocument();
  });
});
