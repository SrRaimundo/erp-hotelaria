import { describe, expect, test } from "vitest";
import { dividirValor, gerarDatas, rotuloParcela, validarParcelas } from "../../src/financeiro/servicos/parcelamento.js";

describe("divisão do valor", () => {
  test("as sobras de centavos vão para a PRIMEIRA parcela", () => {
    expect(dividirValor(100000, 3)).toEqual([33334, 33333, 33333]);
    expect(dividirValor(100000, 4)).toEqual([25000, 25000, 25000, 25000]);
    expect(dividirValor(100002, 5)).toEqual([20002, 20000, 20000, 20000, 20000]);
  });
  test("a soma é sempre o total", () => {
    for (const [t, n] of [[1, 1], [101, 7], [99999, 60], [100000, 3], [5, 2]] as const) {
      expect(dividirValor(t, n).reduce((a, b) => a + b, 0)).toBe(t);
    }
  });
  test("recusa parcelas que dariam menos de 1 centavo", () => {
    expect(() => dividirValor(5, 6)).toThrow(/centavo/);
  });
});

describe("datas", () => {
  test("a cada 30 dias, contados da primeira data", () => {
    expect(gerarDatas("2026-01-31", 4, "30_dias")).toEqual(["2026-01-31", "2026-03-02", "2026-04-01", "2026-05-01"]);
  });
  test("todo mês no mesmo dia, com ajuste para o último dia do mês", () => {
    expect(gerarDatas("2026-01-31", 5, "mensal")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
    expect(gerarDatas("2028-01-31", 2, "mensal")).toEqual(["2028-01-31", "2028-02-29"]);
    expect(gerarDatas("2026-11-30", 3, "mensal")).toEqual(["2026-11-30", "2026-12-30", "2027-01-30"]);
    expect(gerarDatas("2026-12-15", 3, "mensal")).toEqual(["2026-12-15", "2027-01-15", "2027-02-15"]);
  });
});

describe("validação", () => {
  const ok = [{ vencimento: "2026-12-01", valor: 60000 }, { vencimento: "2027-01-01", valor: 40000 }];
  test("aceita soma exata, datas crescentes e de 2 a 60 parcelas", () => {
    expect(validarParcelas(100000, ok)).toEqual([]);
  });
  test("soma diferente do total", () => {
    expect(validarParcelas(100000, [{ ...ok[0]!, valor: 60001 }, ok[1]!])[0]).toMatch(/soma/i);
  });
  test("datas repetidas ou fora de ordem", () => {
    expect(validarParcelas(100000, [ok[0]!, { ...ok[1]!, vencimento: "2026-12-01" }]).join(" ")).toMatch(/ordem crescente/);
    expect(validarParcelas(100000, [ok[1]!, ok[0]!]).join(" ")).toMatch(/ordem crescente/);
  });
  test("data inexistente, valor zero, menos de 2 e mais de 60 parcelas", () => {
    expect(validarParcelas(100000, [{ ...ok[0]!, vencimento: "2026-02-30" }, ok[1]!]).join(" ")).toMatch(/data/i);
    expect(validarParcelas(100000, [{ ...ok[0]!, valor: 0 }, { ...ok[1]!, valor: 100000 }]).join(" ")).toMatch(/maior que zero/);
    expect(validarParcelas(100000, [ok[0]!]).join(" ")).toMatch(/pelo menos 2/);
    const muitas = Array.from({ length: 61 }, (_, i) => ({ vencimento: gerarDatas("2026-01-01", 61, "30_dias")[i]!, valor: 1 }));
    expect(validarParcelas(61, muitas).join(" ")).toMatch(/no máximo 60/);
  });
});

test("rótulo da parcela e do saldo", () => {
  expect(rotuloParcela("NF 10", 2, 4)).toBe("NF 10 – parcela 2/4");
  expect(rotuloParcela("NF 10", 2, 4, true)).toBe("NF 10 – parcela 2/4 – saldo");
});
