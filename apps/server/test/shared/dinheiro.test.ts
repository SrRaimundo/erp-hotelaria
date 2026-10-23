import { expect, test } from "vitest";
import { aplicarPercentual, arredondarCentavos, arredondarReal, formatarBRL } from "../../src/shared/dinheiro.js";

test("cadeia de percentuais do exemplo da spec", () => {
  let v = 30000;
  for (const p of [20, 15, 10]) v = aplicarPercentual(v, p);
  expect(arredondarCentavos(v)).toBe(45540);
});
test("arredondarCentavos meio para longe do zero", () => {
  expect(arredondarCentavos(100.5)).toBe(101);
  expect(arredondarCentavos(-100.5)).toBe(-101);
  expect(arredondarCentavos(-0.4)).toBe(0); // toBe usa Object.is: não aceita -0
});
test("arredondarReal", () => {
  expect(arredondarReal(45540)).toBe(45500);
  expect(arredondarReal(45550)).toBe(45600);
});
test("formatarBRL", () => {
  expect(formatarBRL(45540)).toBe("R$ 455,40");
});
