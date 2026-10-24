import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TelaGovernanca } from "../../src/telas/governanca/TelaGovernanca";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const lista = [
  { quartoId: "q3", numero: "103", situacao: "sujo" },
  { quartoId: "q1", numero: "101", situacao: "livre" },
  { quartoId: "q2", numero: "102", situacao: "ocupado", hospedadoAte: "2026-10-25" },
  { quartoId: "q4", numero: "104", situacao: "bloqueado" },
];
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

  test("tocar em quarto sujo marca limpo após confirmar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/governanca": lista, "POST /api/quartos/q3/limpo": { ok: true } });
    renderizar(<TelaGovernanca />, gov);
    await u.click(await screen.findByRole("button", { name: /103/ }));
    const janela = screen.getByRole("dialog", { name: "Marcar 103 como limpo?" });
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);
    await u.click(within(janela).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(chamadas.some((c) => c.caminho === "/api/quartos/q3/limpo")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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
});
