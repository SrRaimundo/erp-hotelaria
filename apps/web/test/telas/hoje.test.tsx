import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Painel } from "../../src/api/tipos";
import { TelaHoje } from "../../src/telas/hoje/TelaHoje";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";

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

  test("chegada sem quarto oferece Escolher quarto; FNRH pendente aparece com o sinal pendente", async () => {
    const u = userEvent.setup();
    montar();
    const lista = (await screen.findByRole("heading", { name: "Chegadas de hoje" })).closest("section")!;
    expect(within(lista).getByText("2 noites · 2 adultos + 1 criança · Balcão")).toBeInTheDocument();
    expect(within(lista).getByText("sinal pago")).toBeInTheDocument();
    expect(within(lista).getByText("sem quarto")).toBeInTheDocument();
    expect(within(lista).getByText("FNRH pendente")).toBeInTheDocument();
    // r3 tem FNRH pendente e sinal pendente: as duas etiquetas aparecem
    expect(within(lista).getByText("aguardando sinal")).toBeInTheDocument();
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

  test("ocupados por canal: total, canais na ordem do servidor, proporção e posição depois dos próximos dias", async () => {
    montar(criarPainel({ ocupadosPorCanal: [{ canal: "Booking", quartos: 5 }, { canal: "Decolar", quartos: 3 }, { canal: "Sem canal", quartos: 2 }] }));
    const bloco = (await screen.findByRole("heading", { name: "Ocupados por canal" })).closest("section")!;
    expect(within(bloco).getByText("10 ocupados")).toBeInTheDocument();
    const itens = within(bloco).getAllByRole("listitem");
    expect(itens.map((i) => i.textContent)).toEqual(["Booking5", "Decolar3", "Sem canal2"]);
    expect(itens[0]!.querySelector<HTMLElement>(".hoje-canal__preenchimento")!.style.width).toBe("50%");
    expect(itens[2]!.querySelector<HTMLElement>(".hoje-canal__preenchimento")!.style.width).toBe("20%");
    const titulos = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titulos.indexOf("Ocupados por canal")).toBeGreaterThan(titulos.indexOf("Próximos dias"));
  });

  test("ocupados por canal fica oculto sem hospedados", async () => {
    montar(criarPainel({ ocupadosPorCanal: [] }));
    await screen.findByRole("heading", { name: "Próximos dias" });
    expect(screen.queryByRole("heading", { name: "Ocupados por canal" })).not.toBeInTheDocument();
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

  test("enquanto carrega mostra Carregando…", async () => {
    montar();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    await screen.findByText(/ocupação hoje/);
  });

  test("sem dados e com erro mostra a mensagem do servidor no lugar da tela", async () => {
    montar(criarPainel(), { "GET /api/painel": { __status: 500, codigo: "ERRO", mensagem: "Falha ao montar o painel." } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao montar o painel.");
    expect(screen.queryByText(/ocupação hoje/)).not.toBeInTheDocument();
  });

  test("erro numa nova consulta mantém a tela com os dados em cache", async () => {
    const { cliente } = montar();
    await screen.findByText(/ocupação hoje/);
    instalarApiFalsa({ "GET /api/painel": { __status: 500, codigo: "ERRO", mensagem: "Servidor caiu." } });
    await act(async () => {
      await cliente.invalidateQueries({ queryKey: ["painel"] });
    });
    await waitFor(() => expect(chamadas.some((c) => c.caminho === "/api/painel")).toBe(true));
    expect(screen.getByText(/ocupação hoje: 9 de 12/)).toBeInTheDocument();
    expect(screen.queryByText("Servidor caiu.")).not.toBeInTheDocument();
  });

  test("Resolver alerta fica desabilitado enquanto a requisição está pendente", async () => {
    const u = userEvent.setup();
    let liberar!: () => void;
    const p = criarPainel();
    p.atencao = [{ tipo: "alerta", id: "al1", titulo: "Alerta X", detalhe: "", reservaId: null, contaId: "c1", telefone: null, acoes: ["resolver_alerta"] }];
    montar(p, { "POST /api/alertas/al1/resolver": () => ({ ok: true }) });
    const original = globalThis.fetch;
    const espera = new Promise<void>((r) => (liberar = r));
    vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).includes("/resolver")) await espera;
      return original(...args);
    });
    const botao = await screen.findByRole("button", { name: "Resolver alerta" });
    await u.click(botao);
    expect(screen.getByRole("button", { name: "Resolver alerta" })).toBeDisabled();
    await act(async () => liberar());
  });

  test("I5: chegada em pré-reserva oferece Registrar sinal (não Check-in) e abre a conta com o valor", async () => {
    const u = userEvent.setup();
    const p = criarPainel();
    p.chegadas = [{ ...p.chegadas[0]!, estado: "pre_reserva", reservaId: "r11", titular: "Ivo", sinalPendente: 27000, pendenciasFnrh: false }];
    montar(p);
    const lista = (await screen.findByRole("heading", { name: "Chegadas de hoje" })).closest("section")!;
    expect(within(lista).queryByRole("button", { name: "Check-in" })).not.toBeInTheDocument();
    await u.click(within(lista).getByRole("button", { name: "Registrar sinal" }));
    expect(screen.getByTestId("local")).toHaveTextContent("/?reserva=r11&aba=conta&receber=27000");
  });

  test("I5: FNRH pendente e sinal pendente mostram as duas etiquetas", async () => {
    const p = criarPainel();
    p.chegadas = [{ ...p.chegadas[0]!, estado: "pre_reserva", sinalPendente: 5000, pendenciasFnrh: true }];
    montar(p);
    const lista = (await screen.findByRole("heading", { name: "Chegadas de hoje" })).closest("section")!;
    expect(within(lista).getByText("FNRH pendente")).toBeInTheDocument();
    expect(within(lista).getByText("aguardando sinal")).toBeInTheDocument();
  });

  test("I4: saída vencida aparece na atenção com o detalhe e abre a reserva", async () => {
    const u = userEvent.setup();
    const p = criarPainel();
    p.atencao = [{ tipo: "saida_vencida", id: "saida-vencida:r12", titulo: "Saída vencida", detalhe: "Reserva #12 · Jão · saída prevista 18/11, qto 204", reservaId: "r12", contaId: null, telefone: null, acoes: ["abrir_reserva"] }];
    const { container } = montar(p);
    expect(await screen.findByText("Saída vencida")).toBeInTheDocument();
    expect(screen.getByText("Reserva #12 · Jão · saída prevista 18/11, qto 204")).toBeInTheDocument();
    expect(container.querySelector(".hoje-atencao__item--saida_vencida")).not.toBeNull();
    await u.click(screen.getByRole("button", { name: "Abrir reserva" }));
    expect(screen.getByTestId("local")).toHaveTextContent("/?reserva=r12");
  });

  describe("chamados abertos", () => {
    const chamado = (extras: Record<string, unknown> = {}) => ({
      id: "ch1", quartoId: "q101", quartoNumero: "101", itemId: null, tipo: "defeito", descricao: "Ar-condicionado", observacao: "Pingando",
      situacao: "aberto", abertoPor: "u9", abertoPorNome: "Rita", abertoEm: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      encerradoPor: null, encerradoEm: null, observacaoEncerramento: null, ...extras,
    });
    const gerente = { permissoes: ["reservas.gerenciar", "quartos.manutencao"] };
    const montarComChamados = (rotas: Record<string, unknown>, usuario: Record<string, unknown> = gerente) => {
      instalarApiFalsa({
        "GET /api/painel": criarPainel({ chamadosAbertos: [chamado() as never, chamado({ id: "ch2", tipo: "reposicao", descricao: "Toalha", observacao: null, quartoNumero: "102", quartoId: "q102", abertoEm: new Date(Date.now() - 20 * 60_000).toISOString() }) as never] }),
        "GET /api/config": { horaCheckin: "14:00", horaCheckout: "12:00" },
        ...rotas,
      });
      return renderizar(<TelaHoje />, { usuario });
    };

    test("chamados abertos com Resolvido e depois Liberar quarto", async () => {
      const u = userEvent.setup();
      montarComChamados({
        "POST /api/chamados/ch1/resolver": { podeLiberar: true },
        "POST /api/quartos/q101/liberar": { ok: true },
      });
      expect(await screen.findByRole("heading", { name: "Chamados abertos (2)" })).toBeInTheDocument();
      expect(screen.getByText("Defeito · Qto 101 · Ar-condicionado")).toBeInTheDocument();
      expect(screen.getByText("Pingando")).toBeInTheDocument();
      expect(screen.getByText("por Rita há 2 h")).toBeInTheDocument();
      expect(screen.getByText("Reposição · Qto 102 · Toalha")).toBeInTheDocument();
      expect(screen.getByText("por Rita há 20 min")).toBeInTheDocument();

      await u.click(screen.getAllByRole("button", { name: "Resolvido" })[0]!);
      const janela = screen.getByRole("dialog");
      await u.type(within(janela).getByLabelText("Observação (opcional)"), "Trocado o dreno");
      await u.click(within(janela).getByRole("button", { name: "Confirmar" }));
      await waitFor(() => expect(chamadas.find((c) => c.caminho === "/api/chamados/ch1/resolver")?.corpo).toMatchObject({ observacao: "Trocado o dreno" }));

      await u.click(await screen.findByRole("button", { name: "Liberar quarto" }));
      const liberar = screen.getByRole("dialog");
      expect(within(liberar).getByLabelText("Motivo")).toHaveValue("Liberado após resolução do chamado");
      await u.click(within(liberar).getByRole("button", { name: "Confirmar" }));
      await waitFor(() => expect(chamadas.find((c) => c.caminho === "/api/quartos/q101/liberar")?.corpo).toEqual({ motivo: "Liberado após resolução do chamado" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Liberar quarto" })).not.toBeInTheDocument());
    });

    test("sem permissão de manutenção o bloco não aparece", async () => {
      montarComChamados({}, { permissoes: ["reservas.gerenciar"] });
      await screen.findByText(/ocupação hoje/);
      expect(screen.queryByText(/Chamados abertos/)).not.toBeInTheDocument();
    });

    test("governança agora mostra bloqueado com motivo e ocupados sem arrumação", async () => {
      const base = criarPainel();
      montar(criarPainel({ numeros: { ...base.numeros, ocupadosSemArrumacao: 3 }, governanca: [{ quartoId: "q9", numero: "109", situacao: "bloqueado", motivo: "Chamado aberto" }] }));
      expect(await screen.findByText("109 bloqueado · Chamado aberto")).toBeInTheDocument();
      expect(screen.getByText("3 ocupados sem arrumação hoje")).toBeInTheDocument();
    });
  });
});
