import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FluxoChecklist } from "../../src/telas/governanca/checklist/FluxoChecklist";
import { salvarRascunho, lerRascunho } from "../../src/telas/governanca/checklist/rascunho";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const item = (id: string, etapa: string, texto: string, ordem: number) => ({ id, etapa, texto, ordem });
const itens = [
  item("l1", "limpeza", "Pia limpa", 1),
  item("e1", "enxoval", "Toalhas", 1),
  item("q1", "equipamento", "TV", 1),
  item("c1", "controles", "Controle da TV", 1),
];
const produto = { id: "p1", nome: "Água", precoCentavos: 500, codigo: "A", unidade: "un", grupo: "g", tipo: "produto", setores: ["frigobar"] };
const modelos = (extra: object = {}) => ({ saida: itens, diaria: itens, produtosFrigobar: [produto], camareiraLancaFrigobar: false, ...extra });
const gov = { usuario: { permissoes: ["quartos.situacao"] } };
const quarto = { id: "q9", numero: "109" };
type U = ReturnType<typeof userEvent.setup>;

function adiado<T>() {
  let resolver!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolver = r));
  return { promise, resolver };
}

function montar(rotas: Record<string, unknown>, tipo: "saida" | "diaria" = "saida", extra: object = {}, propsExtra: object = {}) {
  instalarApiFalsa({ "GET /api/checklists/modelos": modelos(extra), ...rotas });
  const aoConcluir = vi.fn();
  const aoSair = vi.fn();
  renderizar(
    <FluxoChecklist quarto={quarto} tipo={tipo} situacaoAtual={tipo === "saida" ? "sujo" : "ocupado"} aoConcluir={aoConcluir} aoSair={aoSair} {...propsExtra} />,
    gov,
  );
  return { aoConcluir, aoSair };
}

const grupo = (nome: string) => within(screen.getByRole("group", { name: nome }));
const proxima = async (u: U) => u.click(screen.getByRole("button", { name: "Próxima etapa" }));
const postsDe = (sufixo: string) => chamadas.filter((c) => c.metodo === "POST" && c.caminho.endsWith(sufixo));

/** Responde limpeza e enxoval e chega à etapa Equipamentos. */
async function ateEquipamentos(u: U, limpeza = "Sim") {
  await screen.findByRole("heading", { name: "Limpeza" });
  await u.click(grupo("Pia limpa").getByRole("button", { name: limpeza }));
  await proxima(u);
  await u.click(grupo("Toalhas").getByRole("button", { name: "2" }));
  await proxima(u);
  await screen.findByRole("heading", { name: "Equipamentos" });
}

