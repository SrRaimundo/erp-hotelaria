import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ResumoCaixa } from "../../src/api/tipos";
import { TelaCaixa } from "../../src/telas/caixa/TelaCaixa";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const FORMAS = [
  { id: "f1", codigo: "dinheiro", nome: "Dinheiro", ativa: true },
  { id: "f2", codigo: "pix", nome: "Pix", ativa: true },
];
const ABERTO_EM = "2026-11-20T12:30:00.000Z";
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const resumo: ResumoCaixa = {
  turno: { id: "t1", usuarioId: "u1", abertoEm: ABERTO_EM, valorInicial: 10000, fechadoEm: null },
  movimentos: [
    { forma: "dinheiro", valor: 5000, origemTipo: "pagamento", instante: "2026-11-20T13:00:00.000Z" },
    { forma: "pix", valor: -2000, origemTipo: "estorno", instante: "2026-11-20T14:15:00.000Z" },
    { forma: "pix", valor: 7000, origemTipo: "ajuste", instante: "2026-11-20T15:00:00.000Z" },
  ],
  esperadoPorForma: { dinheiro: 15000, pix: 5000 },
};

describe("tela Caixa", () => {
  test("abrir caixa envia valor inicial em centavos e passa a mostrar o turno", async () => {
    const u = userEvent.setup();
    let aberto = false;
    instalarApiFalsa({
      "GET /api/formas-pagamento": FORMAS,
      "GET /api/caixa/atual": () => (aberto ? resumo : null),
      "POST /api/caixa/abrir": () => {
        aberto = true;
        return { __status: 201, ...resumo.turno };
      },
    });
    renderizar(<TelaCaixa />);
    await u.type(await screen.findByLabelText("Valor inicial em dinheiro"), "100,50");
    await u.click(screen.getByRole("button", { name: "Abrir caixa" }));
    expect(await screen.findByText(`Aberto às ${hhmm(ABERTO_EM)}`)).toBeInTheDocument();
    expect(chamadas.find((c) => c.metodo === "POST")).toMatchObject({ caminho: "/api/caixa/abrir", corpo: { valorInicial: 10050 } });
  });

  test("valor inicial 0 é aceito", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/formas-pagamento": FORMAS,
      "GET /api/caixa/atual": null,
      "POST /api/caixa/abrir": { __status: 201, ...resumo.turno },
    });
    renderizar(<TelaCaixa />);
    await u.type(await screen.findByLabelText("Valor inicial em dinheiro"), "0");
    await u.click(screen.getByRole("button", { name: "Abrir caixa" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "POST")?.corpo).toEqual({ valorInicial: 0 }));
  });

  test("erro ao abrir mostra a mensagem do servidor", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/formas-pagamento": FORMAS,
      "GET /api/caixa/atual": null,
      "POST /api/caixa/abrir": { __status: 422, codigo: "CAIXA_JA_ABERTO", mensagem: "Você já tem um caixa aberto." },
    });
    renderizar(<TelaCaixa />);
    await u.type(await screen.findByLabelText("Valor inicial em dinheiro"), "10");
    await u.click(screen.getByRole("button", { name: "Abrir caixa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Você já tem um caixa aberto.");
  });

  test("com turno mostra movimentos com origem e forma amigáveis e o esperado por forma", async () => {
    instalarApiFalsa({ "GET /api/formas-pagamento": FORMAS, "GET /api/caixa/atual": resumo });
    renderizar(<TelaCaixa />);
    expect(await screen.findByText(`Aberto às ${hhmm(ABERTO_EM)}`)).toBeInTheDocument();
    const linhas = screen.getAllByRole("row");
    expect(linhas).toHaveLength(4); // cabeçalho + 3 movimentos
    const l1 = within(linhas[1]!);
    expect(l1.getByText(hhmm("2026-11-20T13:00:00.000Z"))).toBeInTheDocument();
    expect(l1.getByText("Pagamento")).toBeInTheDocument();
    expect(l1.getByText("Dinheiro")).toBeInTheDocument();
    expect(l1.getByText("R$ 50,00")).toBeInTheDocument();
    expect(within(linhas[2]!).getByText("Estorno")).toBeInTheDocument();
    expect(within(linhas[2]!).getByText("−R$ 20,00")).toBeInTheDocument();
    expect(within(linhas[3]!).getByText("ajuste")).toBeInTheDocument();
    const esperado = within(screen.getByRole("list", { name: "Esperado por forma" }));
    expect(esperado.getByText("Dinheiro")).toBeInTheDocument();
    expect(esperado.getByText("R$ 150,00")).toBeInTheDocument();
    expect(esperado.getByText("R$ 50,00")).toBeInTheDocument();
  });

  test("fechar caixa exige todos os contados válidos e mostra diferenças por forma", async () => {
    const u = userEvent.setup();
    let aberto = true;
    instalarApiFalsa({
      "GET /api/formas-pagamento": FORMAS,
      "GET /api/caixa/atual": () => (aberto ? resumo : null),
      "POST /api/caixa/fechar": () => {
        aberto = false;
        return {
          porForma: [
            { forma: "dinheiro", esperado: 15000, contado: 14000, diferenca: -1000 },
            { forma: "pix", esperado: 5000, contado: 5000, diferenca: 0 },
          ],
        };
      },
    });
    renderizar(<TelaCaixa />);
    await u.click(await screen.findByRole("button", { name: "Fechar caixa" }));
    const confirmar = screen.getByRole("button", { name: "Confirmar fechamento" });
    expect(confirmar).toBeDisabled();
    await u.type(screen.getByLabelText("Contado em Dinheiro"), "140");
    expect(confirmar).toBeDisabled();
    await u.type(screen.getByLabelText("Contado em Pix"), "50");
    expect(confirmar).toBeEnabled();
    await u.click(confirmar);

    expect(await screen.findByText("−R$ 10,00")).toHaveStyle({ color: "var(--terracota)" });
    expect(chamadas.find((c) => c.metodo === "POST")).toMatchObject({
      caminho: "/api/caixa/fechar",
      corpo: { contados: { dinheiro: 14000, pix: 5000 } },
    });
    const linhaPix = screen.getByText("Pix").closest("tr")!;
    expect(within(linhaPix).getByText("R$ 0,00")).not.toHaveStyle({ color: "var(--terracota)" });

    await u.click(screen.getByRole("button", { name: "Concluir" }));
    expect(await screen.findByRole("button", { name: "Abrir caixa" })).toBeInTheDocument();
  });

  test("erro ao fechar mostra a mensagem e mantém o formulário", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/formas-pagamento": FORMAS,
      "GET /api/caixa/atual": resumo,
      "POST /api/caixa/fechar": { __status: 422, codigo: "X", mensagem: "Falha ao fechar." },
    });
    renderizar(<TelaCaixa />);
    await u.click(await screen.findByRole("button", { name: "Fechar caixa" }));
    await u.type(screen.getByLabelText("Contado em Dinheiro"), "150");
    await u.type(screen.getByLabelText("Contado em Pix"), "50");
    await u.click(screen.getByRole("button", { name: "Confirmar fechamento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao fechar.");
    expect(screen.getByLabelText("Contado em Dinheiro")).toHaveValue("150");
  });
});
