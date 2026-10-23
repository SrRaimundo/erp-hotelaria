import { describe, expect, test } from "vitest";
import { diasEntre, formatarData, nomeDiaSemana, somarDiasIso } from "../../src/lib/datas";

describe("datas", () => {
  test("formatarData", () => {
    expect(formatarData("2026-11-20")).toBe("20/11");
    expect(formatarData("2026-11-20", true)).toBe("20/11/2026");
  });
  test("nomeDiaSemana", () => {
    expect(nomeDiaSemana("2026-11-20")).toBe("Sexta-feira");
    expect(nomeDiaSemana("2026-11-22")).toBe("Domingo");
    expect(nomeDiaSemana("2026-11-21")).toBe("Sábado");
    expect(nomeDiaSemana("2026-11-19")).toBe("Quinta-feira");
  });
  test("somarDiasIso e diasEntre", () => {
    expect(somarDiasIso("2026-11-30", 1)).toBe("2026-12-01");
    expect(somarDiasIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(diasEntre("2026-11-20", "2026-11-23")).toBe(3);
    expect(diasEntre("2026-11-23", "2026-11-20")).toBe(-3);
  });
});
