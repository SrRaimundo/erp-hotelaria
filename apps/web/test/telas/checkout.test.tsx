import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { LinhaExtrato } from "../../src/api/tipos";
import { GavetaReserva } from "../../src/telas/reserva/GavetaReserva";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";
import { criarReserva } from "../fixtures/reserva";

function Local() {
  const l = useLocation();
  return <output data-testid="local">{l.pathname + l.search}</output>;
}

const linha = (o: Partial<LinhaExtrato>): LinhaExtrato => ({
  id: "l1", natureza: "debito", tipo: "diaria", origem: "hospedagem", descricao: "Diária 20/11", valor: 90000,
  instante: "2026-11-20T14:00:00.000Z", data: "2026-11-20", estornaId: null, reservaId: "r1", setor: "hospedagem", ...o,
});

const extrato: LinhaExtrato[] = [
  linha({}),
  linha({ id: "l2", tipo: "extra", descricao: "Frigobar", valor: 5000 }),
];
const formas = [
  { id: "f1", codigo: "dinheiro", nome: "Dinheiro", ativa: true },
  { id: "f2", codigo: "pix", nome: "PIX", ativa: true },
  { id: "f3", codigo: "credito", nome: "Cartão de crédito", ativa: true },
  { id: "f4", codigo: "debito", nome: "Cartão de débito", ativa: false },
  { id: "f5", codigo: "faturado", nome: "Faturado", ativa: true },
];
const caixa = { turno: { id: "t1", usuarioId: "u1", abertoEm: "2026-11-20T08:00:00.000Z", valorInicial: 10000, fechadoEm: null }, movimentos: [], esperadoPorForma: {} };
const previa = (o: object = {}) => ({ extrato, saldo: 95000, saidaAntecipada: false, exigeQuitacao: true, ...o });

function montar(extras: Record<string, unknown> = {}) {
  instalarApiFalsa({
    "GET /api/painel": criarPainel(),
    "GET /api/reservas/r1": criarReserva(),
    "GET /api/reservas/r1/checkout": previa(),
    "GET /api/formas-pagamento": formas,
    "GET /api/caixa/atual": caixa,
    ...extras,
  });
  return renderizar(<><GavetaReserva /><Local /></>, { rota: "/mapa?reserva=r1&fluxo=checkout" });
}

afterEach(() => vi.unstubAllGlobals());

const postou = () => chamadas.filter((c) => c.metodo === "POST" && c.caminho === "/api/reservas/r1/checkout");
const botao = () => screen.getByRole("button", { name: "Concluir check-out" });

async function digitar(usuario: ReturnType<typeof userEvent.setup>, rotulo: string, texto: string) {
  const campo = await screen.findByLabelText(rotulo);
  await usuario.clear(campo);
  await usuario.type(campo, texto);
}

/** pix 500,00 + crédito 450,00 */
async function dividir(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.selectOptions(await screen.findByLabelText("Forma de pagamento 1"), "pix");
  await digitar(usuario, "Valor da forma 1", "500,00");
  await usuario.click(screen.getByRole("button", { name: "+ outra forma" }));
  await usuario.selectOptions(screen.getByLabelText("Forma de pagamento 2"), "credito");
  await digitar(usuario, "Valor da forma 2", "450,00");
}

