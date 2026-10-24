import { describe, expect, test } from "vitest";
import { colunasDoPeriodo, linhaDeQuarto, posicaoBarra } from "../../src/telas/mapa/geometria";

const quarto = (id: string, numero: string, categoria: string) => ({ id, numero, categoria, situacao: "livre" as const });
const barra = (reservaId: string, quartoId: string | null, categoriaId: string) => ({
  reservaId, codigo: 1, quartoId, categoriaId, chegada: "2026-11-20", saida: "2026-11-22", estado: "confirmada" as const, titular: "X",
});

describe("geometria do mapa", () => {
  test("colunas do período: dias consecutivos a partir do início", () => {
    expect(colunasDoPeriodo("2026-11-29", 3)).toEqual(["2026-11-29", "2026-11-30", "2026-12-01"]);
  });

  test("posição da barra: chegada e saída dentro do período", () => {
    expect(posicaoBarra({ chegada: "2026-11-20", saida: "2026-11-23" }, "2026-11-19", 14)).toEqual({ coluna: 1, largura: 3, cortadaInicio: false, cortadaFim: false });
  });

  test("barra recortada no início e no fim", () => {
    expect(posicaoBarra({ chegada: "2026-11-15", saida: "2026-12-10" }, "2026-11-19", 14)).toEqual({ coluna: 0, largura: 14, cortadaInicio: true, cortadaFim: true });
  });

  test("barra fora do período é null", () => {
    expect(posicaoBarra({ chegada: "2026-12-10", saida: "2026-12-12" }, "2026-11-19", 7)).toBeNull();
    expect(posicaoBarra({ chegada: "2026-11-10", saida: "2026-11-19" }, "2026-11-19", 7)).toBeNull();
  });

  test("linha 'sem quarto' só quando há reserva sem quarto, uma por categoria", () => {
    const quartos = [quarto("q1", "101", "Standard"), quarto("q2", "201", "Luxo")];
    const nomes = { c1: "Standard", c2: "Luxo" };
    const sem = linhaDeQuarto(quartos, [barra("r1", "q1", "c1")], nomes);
    expect(sem.map((g) => [g.categoria, g.linhas.map((l) => l.quarto?.numero ?? null)])).toEqual([["Luxo", ["201"]], ["Standard", ["101"]]]);

    const com = linhaDeQuarto(quartos, [barra("r1", "q1", "c1"), barra("r2", null, "c2"), barra("r3", null, "c2")], nomes);
    const luxo = com.find((g) => g.categoria === "Luxo")!;
    expect(luxo.linhas.map((l) => l.quarto?.numero ?? null)).toEqual(["201", null]);
    expect(luxo.linhas[1]!.barras.map((b) => b.reservaId)).toEqual(["r2", "r3"]);
    expect(com.find((g) => g.categoria === "Standard")!.linhas).toHaveLength(1);
  });
});
