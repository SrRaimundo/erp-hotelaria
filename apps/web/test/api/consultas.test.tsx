import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { chamarApi, ErroApi } from "../../src/api/cliente";
import {
  criarQueryClient,
  useAcao,
  useBusca,
  useCaixa,
  useConta,
  useGovernanca,
  useMapa,
  usePainel,
  useReserva,
  useReservas,
} from "../../src/api/consultas";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const contar = (metodo: string, prefixo: string) => chamadas.filter((c) => c.metodo === metodo && c.caminho.startsWith(prefixo)).length;

describe("consultas", () => {
  test("QueryClient: intervalo de 30 s, refetch ao focar, retry 1 e nenhum para 4xx", () => {
    const q = criarQueryClient().getDefaultOptions().queries!;
    expect(q.refetchInterval).toBe(30_000);
    expect(q.refetchOnWindowFocus).toBe(true);
    const retry = q.retry as (n: number, e: unknown) => boolean;
    expect(retry(0, new Error("rede"))).toBe(true);
    expect(retry(1, new Error("rede"))).toBe(false);
    expect(retry(0, new ErroApi(422, "X", "m"))).toBe(false);
    expect(retry(0, new ErroApi(500, "X", "m"))).toBe(true);
    expect(retry(0, new ErroApi(0, "SEM_CONEXAO", "m"))).toBe(true);
  });

  test("Review Focus 1: ação invalida painel e mapa; consultas refazem por intervalo", async () => {
    instalarApiFalsa({
      "GET /api/painel": { dia: "2026-10-23" },
      "GET /api/mapa": { quartos: [] },
      "POST /api/x": { ok: true },
    });
    function Tela() {
      const painel = usePainel();
      const mapa = useMapa({ inicio: "2026-10-23", fim: "2026-11-05" });
      const enviar = useAcao<{ a: number }, { ok: boolean }>((c) => chamarApi("POST", "/api/x", c));
      return (
        <>
          <p>{painel.data ? "painel ok" : "carregando"}</p>
          <p>{mapa.data ? "mapa ok" : "carregando mapa"}</p>
          <button onClick={() => enviar.mutate({ a: 1 })}>enviar</button>
        </>
      );
    }
    const u = userEvent.setup();
    renderizar(<Tela />);
    await screen.findByText("painel ok");
    await screen.findByText("mapa ok");
    expect(contar("GET", "/api/painel")).toBe(1);
    expect(contar("GET", "/api/mapa?inicio=2026-10-23&fim=2026-11-05")).toBe(1);
    await u.click(screen.getByRole("button", { name: "enviar" }));
    await waitFor(() => expect(contar("GET", "/api/painel")).toBe(2));
    await waitFor(() => expect(contar("GET", "/api/mapa")).toBe(2));
  });

  test("URLs exatas dos hooks e busca desativada com q vazio", async () => {
    instalarApiFalsa({
      "GET /api/reservas/r1": {},
      "GET /api/contas/c1": {},
      "GET /api/reservas": { itens: [], total: 0 },
      "GET /api/caixa/atual": null,
      "GET /api/governanca": [],
      "GET /api/busca": [],
      "GET /api/mapa": {},
    });
    function Tela() {
      useReserva("r1");
      useConta("c1");
      useReservas({ q: "ana", estado: "confirmada,pendente", pagina: 2 });
      useCaixa();
      useGovernanca();
      useBusca("");
      useBusca("ana lima");
      useMapa({ inicio: "2026-10-23", fim: "2026-10-30", categoriaId: "cat1" });
      return null;
    }
    renderizar(<Tela />);
    await waitFor(() => expect(chamadas).toHaveLength(7));
    expect(chamadas.map((c) => c.caminho).sort()).toEqual(
      [
        "/api/reservas/r1",
        "/api/contas/c1",
        "/api/reservas?q=ana&estado=confirmada%2Cpendente&pagina=2",
        "/api/caixa/atual",
        "/api/governanca",
        "/api/busca?q=ana+lima",
        "/api/mapa?inicio=2026-10-23&fim=2026-10-30&categoriaId=cat1",
      ].sort(),
    );
  });
});
