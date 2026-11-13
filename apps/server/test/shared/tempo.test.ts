import { expect, test } from "vitest";
import { dataLocal, diaDaSemana, diaHoteleiro, horaLocal, idadeEm, noites, somarDias } from "../../src/shared/tempo.js";

test("noites exclui a saída", () => {
  expect(noites("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
});
test("diaHoteleiro antes da virada é o dia anterior", () => {
  expect(diaHoteleiro(new Date("2026-11-10T06:59:00Z"), "America/Sao_Paulo", "04:00")).toBe("2026-11-09");
  expect(diaHoteleiro(new Date("2026-11-10T07:00:00Z"), "America/Sao_Paulo", "04:00")).toBe("2026-11-10");
});
test("idadeEm considera aniversário", () => {
  expect(idadeEm("2020-12-31", "2026-12-30")).toBe(5);
  expect(idadeEm("2020-12-31", "2026-12-31")).toBe(6);
});
test("somarDias atravessa mês e ano, inclusive negativo", () => {
  expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
  expect(somarDias("2027-03-01", -1)).toBe("2027-02-28");
});
test("diaDaSemana: 0 é domingo", () => {
  expect(diaDaSemana("2026-11-08")).toBe(0);
  expect(diaDaSemana("2026-11-10")).toBe(2);
});
test("dataLocal e horaLocal usam o fuso", () => {
  const i = new Date("2026-11-10T02:30:00Z");
  expect(dataLocal(i, "America/Sao_Paulo")).toBe("2026-11-09");
  expect(horaLocal(i, "America/Sao_Paulo")).toBe("23:30");
});

import { inicioDoDiaNoFuso } from "../../src/shared/tempo.js";
test("inicioDoDiaNoFuso: meia-noite local em UTC (com e sem horário de verão)", () => {
  expect(inicioDoDiaNoFuso("2026-11-02", "America/Sao_Paulo").toISOString()).toBe("2026-11-02T03:00:00.000Z");
  expect(inicioDoDiaNoFuso("2026-11-02", "UTC").toISOString()).toBe("2026-11-02T00:00:00.000Z");
  expect(inicioDoDiaNoFuso("2026-07-01", "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z");
  expect(inicioDoDiaNoFuso("2026-01-01", "America/New_York").toISOString()).toBe("2026-01-01T05:00:00.000Z");
});
