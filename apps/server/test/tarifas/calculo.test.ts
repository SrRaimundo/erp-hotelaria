import { expect, test } from "vitest";
import { calcularNoite } from "../../src/tarifas/calculo.js";
import { classificarCriancas } from "../../src/tarifas/criancas.js";
import type { RegrasNoite } from "../../src/tarifas/tipos.js";
import { ErroDominio } from "../../src/shared/erros.js";

const d = "2026-11-14"; // sábado
const base: RegrasNoite = {
  tabelaPadrao: { porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 },
  canal: { nome: "Balcão", percentual: 0 },
  faixasOcupacao: [{ acimaDe: 70, percentual: 10 }, { acimaDe: 90, percentual: 25 }],
  ocupacaoPct: 0,
  faixasCrianca: [
    { idadeMin: 0, idadeMax: 5, tipo: "gratis", valor: 0 },
    { idadeMin: 6, idadeMax: 11, tipo: "percentual_adicional", valor: 50 },
  ],
  limiteCriancasGratis: 1,
  idadeAdulto: 12,
  arredondamento: "nenhum",
};
const casal = { adultos: 2, criancasNascimento: [] as string[] };

test("exemplo da spec: 300 → Alta +20% → Sábado +15% → Ocupação 85% +10% = 455,40", () => {
  const r = calcularNoite(d, d, casal, { ...base, temporada: { nome: "Alta", percentual: 20 }, percentualDiaSemana: 15, ocupacaoPct: 85 });
  expect(r.valor).toBe(45540);
  expect(r.passos.map((p) => p.rotulo)).toEqual(["Base", "Alta +20%", "Sábado +15%", "Ocupação 85% +10%"]);
  expect(r.passos.map((p) => p.valor)).toEqual([30000, 36000, 41400, 45540]);
  expect(r.data).toBe(d);
});

test("temporada com tabela própria substitui a base", () => {
  const r = calcularNoite(d, d, casal, {
    ...base,
    temporada: { nome: "Réveillon", tabela: { porAdultos: { 1: 60000, 2: 80000, 3: 95000 }, adultoExtra: 15000 } },
  });
  expect(r.valor).toBe(80000);
  expect(r.passos).toEqual([{ rotulo: "Base", valor: 80000 }]);
});

test("canal deriva do balcão", () => {
  const r = calcularNoite(d, d, casal, { ...base, canal: { nome: "Agência", percentual: -20 } });
  expect(r.valor).toBe(24000);
  expect(r.passos[1]!.rotulo).toBe("Agência −20%");
});

test("teto limita a dinâmica", () => {
  const r = calcularNoite(d, d, casal, { ...base, ocupacaoPct: 95, teto: 35000 });
  expect(r.valor).toBe(35000);
  expect(r.passos.map((p) => p.rotulo)).toEqual(["Base", "Ocupação 95% +25%", "Teto"]);
  expect(r.passos.at(-1)!.valor).toBe(35000);
});

test("piso eleva o valor", () => {
  const r = calcularNoite(d, d, casal, { ...base, canal: { nome: "Agência", percentual: -50 }, piso: 20000 });
  expect(r.valor).toBe(20000);
  expect(r.passos.at(-1)).toEqual({ rotulo: "Piso", valor: 20000 });
});

test("4 adultos usam adulto extra", () => {
  expect(calcularNoite(d, d, { adultos: 4, criancasNascimento: [] }, base).valor).toBe(44000);
});

test("duas crianças de 4 anos com limite 1 grátis: a segunda paga a primeira faixa pagante", () => {
  const r = calcularNoite(d, d, { adultos: 2, criancasNascimento: ["2022-01-01", "2022-02-01"] }, base);
  expect(r.valor).toBe(30000 + 4000);
});

test("criança de 12 anos conta como adulto", () => {
  const r = calcularNoite(d, d, { adultos: 2, criancasNascimento: ["2014-11-01"] }, base);
  expect(r.valor).toBe(36000);
});

test("idade é a da chegada, não da noite", () => {
  // nasceu 2020-11-20: 5 anos na chegada (14/11), faz 6 em 20/11
  const h = { adultos: 2, criancasNascimento: ["2020-11-20"] };
  expect(calcularNoite("2026-11-21", "2026-11-14", h, base).valor).toBe(30000);
});

test("pacote ignora percentuais e piso/teto", () => {
  const r = calcularNoite(d, d, casal, {
    ...base,
    ocupacaoPct: 95,
    teto: 10000,
    percentualDiaSemana: 15,
    pacote: { nome: "Romance", valorNoite: { 1: 40000, 2: 50000, 3: 60000 } },
  });
  expect(r.valor).toBe(50000);
  expect(r.passos).toEqual([{ rotulo: "Pacote Romance", valor: 50000 }]);
});

test("pacote soma crianças pagantes em passo próprio", () => {
  const r = calcularNoite(d, d, { adultos: 2, criancasNascimento: ["2018-01-01"] }, {
    ...base,
    pacote: { nome: "Romance", valorNoite: { 1: 40000, 2: 50000, 3: 60000 } },
  });
  expect(r.valor).toBe(54000);
  expect(r.passos).toEqual([{ rotulo: "Pacote Romance", valor: 50000 }, { rotulo: "Crianças", valor: 4000 }]);
});

test("arredondamento comercial para o real", () => {
  const r = calcularNoite(d, d, casal, { ...base, temporada: { nome: "Alta", percentual: 20 }, percentualDiaSemana: 15, ocupacaoPct: 85, arredondamento: "real" });
  expect(r.valor).toBe(45500);
});

test("percentual decimal e faixa de criança fixa", () => {
  const r = calcularNoite(d, d, { adultos: 2, criancasNascimento: ["2018-01-01"] }, {
    ...base,
    faixasCrianca: [{ idadeMin: 0, idadeMax: 11, tipo: "fixo", valor: 5000 }],
    canal: { nome: "Site", percentual: 12.5 },
  });
  expect(r.passos.map((p) => p.rotulo)).toEqual(["Base", "Site +12.5%"]);
  expect(r.valor).toBe(39375);
});

test("criança sem faixa correspondente lança erro de domínio", () => {
  expect(() => classificarCriancas({ adultos: 2, criancasNascimento: ["2015-01-01"] }, d, [base.faixasCrianca[0]!], 12, 1))
    .toThrowError(ErroDominio);
});
