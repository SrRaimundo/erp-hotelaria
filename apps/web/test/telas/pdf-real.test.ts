import { jsPDF } from "jspdf";
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

  test("resumo longo (fechamento de caixa) quebra em linhas que cabem na largura da folha", async () => {
    const r = relatorio(0);
    r.resumo = [
      { rotulo: "Turno", valor: "Maria Recepção" }, { rotulo: "Abertura", valor: "20/11/2026 08:00" }, { rotulo: "Fechamento", valor: "20/11/2026 18:00" },
      { rotulo: "Esperado", valor: "R$ 12.345,67" }, { rotulo: "Contado", valor: "R$ 12.340,67" }, { rotulo: "Diferença", valor: "-R$ 5,00" },
      { rotulo: "Movimentos", valor: "48" },
    ];
    r.secoes[0]!.colunas.push(...[0, 1, 2, 3].map((i) => ({ chave: `x${i}`, titulo: `X${i}`, tipo: "texto" as const }))); // paisagem
    const pdf = await bytes(gerarPdf(r, CABECALHO));
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const util = doc.internal.pageSize.getWidth() - 2 * 12;
    const textos = [...pdf.matchAll(/\(([^)]*)\) Tj/g)].map((m) => m[1]!);
    expect(textos.some((t) => t.startsWith("Turno: "))).toBe(true);
    expect(textos.some((t) => t.includes("Diferença: -R$ 5,00"))).toBe(true); // nada cortado
    for (const t of textos) expect(doc.getTextWidth(t), t).toBeLessThanOrEqual(util);
    expect(textos.filter((t) => t.includes(" | ")).length).toBeGreaterThan(1); // quebrou em mais de uma linha
  });

  test("título da segunda seção nunca fica solto no pé da página", async () => {
    for (let linhas = 28; linhas <= 48; linhas++) {
      const r = relatorio(0);
      r.secoes[0]!.linhas = Array.from({ length: linhas }, (_, i) => ({ hospede: `H${i}`, saldo: i, feito: null }));
      r.secoes.push({ titulo: "Segunda seção", colunas: r.secoes[0]!.colunas, linhas: [{ hospede: "Z", saldo: 1, feito: null }] });
      const m = /([\d.]+) ([\d.]+) Td\n\(Segunda seção\) Tj/.exec(await bytes(gerarPdf(r, CABECALHO)));
      expect(m, `${linhas} linhas`).not.toBeNull();
      expect(Number(m![2]), `${linhas} linhas`).toBeGreaterThan(60); // pt a partir do rodapé (A4 retrato)
    }
  });
});