describe("fluxo de check-out", () => {
  test("mostra o extrato da prévia e começa com uma linha pelo restante todo", async () => {
    montar();
    expect(await screen.findByText("Frigobar")).toBeInTheDocument();
    expect(screen.getByLabelText("Valor da forma 1")).toHaveValue("950,00");
    const forma = screen.getByLabelText("Forma de pagamento 1") as HTMLSelectElement;
    expect(forma.value).toBe("dinheiro");
    expect([...forma.options].map((o) => o.value)).toEqual(["dinheiro", "pix", "credito"]);
    expect(screen.getByText("Tudo certo: R$ 0,00")).toBeInTheDocument();
    expect(botao()).toBeEnabled();
  });

  test("pagamento dividido zera o restante e habilita concluir", async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.selectOptions(await screen.findByLabelText("Forma de pagamento 1"), "pix");
    await digitar(usuario, "Valor da forma 1", "500,00");
    expect(screen.getByText("Falta R$ 450,00")).toBeInTheDocument();
    expect(botao()).toBeDisabled();
    await usuario.click(screen.getByRole("button", { name: "+ outra forma" }));
    await usuario.selectOptions(screen.getByLabelText("Forma de pagamento 2"), "credito");
    await digitar(usuario, "Valor da forma 2", "450,00");
    expect(screen.getByText("Tudo certo: R$ 0,00")).toBeInTheDocument();
    expect(botao()).toBeEnabled();
    await digitar(usuario, "Valor da forma 2", "500,00");
    expect(screen.getByText("Sobra R$ 50,00")).toBeInTheDocument();
    expect(botao()).toBeDisabled();
  });

  test("faturado entra no cálculo do restante e é enviado", async () => {
    const usuario = userEvent.setup();
    montar({ "POST /api/reservas/r1/checkout": {} });
    await usuario.click(await screen.findByLabelText("Faturar para empresa"));
    // o faturado abre com o restante (zero), então o primeiro pagamento ainda cobre tudo
    await digitar(usuario, "Valor da forma 1", "500,00");
    expect(screen.getByText("Falta R$ 450,00")).toBeInTheDocument();
    await digitar(usuario, "Valor faturado", "450,00");
    expect(screen.getByText("Tudo certo: R$ 0,00")).toBeInTheDocument();
    expect(botao()).toBeDisabled(); // faltam nome e documento
    await usuario.type(screen.getByLabelText("Nome do responsável"), "Empresa Alfa");
    await usuario.type(screen.getByLabelText("Documento do responsável"), "12345678000199");
    expect(botao()).toBeEnabled();
    await usuario.click(botao());
    await waitFor(() => expect(postou()).toHaveLength(1));
    expect(postou()[0]!.corpo).toEqual({
      pagamentos: [{ formaCodigo: "dinheiro", valor: 50000 }],
      faturado: { nome: "Empresa Alfa", documento: "12345678000199", valor: 45000 },
      cobrarLateCheckout: true,
    });
    expect(await screen.findByText("Check-out concluído · quarto 101 enviado para limpeza")).toBeInTheDocument();
  });

  test("late checkout soma ao saldo quando marcado", async () => {
    const usuario = userEvent.setup();
    montar({ "GET /api/reservas/r1/checkout": previa({ saldo: 95000, lateCheckout: 15000 }) });
    const marca = await screen.findByLabelText("Cobrar late check-out");
    expect(marca).toBeChecked();
    expect(screen.getByText("Late check-out: R$ 150,00")).toBeInTheDocument();
    expect(screen.getByLabelText("Valor da forma 1")).toHaveValue("950,00");
    await usuario.click(marca);
    expect(screen.getByText("Sobra R$ 150,00")).toBeInTheDocument();
    await usuario.click(marca);
    expect(screen.getByText("Tudo certo: R$ 0,00")).toBeInTheDocument();
  });

  test("sem late check-out cobrado envia cobrarLateCheckout false", async () => {
    const usuario = userEvent.setup();
    montar({ "GET /api/reservas/r1/checkout": previa({ saldo: 95000, lateCheckout: 15000 }), "POST /api/reservas/r1/checkout": {} });
    await usuario.click(await screen.findByLabelText("Cobrar late check-out"));
    await digitar(usuario, "Valor da forma 1", "800,00");
    await usuario.click(botao());
    await waitFor(() => expect(postou()).toHaveLength(1));
    expect(postou()[0]!.corpo).toEqual({ pagamentos: [{ formaCodigo: "dinheiro", valor: 80000 }], cobrarLateCheckout: false });
    await screen.findByText(/Check-out concluído/);
  });

  test("Review Focus 4: erro do servidor mantém valores e mostra mensagem", async () => {
    const usuario = userEvent.setup();
    montar({
      "POST /api/reservas/r1/checkout": { __status: 422, codigo: "SALDO_PENDENTE", mensagem: "Ainda falta receber R$ 10,00.", detalhes: { saldo: 1000 } },
    });
    await dividir(usuario);
    await usuario.click(screen.getByLabelText("Faturar para empresa"));
    await usuario.type(screen.getByLabelText("Nome do responsável"), "Empresa Alfa");
    await usuario.type(screen.getByLabelText("Documento do responsável"), "123");
    await digitar(usuario, "Valor faturado", "0,01");
    await digitar(usuario, "Valor da forma 2", "449,99");
    await usuario.click(botao());
    expect(await screen.findByText("Ainda falta receber R$ 10,00.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Ainda falta receber R$ 10,00.");
    expect(screen.getByLabelText("Valor da forma 1")).toHaveValue("500,00");
    expect(screen.getByLabelText("Valor da forma 2")).toHaveValue("449,99");
    expect((screen.getByLabelText("Forma de pagamento 1") as HTMLSelectElement).value).toBe("pix");
    expect((screen.getByLabelText("Forma de pagamento 2") as HTMLSelectElement).value).toBe("credito");
    expect(screen.getByLabelText("Nome do responsável")).toHaveValue("Empresa Alfa");
    expect(screen.getByLabelText("Documento do responsável")).toHaveValue("123");
    expect(screen.getByLabelText("Valor faturado")).toHaveValue("0,01");
    expect(screen.getByTestId("local")).toHaveTextContent("reserva=r1&fluxo=checkout");
    expect(screen.queryByText(/Check-out concluído/)).not.toBeInTheDocument();
    expect(botao()).toBeEnabled();
  });

  test("sucesso mostra confirmação e fecha a gaveta", async () => {
    const usuario = userEvent.setup();
    montar({ "POST /api/reservas/r1/checkout": {} });
    await dividir(usuario);
    await usuario.click(botao());
    expect(await screen.findByText("Check-out concluído · quarto 101 enviado para limpeza")).toBeInTheDocument();
    expect(postou()[0]!.corpo).toEqual({
      pagamentos: [{ formaCodigo: "pix", valor: 50000 }, { formaCodigo: "credito", valor: 45000 }],
      cobrarLateCheckout: true,
    });
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent(/^\/mapa$/), { timeout: 3000 });
  });

  test("saída antecipada mostra aviso", async () => {
    montar({ "GET /api/reservas/r1/checkout": previa({ saidaAntecipada: true }) });
    expect(await screen.findByText("Saída antecipada — as noites seguintes serão canceladas")).toBeInTheDocument();
  });

  test("sem caixa aberto avisa e bloqueia pagamentos, mas faturado puro dispensa o caixa", async () => {
    const usuario = userEvent.setup();
    montar({ "GET /api/caixa/atual": null });
    expect(await screen.findByText("Abra o caixa para receber pagamentos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir para o caixa" })).toHaveAttribute("href", "/caixa");
    expect(botao()).toBeDisabled();
    await usuario.click(screen.getByRole("button", { name: "Remover forma 1" }));
    await usuario.click(screen.getByLabelText("Faturar para empresa"));
    expect(screen.queryByText("Abra o caixa para receber pagamentos")).not.toBeInTheDocument();
    await usuario.type(screen.getByLabelText("Nome do responsável"), "Empresa Alfa");
    await usuario.type(screen.getByLabelText("Documento do responsável"), "123");
    expect(screen.getByLabelText("Valor faturado")).toHaveValue("950,00");
    expect(botao()).toBeEnabled();
  });

  test("I1: conta única com outros quartos ativos permite concluir com saldo restante", async () => {
    const usuario = userEvent.setup();
    montar({ "GET /api/reservas/r1/checkout": previa({ exigeQuitacao: false }), "POST /api/reservas/r1/checkout": {} });
    await digitar(usuario, "Valor da forma 1", "300,00");
    expect(screen.getByText("Falta R$ 650,00")).toBeInTheDocument();
    expect(screen.getByText("O saldo restante fica na conta do grupo.")).toBeInTheDocument();
    expect(botao()).toBeEnabled();
    await usuario.click(botao());
    await waitFor(() => expect(postou()).toHaveLength(1));
    expect(postou()[0]!.corpo).toMatchObject({ pagamentos: [{ formaCodigo: "dinheiro", valor: 30000 }] });
  });

  test("I1: sem exigir quitação aceita zero linhas de pagamento, mas linha inválida bloqueia", async () => {
    const usuario = userEvent.setup();
    montar({ "GET /api/reservas/r1/checkout": previa({ exigeQuitacao: false }) });
    await screen.findByLabelText("Valor da forma 1");
    await digitar(usuario, "Valor da forma 1", "0");
    expect(botao()).toBeDisabled();
    await usuario.click(screen.getByRole("button", { name: "Remover forma 1" }));
    expect(botao()).toBeEnabled();
  });

  test("I1: sem exigir quitação, pagar além do devido continua bloqueado", async () => {
    const usuario = userEvent.setup();
    montar({ "GET /api/reservas/r1/checkout": previa({ exigeQuitacao: false }) });
    await digitar(usuario, "Valor da forma 1", "1000,00");
    expect(screen.getByText("Sobra R$ 50,00")).toBeInTheDocument();
    expect(botao()).toBeDisabled();
  });

  test("exigindo quitação, o aviso do grupo não aparece", async () => {
    montar();
    await screen.findByText("Frigobar");
    expect(screen.queryByText("O saldo restante fica na conta do grupo.")).not.toBeInTheDocument();
  });

  test("saldo negativo avisa do crédito do hóspede e orienta o estorno", async () => {
    montar({ "GET /api/reservas/r1/checkout": previa({ saldo: -2500 }) });
    expect(await screen.findByText("O hóspede tem crédito de R$ 25,00. Cancele e faça o estorno pela aba Conta.")).toBeInTheDocument();
  });

  test("a prévia não é recarregada por intervalo", async () => {
    const { cliente } = montar();
    await screen.findByText("Frigobar");
    const q = cliente.getQueryCache().find({ queryKey: ["checkout-previa", "r1"] })!;
    expect(q.observers[0]!.options.refetchInterval).toBe(false);
  });

  test("Cancelar volta ao resumo sem enviar nada", async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(screen.getByTestId("local")).toHaveTextContent("/mapa?reserva=r1");
    expect(screen.getByTestId("local")).not.toHaveTextContent("fluxo");
    expect(postou()).toHaveLength(0);
  });
});
