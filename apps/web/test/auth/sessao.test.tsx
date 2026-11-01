import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useSessao } from "../../src/auth/SessaoProvider";
import { instalarApiFalsa } from "../api-falsa";
import { renderizar, usuarioPadrao } from "../ajuda";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Sonda() {
  const { usuario, sair } = useSessao();
  return (
    <>
      <output data-testid="nome">{usuario?.nome ?? "ninguém"}</output>
      <button onClick={() => void sair()}>Sair</button>
    </>
  );
}

describe("releitura da sessão", () => {
  test("M10: resposta que chega depois do logout não regrava o usuário", async () => {
    let liberar!: (u: unknown) => void;
    const pendente = new Promise((r) => (liberar = r));
    instalarApiFalsa({ "GET /api/sessoes/atual": () => pendente, "DELETE /api/sessoes": { __status: 204 } });
    const u = userEvent.setup();
    renderizar(<Sonda />);
    await u.click(screen.getByRole("button", { name: "Sair" }));
    await waitFor(() => expect(screen.getByTestId("nome")).toHaveTextContent("ninguém"));
    await act(async () => {
      liberar({ ...usuarioPadrao, nome: "Fantasma" });
      await pendente;
    });
    expect(screen.getByTestId("nome")).toHaveTextContent("ninguém");
    expect(localStorage.getItem("erp.usuario")).toBeNull();
    expect(localStorage.getItem("erp.token")).toBeNull();
  });

  test("M11: ao voltar o foco da janela relê a sessão, no máximo uma vez por minuto", async () => {
    let leituras = 0;
    instalarApiFalsa({ "GET /api/sessoes/atual": () => (leituras++, usuarioPadrao) });
    let agora = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => agora);
    renderizar(<Sonda />);
    await waitFor(() => expect(leituras).toBe(1));
    act(() => void window.dispatchEvent(new Event("focus")));
    agora += 30_000;
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(leituras).toBe(1);
    agora += 31_000;
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(leituras).toBe(2));
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(leituras).toBe(2);
  });

  test("M11: sem sessão o foco não consulta o servidor", async () => {
    let leituras = 0;
    instalarApiFalsa({ "GET /api/sessoes/atual": () => (leituras++, usuarioPadrao) });
    vi.spyOn(Date, "now").mockReturnValue(5_000_000);
    renderizar(<Sonda />, { semSessao: true });
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(leituras).toBe(0);
  });
});