describe("checklist por etapas", () => {
  test("percorre as etapas da saída e conclui liberado", async () => {
    const u = userEvent.setup();
    const { aoConcluir } = montar({ "POST /api/quartos/q9/checklists": { execucaoId: "x1", totalFrigobar: 0 } });
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
    await proxima(u);
    expect(screen.getByRole("heading", { name: "Controles" })).toBeInTheDocument();
    await u.click(grupo("Controle da TV").getByRole("button", { name: "Presente" }));
    await proxima(u);
    expect(screen.getByRole("heading", { name: "Reposição do frigobar" })).toBeInTheDocument();
    await u.click(grupo("Água").getByRole("button", { name: "3" }));
    await proxima(u);
    expect(screen.getByRole("heading", { name: "Resultado" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Liberado" }));
    expect(screen.getByText(/Reposto no frigobar: 3/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(aoConcluir).toHaveBeenCalled());
    const corpo = postsDe("/checklists")[0]!.corpo as any;
    expect(corpo.tipo).toBe("saida");
    expect(corpo.iniciadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(corpo.respostas).toEqual([
      { itemId: "l1", simNao: true },
      { itemId: "e1", quantidade: 2 },
      { itemId: "q1", equipamento: "funciona" },
      { itemId: "c1", presenca: "presente" },
    ]);
    expect(corpo.frigobar).toEqual([{ produtoId: "p1", quantidade: 3 }]);
    expect(corpo.resultado).toBe("liberado");
    expect(lerRascunho("q9", "saida")).toBeNull();
  });

  test("Liberado desabilitado com limpeza 'Não' e motivo sugerido no bloqueio", async () => {
    const u = userEvent.setup();
    montar({ "POST /api/quartos/q9/chamados": { id: "ch1" } });
    await ateEquipamentos(u, "Não");
    await u.click(grupo("TV").getByRole("button", { name: "Não funciona" }));
    await u.click(screen.getByRole("button", { name: "Abrir chamado" }));
    expect(await screen.findByText("Chamado aberto")).toBeInTheDocument();
    await proxima(u);
    await u.click(grupo("Controle da TV").getByRole("button", { name: "Presente" }));
    await proxima(u);
    await u.click(grupo("Água").getByRole("button", { name: "0" }));
    await proxima(u);
    expect(screen.getByRole("button", { name: "Liberado" })).toBeDisabled();
    expect(screen.getByText("Há itens de limpeza marcados como Não")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Bloqueado" }));
    expect(screen.getByLabelText("Motivo")).toHaveValue("TV não funciona");
  });

  test("Review Focus 1: alternar Não funciona / Funciona deixa só um chamado aberto", async () => {
    const u = userEvent.setup();
    let n = 0;
    montar({
      "POST /api/quartos/q9/chamados": () => ({ id: `ch${++n}` }),
      "POST /api/chamados/ch1/cancelar": { ok: true },
      "POST /api/chamados/ch2/cancelar": { ok: true },
      "POST /api/quartos/q9/checklists": { execucaoId: "x", totalFrigobar: 0 },
    });
    await ateEquipamentos(u);
    const ativarNaoFunciona = async (esperado: number) => {
      await u.click(grupo("TV").getByRole("button", { name: "Não funciona" }));
      await u.click(screen.getByRole("button", { name: "Abrir chamado" }));
      await waitFor(() => expect(postsDe("/chamados")).toHaveLength(esperado));
      await screen.findByText("Chamado aberto");
    };
    const voltarFunciona = async (cancelados: number) => {
      await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
      await u.click(within(screen.getByRole("dialog", { name: "Cancelar o chamado aberto?" })).getByRole("button", { name: "Cancelar chamado" }));
      await waitFor(() => expect(postsDe("/cancelar")).toHaveLength(cancelados));
      await waitFor(() => expect(screen.queryByText("Chamado aberto")).not.toBeInTheDocument());
    };
    await ativarNaoFunciona(1);
    await voltarFunciona(1);
    await ativarNaoFunciona(2);
    await voltarFunciona(2);
    await ativarNaoFunciona(3);
    expect(postsDe("/cancelar").map((c) => c.caminho)).toEqual(["/api/chamados/ch1/cancelar", "/api/chamados/ch2/cancelar"]);
    // Ao concluir, só o chamado ch3 segue ligado à resposta.
    await proxima(u);
    await u.click(grupo("Controle da TV").getByRole("button", { name: "Presente" }));
    await proxima(u);
    await u.click(grupo("Água").getByRole("button", { name: "0" }));
    await proxima(u);
    await u.click(screen.getByRole("button", { name: "Bloqueado" }));
    await u.click(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(postsDe("/checklists")).toHaveLength(1));
    const corpo = postsDe("/checklists")[0]!.corpo as any;
    expect(corpo.respostas.find((r: any) => r.itemId === "q1")).toEqual({ itemId: "q1", equipamento: "nao_funciona", chamadoId: "ch3" });
    expect(corpo.motivo).toBe("TV não funciona");
  });

  test("controle faltando na diária avisa a recepção e desmarcar cancela o aviso", async () => {
    const u = userEvent.setup();
    montar(
      { "POST /api/quartos/q9/avisos-controle": { alertaId: "al1" }, "POST /api/avisos-controle/al1/cancelar": { ok: true } },
      "diaria",
    );
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
    await proxima(u);
    await u.click(grupo("Controle da TV").getByRole("button", { name: "Faltando" }));
    expect(await screen.findByText("Recepção avisada")).toBeInTheDocument();
    expect(chamadas.find((c) => c.caminho.endsWith("/avisos-controle"))?.corpo).toEqual({ itemId: "c1" });
    await u.click(grupo("Controle da TV").getByRole("button", { name: "Presente" }));
    await waitFor(() => expect(screen.queryByText("Recepção avisada")).not.toBeInTheDocument());
    expect(chamadas.some((c) => c.caminho === "/api/avisos-controle/al1/cancelar")).toBe(true);
  });

  test("Review Focus 5: quantidade 50 pede confirmação", async () => {
    const u = userEvent.setup();
    montar({});
    await screen.findByRole("heading", { name: "Limpeza" });
    await u.click(grupo("Pia limpa").getByRole("button", { name: "Sim" }));
    await proxima(u);
    await u.click(grupo("Toalhas").getByRole("button", { name: "+" }));
    await u.type(screen.getByLabelText(/Quantidade/), "50");
    await u.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(screen.getByText("Confirmar 50 unidades?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima etapa" })).toBeDisabled();
    await u.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(screen.queryByText("Confirmar 50 unidades?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima etapa" })).toBeEnabled();
    expect((JSON.parse(localStorage.getItem("erp.checklist.q9.saida")!) as any).respostas.e1.quantidade).toBe(50);
  });

  test("rascunho é salvo a cada resposta", async () => {
    const u = userEvent.setup();
    montar({});
    await screen.findByRole("heading", { name: "Limpeza" });
    await u.click(grupo("Pia limpa").getByRole("button", { name: "Sim" }));
    const salvo = lerRascunho("q9", "saida")!;
    expect(salvo.situacaoQuarto).toBe("sujo");
    expect(salvo.respostas.l1).toEqual({ simNao: true });
    expect(salvo.salvoEm).toBeTruthy();
  });

  test("rascunho é retomado ao reabrir", async () => {
    salvarRascunho("q9", "saida", { execucaoId: "e1", situacaoQuarto: "sujo", iniciadoEm: "2026-10-24T10:00:00.000Z", etapa: "enxoval", respostas: { l1: { simNao: true } }, frigobar: {} });
    montar({});
    expect(await screen.findByRole("heading", { name: "Enxoval recolhido" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(grupo("Pia limpa").getByRole("button", { name: "Sim" })).toHaveAttribute("aria-pressed", "true");
  });

  test("rascunho de outra situação do quarto é descartado com aviso", async () => {
    salvarRascunho("q9", "saida", { execucaoId: "e1", situacaoQuarto: "livre", iniciadoEm: "2026-10-24T10:00:00.000Z", etapa: "enxoval", respostas: { l1: { simNao: true } }, frigobar: {} });
    montar({});
    expect(await screen.findByText("O quarto mudou de situação; o checklist foi reiniciado.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Limpeza" })).toBeInTheDocument();
    expect(grupo("Pia limpa").getByRole("button", { name: "Sim" })).toHaveAttribute("aria-pressed", "false");
  });

  test("Review Focus 3: QUARTO_NAO_OCUPADO na conclusão mantém respostas e mostra a mensagem", async () => {
    const u = userEvent.setup();
    montar(
      { "POST /api/quartos/q9/checklists": { __status: 409, codigo: "QUARTO_NAO_OCUPADO", mensagem: "O quarto 109 não tem hóspede, então não há arrumação a concluir." } },
      "diaria",
    );
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
    await proxima(u);
    await u.click(grupo("Controle da TV").getByRole("button", { name: "Presente" }));
    await u.click(screen.getByRole("button", { name: "Concluir" }));
    expect(await screen.findByText(/não tem hóspede/)).toBeInTheDocument();
    expect(grupo("Controle da TV").getByRole("button", { name: "Presente" })).toHaveAttribute("aria-pressed", "true");
    expect(lerRascunho("q9", "diaria")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Concluir" })).toBeEnabled();
  });

  test("offline: chamado vira pendente e Concluir fica desabilitado", async () => {
    const u = userEvent.setup();
    montar({});
    await ateEquipamentos(u);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("rede");
    });
    await u.click(grupo("TV").getByRole("button", { name: "Não funciona" }));
    await u.click(screen.getByRole("button", { name: "Abrir chamado" }));
    expect(await screen.findByText("Será registrado ao concluir")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(grupo("TV").getByRole("button", { name: "Não funciona" })).toHaveAttribute("aria-pressed", "true");
    await proxima(u);
    await u.click(grupo("Controle da TV").getByRole("button", { name: "Presente" }));
    await proxima(u);
    await u.click(grupo("Água").getByRole("button", { name: "0" }));
    await proxima(u);
    await u.click(screen.getByRole("button", { name: "Bloqueado" }));
    expect(screen.getByRole("button", { name: "Concluir" })).toBeDisabled();
  });

  test("frigobar aparece na diária só com a opção ligada", async () => {
    const u = userEvent.setup();
    montar({}, "diaria", { camareiraLancaFrigobar: false });
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
    await proxima(u);
    await u.click(grupo("Controle da TV").getByRole("button", { name: "Presente" }));
    expect(screen.queryByRole("button", { name: "Próxima etapa" })).not.toBeInTheDocument();
    expect(screen.queryByText("Consumo do hóspede")).not.toBeInTheDocument();
  });

  test("diária com a opção ligada mostra o consumo e o valor lançado na conta", async () => {
    const u = userEvent.setup();
    montar({}, "diaria", { camareiraLancaFrigobar: true });
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
    await proxima(u);
    await u.click(grupo("Controle da TV").getByRole("button", { name: "Presente" }));
    await proxima(u);
    expect(screen.getByRole("heading", { name: "Consumo do hóspede" })).toBeInTheDocument();
    await u.click(grupo("Água").getByRole("button", { name: "2" }));
    expect(screen.getByText("Lançado na conta: R$ 10,00")).toBeInTheDocument();
  });

  test("R7: o chamado leva a observação digitada e o campo trava depois de aberto", async () => {
    const u = userEvent.setup();
    montar({ "POST /api/quartos/q9/chamados": { id: "ch1" } });
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Não funciona" }));
    expect(postsDe("/chamados")).toHaveLength(0);
    await u.type(screen.getByLabelText("O que aconteceu? (opcional)"), "Sem imagem");
    await u.click(screen.getByRole("button", { name: "Abrir chamado" }));
    expect(await screen.findByText("Chamado aberto")).toBeInTheDocument();
    expect(postsDe("/chamados")[0]!.corpo).toEqual({ itemId: "q1", observacao: "Sem imagem" });
    expect(screen.getByLabelText("O que aconteceu? (opcional)")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Abrir chamado" })).not.toBeInTheDocument();
  });

  test("R7: sair da etapa abre sozinho o chamado pendente", async () => {
    const u = userEvent.setup();
    montar({ "POST /api/quartos/q9/chamados": { id: "ch1" } });
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Não funciona" }));
    await u.type(screen.getByLabelText("O que aconteceu? (opcional)"), "Quebrada");
    await proxima(u);
    expect(await screen.findByRole("heading", { name: "Controles" })).toBeInTheDocument();
    expect(postsDe("/chamados")).toHaveLength(1);
    expect(postsDe("/chamados")[0]!.corpo).toEqual({ itemId: "q1", observacao: "Quebrada" });
    await u.click(screen.getByRole("button", { name: "Voltar" }));
    expect(await screen.findByText("Chamado aberto")).toBeInTheDocument();
  });

  test("R7: Faltando na saída também pede a observação e abre chamado", async () => {
    const u = userEvent.setup();
    montar({ "POST /api/quartos/q9/chamados": { id: "ch1" } });
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
    await proxima(u);
    await u.click(grupo("Controle da TV").getByRole("button", { name: "Faltando" }));
    await u.type(screen.getByLabelText("O que aconteceu? (opcional)"), "Sumiu");
    await u.click(screen.getByRole("button", { name: "Abrir chamado" }));
    await screen.findByText("Chamado aberto");
    expect(postsDe("/chamados")[0]!.corpo).toEqual({ itemId: "c1", observacao: "Sumiu" });
  });

  test("Review Focus 1: toques enquanto o chamado está sendo aberto são ignorados", async () => {
    const u = userEvent.setup();
    const d = adiado<{ id: string }>();
    montar({ "POST /api/quartos/q9/chamados": () => d.promise });
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Não funciona" }));
    await u.click(screen.getByRole("button", { name: "Abrir chamado" }));
    await waitFor(() => expect(postsDe("/chamados")).toHaveLength(1));
    expect(grupo("TV").getByRole("button", { name: "Funciona" })).toBeDisabled();
    expect(grupo("TV").getByRole("button", { name: "Não funciona" })).toBeDisabled();
    await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
    await u.click(grupo("TV").getByRole("button", { name: "Não funciona" }));
    expect(postsDe("/chamados")).toHaveLength(1);
    expect(postsDe("/cancelar")).toHaveLength(0);
    d.resolver({ id: "ch1" });
    expect(await screen.findByText("Chamado aberto")).toBeInTheDocument();
    expect(grupo("TV").getByRole("button", { name: "Não funciona" })).toHaveAttribute("aria-pressed", "true");
    expect(lerRascunho("q9", "saida")!.respostas.q1).toMatchObject({ equipamento: "nao_funciona", chamadoId: "ch1" });
  });

  test("Review Focus 1: toques enquanto o cancelamento está pendente são ignorados", async () => {
    const u = userEvent.setup();
    const d = adiado<{ ok: boolean }>();
    montar({ "POST /api/quartos/q9/chamados": { id: "ch1" }, "POST /api/chamados/ch1/cancelar": () => d.promise });
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Não funciona" }));
    await u.click(screen.getByRole("button", { name: "Abrir chamado" }));
    await screen.findByText("Chamado aberto");
    await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
    await u.click(within(screen.getByRole("dialog", { name: "Cancelar o chamado aberto?" })).getByRole("button", { name: "Cancelar chamado" }));
    await waitFor(() => expect(postsDe("/cancelar")).toHaveLength(1));
    expect(grupo("TV").getByRole("button", { name: "Não funciona" })).toBeDisabled();
    await u.click(grupo("TV").getByRole("button", { name: "Não funciona" }));
    expect(postsDe("/chamados")).toHaveLength(1);
    expect(postsDe("/cancelar")).toHaveLength(1);
    d.resolver({ ok: true });
    await waitFor(() => expect(grupo("TV").getByRole("button", { name: "Funciona" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByText("Chamado aberto")).not.toBeInTheDocument();
    expect(lerRascunho("q9", "saida")!.respostas.q1?.chamadoId).toBeUndefined();
  });

  test("Liberado impedido depois de escolhido zera o resultado; motivo sugerido acompanha os equipamentos", async () => {
    const u = userEvent.setup();
    montar({ "POST /api/quartos/q9/chamados": { id: "ch1" } });
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
    await proxima(u);
    await u.click(grupo("Controle da TV").getByRole("button", { name: "Presente" }));
    await proxima(u);
    await u.click(grupo("Água").getByRole("button", { name: "0" }));
    await proxima(u);
    await u.click(screen.getByRole("button", { name: "Liberado" }));
    expect(lerRascunho("q9", "saida")!.resultado).toBe("liberado");
    await u.click(screen.getByRole("button", { name: "Voltar" }));
    await u.click(screen.getByRole("button", { name: "Voltar" }));
    await u.click(screen.getByRole("button", { name: "Voltar" }));
    await u.click(grupo("TV").getByRole("button", { name: "Não funciona" }));
    await waitFor(() => expect(lerRascunho("q9", "saida")!.resultado).toBeUndefined());
    for (let i = 0; i < 3; i++) await proxima(u);
    await u.click(screen.getByRole("button", { name: "Bloqueado" }));
    expect(screen.getByLabelText("Motivo")).toHaveValue("TV não funciona");
    await u.type(screen.getByLabelText("Motivo"), " e riscada");
    expect(screen.getByLabelText("Motivo")).toHaveValue("TV não funciona e riscada");
  });
});

describe("correções da revisão final", () => {
  test("I2: o execucaoId nasce com o rascunho e é reenviado igual depois de uma falha", async () => {
    const u = userEvent.setup();
    let n = 0;
    montar({ "POST /api/quartos/q9/checklists": () => (++n === 1 ? { __status: 500, codigo: "ERRO", mensagem: "Falhou" } : { execucaoId: "x", totalFrigobar: 0 }) }, "diaria");
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
    await proxima(u);
    await u.click(grupo("Controle da TV").getByRole("button", { name: "Presente" }));
    const idRascunho = lerRascunho("q9", "diaria")!.execucaoId;
    expect(idRascunho).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Concluir" }));
    await screen.findByText("Falhou");
    await u.click(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(postsDe("/checklists")).toHaveLength(2));
    const ids = postsDe("/checklists").map((c) => (c.corpo as any).execucaoId);
    expect(ids).toEqual([idRascunho, idRascunho]);
  });

  test("I3: chamado aberto por outra pessoa só é desvinculado ao voltar para Funciona (sem /cancelar nem confirmação)", async () => {
    const u = userEvent.setup();
    montar({ "POST /api/quartos/q9/chamados": { id: "ch1", abertoPor: "outra-pessoa" } });
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Não funciona" }));
    await u.click(screen.getByRole("button", { name: "Abrir chamado" }));
    await screen.findByText("Chamado aberto");
    await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
    await waitFor(() => expect(screen.queryByText("Chamado aberto")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(postsDe("/cancelar")).toHaveLength(0);
    expect(grupo("TV").getByRole("button", { name: "Funciona" })).toHaveAttribute("aria-pressed", "true");
    expect(lerRascunho("q9", "saida")!.respostas.q1?.chamadoId).toBeUndefined();
  });

  test("I3: sem conexão, mudar a resposta de um item com chamado desvincula localmente em vez de falhar", async () => {
    const u = userEvent.setup();
    montar({ "POST /api/quartos/q9/chamados": { id: "ch1", abertoPor: "u1" } });
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Não funciona" }));
    await u.click(screen.getByRole("button", { name: "Abrir chamado" }));
    await screen.findByText("Chamado aberto");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("rede");
    });
    await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
    const dialogo = screen.queryByRole("dialog", { name: "Cancelar o chamado aberto?" });
    if (dialogo) await u.click(within(dialogo).getByRole("button", { name: "Cancelar chamado" }));
    await waitFor(() => expect(grupo("TV").getByRole("button", { name: "Funciona" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(lerRascunho("q9", "saida")!.respostas.q1?.chamadoId).toBeUndefined();
  });

  test("Liberado fica desabilitado quando o quarto já tem chamado de defeito aberto", async () => {
    const u = userEvent.setup();
    montar({}, "saida", {}, { defeitosAbertos: 1 });
    await ateEquipamentos(u);
    await u.click(grupo("TV").getByRole("button", { name: "Funciona" }));
    await proxima(u);
    await u.click(grupo("Controle da TV").getByRole("button", { name: "Presente" }));
    await proxima(u);
    await u.click(grupo("Água").getByRole("button", { name: "0" }));
    await proxima(u);
    expect(screen.getByRole("button", { name: "Liberado" })).toBeDisabled();
    expect(screen.getByText("Há chamado de defeito aberto")).toBeInTheDocument();
  });

  test("Enter no campo Quantidade aplica o valor", async () => {
    const u = userEvent.setup();
    montar({});
    await screen.findByRole("heading", { name: "Limpeza" });
    await u.click(grupo("Pia limpa").getByRole("button", { name: "Sim" }));
    await proxima(u);
    await u.click(grupo("Toalhas").getByRole("button", { name: "+" }));
    await u.type(screen.getByLabelText(/Quantidade/), "7{Enter}");
    expect(lerRascunho("q9", "saida")!.respostas.e1.quantidade).toBe(7);
  });
});
