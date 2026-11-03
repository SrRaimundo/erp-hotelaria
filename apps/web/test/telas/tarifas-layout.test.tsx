import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MenuLateral } from "../../src/layout/MenuLateral";
import { LayoutTarifas } from "../../src/telas/tarifas/LayoutTarifas";
import { aguardarConsultas, renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const ADMIN = { permissoes: ["reservas.gerenciar", "tarifas.gerenciar"] };
const RECEPCAO = { permissoes: ["reservas.gerenciar"] };
const abas = () => within(screen.getByRole("navigation", { name: "Abas de tarifas" })).getAllByRole("link").map((a) => a.textContent);

describe("menu: Tarifas sob Reservas", () => {
  test("Tarifas vem logo abaixo de Reservas, recuado, e leva a /reservas/tarifas", async () => {
    const { cliente } = renderizar(<MenuLateral atencao={0} />, { rota: "/reservas", usuario: ADMIN });
    await aguardarConsultas(cliente);
    const itens = screen.getAllByRole("link").map((a) => a.textContent);
    expect(itens.indexOf("Tarifas")).toBe(itens.indexOf("Reservas") + 1);
    const tarifas = screen.getByRole("link", { name: "Tarifas" });
    expect(tarifas).toHaveAttribute("href", "/reservas/tarifas");
    expect(tarifas).toHaveClass("menu__item--sub");
    expect(screen.getByRole("link", { name: "Reservas" })).not.toHaveClass("menu__item--sub");
  });

  test("sem tarifas.gerenciar o subitem não aparece", async () => {
    const { cliente } = renderizar(<MenuLateral atencao={0} />, { rota: "/reservas", usuario: RECEPCAO });
    await aguardarConsultas(cliente);
    expect(screen.getByRole("link", { name: "Reservas" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tarifas" })).not.toBeInTheDocument();
  });

  test("em /reservas/tarifas só Tarifas fica ativo; em /reservas/nova, Reservas", async () => {
    const r = renderizar(<MenuLateral atencao={0} />, { rota: "/reservas/tarifas/canais", usuario: ADMIN });
    await aguardarConsultas(r.cliente);
    expect(screen.getByRole("link", { name: "Tarifas" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Reservas" })).not.toHaveAttribute("aria-current");
    r.unmount();
    const r2 = renderizar(<MenuLateral atencao={0} />, { rota: "/reservas/nova", usuario: ADMIN });
    await aguardarConsultas(r2.cliente);
    expect(screen.getByRole("link", { name: "Reservas" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Tarifas" })).not.toHaveAttribute("aria-current");
  });
});

describe("abas de tarifas", () => {
  test("com tarifas.gerenciar mostra as nove abas na ordem do desenho", () => {
    renderizar(<LayoutTarifas />, { rota: "/reservas/tarifas/canais", usuario: ADMIN });
    expect(abas()).toEqual(["Tabela base", "Temporadas", "Dias da semana", "Canais", "Ocupação", "Crianças", "Pacotes", "Restrições", "Simulador"]);
    expect(screen.getByRole("link", { name: "Canais" })).toHaveAttribute("href", "/reservas/tarifas/canais");
  });

  test("sem tarifas.gerenciar a barra esconde o que o usuário não abre e deixa só o Simulador", () => {
    renderizar(<LayoutTarifas />, { rota: "/reservas/tarifas/simulador", usuario: RECEPCAO });
    expect(abas()).toEqual(["Simulador"]);
  });
});
