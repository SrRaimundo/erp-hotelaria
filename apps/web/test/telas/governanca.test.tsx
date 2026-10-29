import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { lerRascunho, salvarRascunho } from "../../src/telas/governanca/checklist/rascunho";
import { TelaGovernanca } from "../../src/telas/governanca/TelaGovernanca";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const base = { tarefa: null, arrumadoHojeEm: null, motivoBloqueio: null, chamadosAbertos: 0, defeitosAbertos: 0, reservaId: null, situacaoDesde: null };
const lista = [
  { ...base, quartoId: "q3", numero: "103", situacao: "sujo", tarefa: "limpeza_saida", situacaoDesde: "2026-10-24T08:00:00.000Z" },
  { ...base, quartoId: "q5", numero: "105", situacao: "ocupado", hospedadoAte: "2026-10-26", tarefa: "arrumacao", reservaId: "r5" },
  { ...base, quartoId: "q2", numero: "102", situacao: "ocupado", hospedadoAte: "2026-10-25", arrumadoHojeEm: "2026-10-24T14:05:00.000Z" },
  { ...base, quartoId: "q4", numero: "104", situacao: "bloqueado", motivoBloqueio: "Vazamento", chamadosAbertos: 2 },
  { ...base, quartoId: "q1", numero: "101", situacao: "livre" },
];
const modelosFalsos = { saida: [], diaria: [{ id: "l1", etapa: "limpeza", texto: "Pia limpa", ordem: 1 }], produtosFrigobar: [], camareiraLancaFrigobar: false };
const gov = { usuario: { permissoes: ["quartos.situacao"] } };
const gerente = { usuario: { permissoes: ["quartos.situacao", "quartos.manutencao"] } };

