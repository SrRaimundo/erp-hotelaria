import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GavetaReserva } from "../../src/telas/reserva/GavetaReserva";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";
import { criarReserva } from "../fixtures/reserva";

afterEach(() => vi.unstubAllGlobals());

const CANAIS = [
  { id: "k1", nome: "Balcão", percentual: 0, exigeSinal: false, tipo: "direta", comissaoPercentual: 0 },
  { id: "k2", nome: "Booking", percentual: 15, exigeSinal: true, tipo: "ota", comissaoPercentual: 12 },
];
const previa = { valorAntigo: 90200, valorNovo: 120200, noites: [{ data: "2026-11-23", valor: 30000 }] };

function montar(reserva = criarReserva(), extras: Record<string, unknown> = {}) {
  instalarApiFalsa({
    "GET /api/painel": criarPainel(),
    "GET /api/reservas/r1": reserva,
    "GET /api/reservas/r1/previa": previa,
    "PATCH /api/reservas/r1": {},
    "GET /api/tarifas/canais": CANAIS,
    ...extras,
  });
  return renderizar(<GavetaReserva />, { rota: "/mapa?reserva=r1" });
}

const abrirForm = async (u: ReturnType<typeof userEvent.setup>) => {
  await u.click(await screen.findByRole("button", { name: "Alterar" }));
  return screen.getByRole("dialog", { name: "Alterar datas e hóspedes" });
};
const definir = async (u: ReturnType<typeof userEvent.setup>, campo: HTMLElement, valor: string) => {
  await u.clear(campo);
  await u.type(campo, valor);
};
const patches = () => chamadas.filter((c) => c.metodo === "PATCH");

describe("alterar reserva pela gaveta", () => {
  test("trocar o canal mostra a prévia e envia PATCH só com o canal", async () => {
    const u = userEvent.setup();
    montar();
    const form = await abrirForm(u);
    const canal = within(form).getByLabelText("Canal");
    expect(canal).toHaveValue("Balcão");
    await u.selectOptions(await within(form).findByRole("option", { name: "Booking" }).then(() => canal), "Booking");
    await u.click(within(form).getByRole("button", { name: "Ver prévia" }));
    const janela = await screen.findByRole("dialog", { name: "Alterar reserva" });
    expect(await within(janela).findByText("De R$ 902,00 para R$ 1.202,00")).toBeInTheDocument();
    expect(chamadas.find((c) => c.caminho.startsWith("/api/reservas/r1/previa"))!.caminho).toBe("/api/reservas/r1/previa?canal=Booking");
    await u.click(within(janela).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]!.corpo).toEqual({ canal: "Booking" });
  });

  test("hospedada: estender a saída mostra a prévia e envia PATCH só com a saída", async () => {
    const u = userEvent.setup();
    montar();
    const form = await abrirForm(u);
    expect(within(form).getByLabelText("Chegada")).toBeDisabled();
    expect(within(form).getByLabelText("Saída")).toHaveValue("2026-11-23");
    expect(within(form).getByLabelText("Adultos")).toHaveValue(2);
    await definir(u, within(form).getByLabelText("Saída"), "2026-11-24");
    await u.click(within(form).getByRole("button", { name: "Ver prévia" }));
    const janela = await screen.findByRole("dialog", { name: "Alterar reserva" });
    expect(await within(janela).findByText("De R$ 902,00 para R$ 1.202,00")).toBeInTheDocument();
    expect(chamadas.find((c) => c.caminho.startsWith("/api/reservas/r1/previa"))!.caminho).toBe("/api/reservas/r1/previa?saida=2026-11-24");
    await u.click(within(janela).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]!.corpo).toEqual({ saida: "2026-11-24" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Alterar reserva" })).not.toBeInTheDocument());
  });

  test("confirmada: chegada editável; mudar adultos e crianças envia só o que mudou", async () => {
    const u = userEvent.setup();
    montar(criarReserva({ estado: "confirmada" }));
    const form = await abrirForm(u);
    expect(within(form).getByLabelText("Chegada")).toBeEnabled();
    await definir(u, within(form).getByLabelText("Adultos"), "3");
    await u.click(within(form).getByRole("button", { name: "Remover criança 1" }));
    await u.click(within(form).getByRole("button", { name: "Ver prévia" }));
    const janela = await screen.findByRole("dialog", { name: "Alterar reserva" });
    await u.click(await within(janela).findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]!.corpo).toEqual({ adultos: 3, criancasNascimento: [] });
  });

  test("saída precisa ser depois da chegada: mostra erro e não pede prévia", async () => {
    const u = userEvent.setup();
    montar(criarReserva({ estado: "confirmada" }));
    const form = await abrirForm(u);
    await definir(u, within(form).getByLabelText("Saída"), "2026-11-20");
    expect(within(form).getByText("A saída deve ser depois da chegada.")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Ver prévia" })).toBeDisabled();
    expect(chamadas.some((c) => c.caminho.startsWith("/api/reservas/r1/previa"))).toBe(false);
  });

  test("sem mudanças o botão fica desabilitado; adultos zero também bloqueia", async () => {
    const u = userEvent.setup();
    montar();
    const form = await abrirForm(u);
    expect(within(form).getByRole("button", { name: "Ver prévia" })).toBeDisabled();
    await definir(u, within(form).getByLabelText("Adultos"), "0");
    expect(within(form).getByText("Informe ao menos 1 adulto.")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Ver prévia" })).toBeDisabled();
  });

  test("reserva finalizada ou cancelada não oferece Alterar", async () => {
    montar(criarReserva({ estado: "finalizada" }));
    await screen.findByRole("tab", { name: "Resumo" });
    expect(screen.queryByRole("button", { name: "Alterar" })).not.toBeInTheDocument();
  });
});
