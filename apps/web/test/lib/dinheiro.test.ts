import { describe, expect, test } from "vitest";
import { formatarReais, lerReais } from "../../src/lib/dinheiro";

describe("dinheiro", () => {
  test("Review Focus 2: lerReais", () => {
    expect(lerReais("1.234,5")).toBe(123450);
    expect(lerReais("1234,56")).toBe(123456);
    expect(lerReais("R$ 12,00")).toBe(1200);
    expect(lerReais("86")).toBe(8600);
    expect(lerReais("1234")).toBe(123400);
    expect(lerReais("abc")).toBeNull();
    expect(lerReais("")).toBeNull();
    expect(lerReais("   ")).toBeNull();
    expect(lerReais("12,345")).toBeNull();
    expect(lerReais("-12,00")).toBeNull();
    expect(lerReais("1.23,00")).toBeNull();
  });
  test("formatarReais", () => {
    expect(formatarReais(123456)).toBe("R$ 1.234,56");
    expect(formatarReais(-1200)).toBe("−R$ 12,00");
    expect(formatarReais(0)).toBe("R$ 0,00");
    expect(formatarReais(5)).toBe("R$ 0,05");
    expect(formatarReais(100000000)).toBe("R$ 1.000.000,00");
  });
});