describe("governança", () => {
  test("mostra número, situação e hospedado até; sem menu para quem não tem manutenção", async () => {
    instalarApiFalsa({ "GET /api/governanca": lista });
    renderizar(<TelaGovernanca />, gov);
    expect(await screen.findByText("103")).toBeInTheDocument();
    expect(screen.getByText("hospedado até 25/10")).toBeInTheDocument();
    expect(screen.getByText("bloqueado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ações do quarto/ })).not.toBeInTheDocument();
  });

  test("cartões mostram a tarefa de cada quarto", async () => {
    instalarApiFalsa({ "GET /api/governanca": lista });
    renderizar(<TelaGovernanca />, gov);
    expect(await screen.findByText("Limpeza de saída")).toBeInTheDocument();
    expect(screen.getByText("Arrumação")).toBeInTheDocument();
    const hora = new Date("2026-10-24T14:05:00.000Z");
    const hhmm = `${String(hora.getHours()).padStart(2, "0")}:${String(hora.getMinutes()).padStart(2, "0")}`;
    expect(screen.getByText(`Arrumado às ${hhmm}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nova arrumação/ })).toBeInTheDocument();
    expect(screen.getByText("Bloqueado: Vazamento · 2 chamados")).toBeInTheDocument();
  });

  test("bloqueado com um chamado usa o singular e sem chamados omite a contagem", async () => {
    instalarApiFalsa({
      "GET /api/governanca": [
        { ...base, quartoId: "q4", numero: "104", situacao: "bloqueado", motivoBloqueio: "Vazamento", chamadosAbertos: 1 },
        { ...base, quartoId: "q6", numero: "106", situacao: "bloqueado", motivoBloqueio: "Reforma" },
      ],
    });
    renderizar(<TelaGovernanca />, gov);
    expect(await screen.findByText("Bloqueado: Vazamento · 1 chamado")).toBeInTheDocument();
    expect(screen.getByText("Bloqueado: Reforma")).toBeInTheDocument();
  });

  test("tocar no sujo abre a limpeza de saída; no ocupado, a arrumação", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/governanca": lista, "GET /api/checklists/modelos": modelosFalsos });
    renderizar(<TelaGovernanca />, gov);
    await u.click(await screen.findByRole("button", { name: /103/ }));
    expect(await screen.findByText("Quarto 103 · Limpeza de saída")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Governança" })).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Sair" }));
    await u.click(await screen.findByRole("button", { name: /105/ }));
    expect(await screen.findByText("Quarto 105 · Arrumação")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Sair" }));
    await u.click(await screen.findByRole("button", { name: /Nova arrumação/ }));
    expect(await screen.findByText("Quarto 102 · Arrumação")).toBeInTheDocument();
  });

  test("ao concluir volta à lista com a mensagem de checklist concluído", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/governanca": lista,
      "GET /api/checklists/modelos": modelosFalsos,
      "POST /api/quartos/q5/checklists": { execucaoId: "x", totalFrigobar: 0 },
    });
    renderizar(<TelaGovernanca />, gov);
    await u.click(await screen.findByRole("button", { name: /105/ }));
    await u.click(await screen.findByRole("button", { name: "Sim" }));
    await u.click(screen.getByRole("button", { name: "Concluir" }));
    expect(await screen.findByText("Checklist concluído · Qto 105")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Governança" })).toBeInTheDocument();
  });

  test("o rascunho é retomado conforme a situação do quarto (sujo na saída, ocupado na diária) e sobrevive a Sair", async () => {
    const u = userEvent.setup();
    localStorage.clear();
    const itens = [
      { id: "l1", etapa: "limpeza", texto: "Pia limpa", ordem: 1 },
      { id: "e1", etapa: "enxoval", texto: "Toalhas", ordem: 1 },
    ];
    const rascunho = (situacaoQuarto: string, extra: object) => ({ situacaoQuarto, iniciadoEm: "2026-10-24T10:00:00.000Z", etapa: "enxoval", respostas: { l1: { simNao: true } }, frigobar: {}, execucaoId: "e1", ...extra });
    salvarRascunho("q3", "saida", rascunho("sujo", { situacaoDesde: "2026-10-24T08:00:00.000Z" }));
    salvarRascunho("q5", "diaria", rascunho("ocupado", { reservaId: "r5" }));
    instalarApiFalsa({ "GET /api/governanca": lista, "GET /api/checklists/modelos": { saida: itens, diaria: itens, produtosFrigobar: [], camareiraLancaFrigobar: false } });
    renderizar(<TelaGovernanca />, gov);
    for (let vez = 0; vez < 2; vez++) {
      await u.click(await screen.findByRole("button", { name: /^103/ }));
      expect(await screen.findByRole("heading", { name: "Enxoval recolhido" })).toBeInTheDocument();
      expect(screen.queryByText(/foi reiniciado/)).not.toBeInTheDocument();
      await u.click(screen.getByRole("button", { name: "Sair" }));
      await u.click(await screen.findByRole("button", { name: /^105/ }));
      expect(await screen.findByRole("heading", { name: "Enxoval recolhido" })).toBeInTheDocument();
      expect(screen.queryByText(/foi reiniciado/)).not.toBeInTheDocument();
      await u.click(screen.getByRole("button", { name: "Sair" }));
    }
  });

  test("I1: rascunho de arrumação de outra reserva do mesmo quarto é descartado", async () => {
    const u = userEvent.setup();
    const itens = [{ id: "l1", etapa: "limpeza", texto: "Pia limpa", ordem: 1 }, { id: "e1", etapa: "enxoval", texto: "Toalhas", ordem: 1 }];
    salvarRascunho("q5", "diaria", { situacaoQuarto: "ocupado", reservaId: "r-anterior", execucaoId: "e1", iniciadoEm: "2026-10-24T10:00:00.000Z", etapa: "enxoval", respostas: { l1: { simNao: true } }, frigobar: {} });
    instalarApiFalsa({ "GET /api/governanca": lista, "GET /api/checklists/modelos": { saida: itens, diaria: itens, produtosFrigobar: [], camareiraLancaFrigobar: false } });
    renderizar(<TelaGovernanca />, gov);
    await u.click(await screen.findByRole("button", { name: /^105/ }));
    expect(await screen.findByText("O quarto mudou de situação; o checklist foi reiniciado.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Limpeza" })).toBeInTheDocument();
  });

  test("I1: rascunho de saída de um período sujo anterior é descartado", async () => {
    const u = userEvent.setup();
    const itens = [{ id: "l1", etapa: "limpeza", texto: "Pia limpa", ordem: 1 }, { id: "e1", etapa: "enxoval", texto: "Toalhas", ordem: 1 }];
    salvarRascunho("q3", "saida", { situacaoQuarto: "sujo", situacaoDesde: "2026-10-20T08:00:00.000Z", execucaoId: "e1", iniciadoEm: "2026-10-20T10:00:00.000Z", etapa: "enxoval", respostas: { l1: { simNao: true } }, frigobar: {} });
    instalarApiFalsa({ "GET /api/governanca": lista, "GET /api/checklists/modelos": { saida: itens, diaria: itens, produtosFrigobar: [], camareiraLancaFrigobar: false } });
    renderizar(<TelaGovernanca />, gov);
    await u.click(await screen.findByRole("button", { name: /^103/ }));
    expect(await screen.findByText("O quarto mudou de situação; o checklist foi reiniciado.")).toBeInTheDocument();
  });

  test("I1: abrir e sair sem responder não deixa rascunho", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/governanca": lista, "GET /api/checklists/modelos": modelosFalsos });
    renderizar(<TelaGovernanca />, gov);
    await u.click(await screen.findByRole("button", { name: /^105/ }));
    await screen.findByText("Quarto 105 · Arrumação");
    await u.click(screen.getByRole("button", { name: "Sair" }));
    expect(lerRascunho("q5", "diaria")).toBeNull();
  });

  test("não existe mais 'Marcar como limpo'", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/governanca": lista, "GET /api/checklists/modelos": modelosFalsos });
    renderizar(<TelaGovernanca />, gerente);
    await u.click(await screen.findByRole("button", { name: /^103/ }));
    expect(screen.queryByText(/marcar .* como limpo/i)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("liberar com defeito aberto mostra CHAMADO_ABERTO", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/governanca": lista,
      "POST /api/quartos/q4/liberar": { __status: 409, codigo: "CHAMADO_ABERTO", mensagem: "Há chamado de defeito aberto neste quarto." },
    });
    renderizar(<TelaGovernanca />, gerente);
    await screen.findByText("103");
    await u.click(screen.getByRole("button", { name: "Ações do quarto 104" }));
    await u.click(screen.getByRole("menuitem", { name: "Liberar" }));
    const janela = screen.getByRole("dialog");
    await u.type(within(janela).getByLabelText("Motivo"), "Consertado");
    await u.click(within(janela).getByRole("button", { name: "Confirmar" }));
    expect(await within(janela).findByRole("alert")).toHaveTextContent("Há chamado de defeito aberto neste quarto.");
  });

  test("quarto livre não é acionável para limpo", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/governanca": lista });
    renderizar(<TelaGovernanca />, gov);
    await screen.findByText("103");
    await u.click(screen.getByText("101"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("menu oferece só transições válidas", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/governanca": lista });
    renderizar(<TelaGovernanca />, gerente);
    await screen.findByText("103");
    await u.click(screen.getByRole("button", { name: "Ações do quarto 101" }));
    expect(screen.getByRole("menuitem", { name: "Manutenção" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Bloquear" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Liberar" })).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Ações do quarto 104" }));
    expect(screen.getByRole("menuitem", { name: "Liberar" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Bloquear" })).not.toBeInTheDocument();
  });

  test("motivo obrigatório para manutenção", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/governanca": lista, "POST /api/quartos/q1/manutencao": { ok: true } });
    renderizar(<TelaGovernanca />, gerente);
    await screen.findByText("103");
    await u.click(screen.getByRole("button", { name: "Ações do quarto 101" }));
    await u.click(screen.getByRole("menuitem", { name: "Manutenção" }));
    const janela = screen.getByRole("dialog");
    await u.click(within(janela).getByRole("button", { name: "Confirmar" }));
    expect(await within(janela).findByRole("alert")).toHaveTextContent("Informe o motivo.");
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);
    await u.type(within(janela).getByLabelText("Motivo"), "Ar-condicionado");
    await u.click(within(janela).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(chamadas.find((c) => c.metodo === "POST")?.corpo).toEqual({ motivo: "Ar-condicionado" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("I3: o menu das ações fecha com Esc", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/governanca": lista });
    renderizar(<TelaGovernanca />, gerente);
    await screen.findByText("103");
    await u.click(screen.getByRole("button", { name: "Ações do quarto 101" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("I3: o menu das ações fecha ao clicar fora, mas não ao clicar no próprio menu", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/governanca": lista });
    renderizar(<TelaGovernanca />, gerente);
    await screen.findByText("103");
    await u.click(screen.getByRole("button", { name: "Ações do quarto 101" }));
    await u.click(screen.getByRole("heading", { name: "Governança" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Ações do quarto 101" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Ações do quarto 101" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("I3: só os cartões com botão ⋯ reservam espaço à direita", async () => {
    instalarApiFalsa({ "GET /api/governanca": lista });
    const { container } = renderizar(<TelaGovernanca />, gerente);
    await screen.findByText("103");
    // 101 (livre), 103 (sujo) e 104 (bloqueado) têm menu; 102 e 105 (ocupados) não.
    const comMenu = Array.from(container.querySelectorAll(".governanca__cartao--com-menu")).map((e) => e.textContent);
    expect(comMenu.some((t) => t?.includes("102"))).toBe(false);
    expect(comMenu).toHaveLength(3);
  });
});
