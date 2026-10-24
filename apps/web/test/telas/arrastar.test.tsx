import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { describe, expect, test, vi } from "vitest";
import type { Mapa } from "../../src/api/tipos";
import { GradeMapa } from "../../src/telas/mapa/GradeMapa";
import { TelaMapa } from "../../src/telas/mapa/TelaMapa";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";

const barra = (o: Partial<Mapa["barras"][number]>): Mapa["barras"][number] => ({
  reservaId: "r1", codigo: 12, quartoId: "q101", categoriaId: "c1", chegada: "2026-11-20", saida: "2026-11-23", estado: "confirmada", titular: "Ana Souza", ...o,
});

// Linhas, de cima para baixo: Luxo/201, Standard/101, Standard/102, Standard/sem quarto.
const mapa: Mapa = {
  quartos: [
    { id: "q101", numero: "101", categoria: "Standard", situacao: "livre" },
    { id: "q102", numero: "102", categoria: "Standard", situacao: "livre" },
    { id: "q201", numero: "201", categoria: "Luxo", situacao: "livre" },
  ],
  barras: [
    barra({}),
    barra({ reservaId: "r2", codigo: 13, quartoId: "q102", estado: "hospedada", titular: "Bruno Lima", chegada: "2026-11-18", saida: "2026-11-21" }),
    barra({ reservaId: "r4", codigo: 15, quartoId: null, estado: "finalizada", titular: "Davi Melo", chegada: "2026-11-22", saida: "2026-11-24" }),
  ],
};
const nomes = { c1: "Standard", c2: "Luxo" };
const ANA = "Ana Souza · 20/11–23/11 · confirmada";
const BRUNO = "Bruno Lima · 18/11–21/11 · hospedada";

/** Simula um arrasto com Pointer Events; os deltas vêm só das coordenadas. */
function arrastar(el: Element, dx: number, dy: number, x0 = 200, y0 = 200) {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: x0, clientY: y0 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: x0 + dx, clientY: y0 + dy });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: x0 + dx, clientY: y0 + dy });
}

function grade(aoSoltar = vi.fn(), aoAbrirReserva = vi.fn()) {
  renderizar(
    <GradeMapa mapa={mapa} inicio="2026-11-19" dias={14} hoje="2026-11-20" nomesCategoria={nomes} aoAbrirReserva={aoAbrirReserva} aoCriarReserva={vi.fn()} aoSoltar={aoSoltar} />,
  );
  return { aoSoltar, aoAbrirReserva };
}

describe("arrastar e esticar (grade)", () => {
  test("arrastar 2 colunas para a direita e 1 linha abaixo gera mover com novas datas e quarto", () => {
    const { aoSoltar } = grade();
    arrastar(screen.getByRole("button", { name: ANA }), 96, 40);
    expect(aoSoltar).toHaveBeenCalledTimes(1);
    expect(aoSoltar).toHaveBeenCalledWith({ reservaId: "r1", tipo: "mover", quartoId: "q102", chegada: "2026-11-22", saida: "2026-11-25" });
  });

  test("mover para quarto de outra categoria envia também a categoria da linha de destino", () => {
    const { aoSoltar } = grade();
    arrastar(screen.getByRole("button", { name: ANA }), 0, -40);
    expect(aoSoltar).toHaveBeenCalledWith({ reservaId: "r1", tipo: "mover", quartoId: "q201", categoriaId: "c2", chegada: "2026-11-20", saida: "2026-11-23" });
  });

  test("esticar a ponta direita muda só a saída", () => {
    const { aoSoltar } = grade();
    const alca = screen.getByRole("button", { name: ANA }).querySelector("[data-alca]")!;
    expect(alca).toHaveAttribute("aria-hidden", "true");
    arrastar(alca, 48, 30);
    expect(aoSoltar).toHaveBeenCalledWith({ reservaId: "r1", tipo: "esticar", saida: "2026-11-24" });
  });

  test("esticar nunca deixa a reserva com menos de 1 noite", () => {
    const { aoSoltar } = grade();
    arrastar(screen.getByRole("button", { name: ANA }).querySelector("[data-alca]")!, -480, 0);
    expect(aoSoltar).toHaveBeenCalledWith({ reservaId: "r1", tipo: "esticar", saida: "2026-11-21" });
  });

  test("Review Focus 3: soltar no mesmo lugar, sobre linha 'sem quarto' ou fora da grade não chama aoSoltar", () => {
    const { aoSoltar } = grade();
    const ana = screen.getByRole("button", { name: ANA });
    arrastar(ana, 10, 8); // arrasta, mas arredonda para zero colunas/linhas
    arrastar(ana, 0, 80); // linha 'sem quarto'
    arrastar(ana, 0, 4000); // abaixo da última linha
    arrastar(ana, 0, -4000); // acima da primeira linha
    arrastar(screen.getByRole("button", { name: "Davi Melo · 22/11–24/11 · finalizada" }), 96, 0);
    expect(aoSoltar).not.toHaveBeenCalled();
  });

  test("movimento abaixo de 6 px é clique e abre a reserva", async () => {
    const { aoSoltar, aoAbrirReserva } = grade();
    const ana = screen.getByRole("button", { name: ANA });
    arrastar(ana, 3, 3);
    await userEvent.click(ana);
    expect(aoSoltar).not.toHaveBeenCalled();
    expect(aoAbrirReserva).toHaveBeenCalledWith("r1");
  });

  test("depois de arrastar, o clique que o navegador dispara ao soltar não abre a reserva", () => {
    const { aoAbrirReserva } = grade();
    const ana = screen.getByRole("button", { name: ANA });
    arrastar(ana, 96, 0);
    fireEvent.click(ana);
    expect(aoAbrirReserva).not.toHaveBeenCalled();
  });

  test("hospedada não move a chegada: só troca de quarto na mesma coluna", () => {
    const { aoSoltar } = grade();
    const bruno = screen.getByRole("button", { name: BRUNO });
    arrastar(bruno, 96, 0); // só deslocamento horizontal: nada muda
    expect(aoSoltar).not.toHaveBeenCalled();
    arrastar(bruno, 96, -40); // sobe uma linha: troca de quarto, mesmas datas
    expect(aoSoltar).toHaveBeenCalledWith({ reservaId: "r2", tipo: "mover", quartoId: "q101" });
    arrastar(bruno.querySelector("[data-alca]")!, 48, 0); // esticar a saída é permitido
    expect(aoSoltar).toHaveBeenLastCalledWith({ reservaId: "r2", tipo: "esticar", saida: "2026-11-22" });
  });

  test("finalizada não é arrastável e não tem alça", () => {
    grade();
    expect(screen.getByRole("button", { name: "Davi Melo · 22/11–24/11 · finalizada" }).querySelector("[data-alca]")).toBeNull();
  });
});

