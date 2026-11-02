import { describe, expect, test } from "vitest";
import type { Relatorio } from "../../src/api/tipos";
import { gerarPdf } from "../../src/telas/relatorios/gerarPdf";

const CABECALHO = { nome: "Pousada Açaí", razaoSocial: "Sol Hotelaria Ltda", cnpj: "12.345.678/0001-90", endereco: "Rua das Flores, 10", usuario: "João" };

function relatorio(extras: number): Relatorio {
  const cols = Array.from({ length: extras }, (_, i) => ({ chave: `c${i}`, titulo: `Col ${i}`, tipo: "texto" as const }));
  return {
    id: "check-in",
    titulo: "Lista de check-in",
    subtitulo: "Chegadas em 20/11/2026",
    geradoEm: "2026-11-20T15:30:00.000Z",
    resumo: [{ rotulo: "Saldo", valor: "R$ 1.234,56" }],
    secoes: [
      {
        colunas: [
          { chave: "hospede", titulo: "Hóspede", tipo: "texto" },
          { chave: "saldo", titulo: "Saldo", tipo: "dinheiro" },
          { chave: "feito", titulo: "Feito", tipo: "em-branco" },
          ...cols,
        ],
        linhas: [
          { hospede: "Conceição", saldo: 123456, feito: null },
          { hospede: "Zé", saldo: null, feito: null },
        ],
      },
    ],
  };
}

/** Bytes do PDF como texto Latin-1: cada caractere do resultado é um byte do arquivo. */
const bytes = (b: Blob) =>
  new Promise<string>((ok) => {
    const f = new FileReader();
    f.onload = () => ok(Buffer.from(f.result as ArrayBuffer).toString("latin1"));
    f.readAsArrayBuffer(b);
  });

describe("gerarPdf (saída real da biblioteca)", () => {
  test("é um PDF e os acentos saem em WinAnsi (Latin-1), não perdidos nem em UTF-8", async () => {
    const pdf = await bytes(gerarPdf(relatorio(0), CABECALHO));
    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf).toContain("(Concei\xe7\xe3o) Tj");
    expect(pdf).toContain("(Pousada A\xe7a\xed) Tj");
    expect(pdf).toContain("(H\xf3spede) Tj");
    expect(pdf).toContain("(R$ 1.234,56) Tj");
    expect(pdf).toContain("WinAnsiEncoding");
    // traço de saldo nulo: travessão do WinAnsi (0x97), não descartado
    expect(pdf).toContain("(\x97) Tj");
    expect(pdf).not.toContain("\xc3\xa7"); // "ç" em UTF-8 não pode aparecer
  });

  test("cabeçalho: estabelecimento, razão social, CNPJ, endereço, título e quem gerou", async () => {
    const pdf = await bytes(gerarPdf(relatorio(0), CABECALHO));
    for (const t of ["Sol Hotelaria Ltda", "CNPJ 12.345.678/0001-90", "Rua das Flores, 10", "Lista de check-in", "Gerado em 20/11/2026"]) expect(pdf).toContain(t);
    expect(pdf).toContain("por Jo\xe3o");
  });

  test("retrato até 6 colunas e paisagem acima disso", async () => {
    const retrato = await bytes(gerarPdf(relatorio(3), CABECALHO)); // 6 colunas
    const paisagem = await bytes(gerarPdf(relatorio(4), CABECALHO)); // 7 colunas
    const caixa = (s: string) => /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(s)!.slice(1).map(Number);
    const [lr, ar] = caixa(retrato);
    const [lp, ap] = caixa(paisagem);
    expect(lr!).toBeLessThan(ar!);
    expect(lp!).toBeGreaterThan(ap!);
  });

  test("sinal de menos do dinheiro negativo vira hífen (a fonte padrão não tem U+2212)", async () => {
    const r = relatorio(0);
    r.secoes[0]!.linhas[1]!.saldo = -500;
    expect(await bytes(gerarPdf(r, CABECALHO))).toContain("(-R$ 5,00) Tj");
  });

  test("seção vazia imprime a mensagem de vazio", async () => {
    const r = relatorio(0);
    r.secoes[0]!.linhas = [];
    expect(await bytes(gerarPdf(r, CABECALHO))).toContain("(Nada para mostrar neste filtro) Tj");
  });
});