function Local() {
  const l = useLocation();
  return <output data-testid="local">{l.pathname + l.search}</output>;
}

const previa = {
  valorAntigo: 30000,
  valorNovo: 36000,
  noites: [
    { data: "2026-11-22", valor: 12000, passos: [] },
    { data: "2026-11-23", valor: 12000, passos: [] },
    { data: "2026-11-24", valor: 12000, passos: [] },
  ],
};

function montar(patch: unknown = {}) {
  instalarApiFalsa({
    "GET /api/painel": criarPainel({ dia: "2026-11-20" }),
    "GET /api/categorias": [
      { id: "c1", nome: "Standard", maxAdultos: 2, maxCriancas: 1, comodidades: [] },
      { id: "c2", nome: "Luxo", maxAdultos: 3, maxCriancas: 1, comodidades: [] },
    ],
    "GET /api/mapa": mapa,
    "GET /api/reservas/r1/previa": previa,
    "PATCH /api/reservas/r1": patch,
  });
  return renderizar(<><TelaMapa /><Local /></>, { rota: "/mapa" });
}

describe("arrastar e esticar (tela)", () => {
  test("soltar no mesmo lugar não chama a API nem abre janela", async () => {
    montar();
    const ana = await screen.findByRole("button", { name: ANA });
    arrastar(ana, 10, 8);
    arrastar(ana, 0, 4000);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(chamadas.some((c) => c.metodo === "PATCH" || c.caminho.includes("/previa"))).toBe(false);
  });

  test("prévia mostra de/para e as noites, e confirma com PATCH", async () => {
    montar();
    arrastar(await screen.findByRole("button", { name: ANA }), 96, 40);
    const janela = await screen.findByRole("dialog", { name: "Alterar reserva" });
    expect(await within(janela).findByText("De R$ 300,00 para R$ 360,00")).toBeInTheDocument();
    expect(within(janela).getAllByRole("listitem")).toHaveLength(3);
    expect(within(janela).getByText("22/11")).toBeInTheDocument();
    expect(chamadas.find((c) => c.caminho.includes("/previa"))!.caminho).toBe("/api/reservas/r1/previa?quartoId=q102&chegada=2026-11-22&saida=2026-11-25");

    await userEvent.click(within(janela).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(chamadas.find((c) => c.metodo === "PATCH")!.corpo).toEqual({ quartoId: "q102", chegada: "2026-11-22", saida: "2026-11-25" });
  });

  test("Cancelar fecha a prévia sem gravar", async () => {
    montar();
    arrastar(await screen.findByRole("button", { name: ANA }), 96, 0);
    const janela = await screen.findByRole("dialog", { name: "Alterar reserva" });
    await within(janela).findByText(/De R\$/);
    await userEvent.click(within(janela).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(false);
  });

  test("erro QUARTO_INDISPONIVEL aparece e nada é gravado", async () => {
    montar({ __status: 409, codigo: "QUARTO_INDISPONIVEL", mensagem: "O quarto 102 não está livre (sujo). Escolha outro quarto." });
    arrastar(await screen.findByRole("button", { name: ANA }), 0, 40);
    const janela = await screen.findByRole("dialog", { name: "Alterar reserva" });
    await userEvent.click(await within(janela).findByRole("button", { name: "Confirmar" }));
    expect(await within(janela).findByRole("alert")).toHaveTextContent("O quarto 102 não está livre (sujo). Escolha outro quarto.");
    expect(screen.getByRole("dialog", { name: "Alterar reserva" })).toBeInTheDocument();
  });

  test("restrição tarifária pede supervisor e reenvia com autorização", async () => {
    montar((corpo: { autorizacao?: unknown }) =>
      corpo.autorizacao ? {} : { __status: 422, codigo: "RESTRICAO_TARIFARIA", mensagem: "Estas datas têm restrição de venda. Peça a autorização de um supervisor para continuar." },
    );
    arrastar(await screen.findByRole("button", { name: ANA }), 96, 0);
    await userEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    const supervisor = await screen.findByRole("dialog", { name: /supervisor/i });
    await userEvent.type(within(supervisor).getByLabelText("Motivo"), "Cliente antigo");
    await userEvent.type(within(supervisor).getByLabelText("Login do supervisor"), "chefe");
    await userEvent.type(within(supervisor).getByLabelText("Senha do supervisor"), "segredo");
    await userEvent.click(within(supervisor).getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const patches = chamadas.filter((c) => c.metodo === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[1]!.corpo).toEqual({ chegada: "2026-11-22", saida: "2026-11-25", autorizacao: { motivo: "Cliente antigo", supervisor: { login: "chefe", senha: "segredo" } } });
  });
});
