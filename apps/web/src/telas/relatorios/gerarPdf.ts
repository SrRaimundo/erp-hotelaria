import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Relatorio } from "../../api/tipos";
import { formatarInstante, tabelaDaSecao } from "./formatar";

export type CabecalhoPdf = { nome: string; razaoSocial: string; cnpj: string; endereco: string; usuario: string };

/** Mais de 6 colunas em alguma seção: a folha vai deitada. */
const LIMITE_RETRATO = 6;
const MARGEM = 12;

/**
 * Helvetica padrão do PDF cobre Latin-1 (acentos do português) e o travessão; o sinal de menos tipográfico
 * (U+2212) que o formatador de dinheiro usa não existe nela, então vira hífen.
 */
const limpo = (s: string) => s.replaceAll("−", "-");

/** Monta o PDF do relatório (A4) no navegador. Este módulo só é carregado por `import()` no clique. */
export function gerarPdf(relatorio: Relatorio, cabecalho: CabecalhoPdf): Blob {
  const tabelas = relatorio.secoes.map((s) => ({ secao: s, t: tabelaDaSecao(s) }));
  const paisagem = relatorio.secoes.some((s) => s.colunas.length > LIMITE_RETRATO);
  const doc = new jsPDF({ orientation: paisagem ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const largura = doc.internal.pageSize.getWidth();

  let y = MARGEM;
  const linha = (texto: string, tamanho: number, negrito = false) => {
    if (!texto) return;
    doc.setFont("helvetica", negrito ? "bold" : "normal");
    doc.setFontSize(tamanho);
    doc.text(limpo(texto), MARGEM, y);
    y += tamanho * 0.45 + 1.5;
  };
  linha(cabecalho.nome || cabecalho.razaoSocial, 13, true);
  if (cabecalho.nome && cabecalho.razaoSocial && cabecalho.razaoSocial !== cabecalho.nome) linha(cabecalho.razaoSocial, 9);
  linha(cabecalho.cnpj ? `CNPJ ${cabecalho.cnpj}` : "", 9);
  linha(cabecalho.endereco, 9);
  y += 2;
  linha(relatorio.titulo, 14, true);
  linha(relatorio.subtitulo, 10);
  linha(`Gerado em ${formatarInstante(relatorio.geradoEm)} por ${cabecalho.usuario}`, 9);
  if (relatorio.resumo.length > 0) linha(relatorio.resumo.map((r) => `${r.rotulo}: ${r.valor}`).join("   |   "), 10, true);
  y += 2;

  for (const { secao, t } of tabelas) {
    if (secao.titulo) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(limpo(secao.titulo), MARGEM, y + 3);
      y += 5;
    }
    if (secao.linhas.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Nada para mostrar neste filtro", MARGEM, y + 4);
      y += 10;
      continue;
    }
    autoTable(doc, {
      startY: y,
      margin: { left: MARGEM, right: MARGEM, bottom: 14 },
      head: [t.titulos.map(limpo)],
      body: t.linhas.map((l) => l.map(limpo)),
      foot: t.totais ? [t.totais.map(limpo)] : undefined,
      showHead: "everyPage",
      showFoot: "lastPage",
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.8, lineColor: [60, 60, 60], lineWidth: 0.2, textColor: 20 },
      headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: "bold" },
      footStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: "bold" },
      columnStyles: Object.fromEntries(t.alinhamentos.map((a, i) => [i, { halign: a === "direita" ? "right" : "left" }])),
      // Colunas em branco são para escrever à mão: linha mais alta, com a borda da grade.
      didParseCell: (d) => {
        if (d.section === "body" && t.emBranco[d.column.index]) d.cell.styles.minCellHeight = 9;
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  const paginas = doc.getNumberOfPages();
  const altura = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.text(`Página ${p} de ${paginas}`, largura - MARGEM, altura - 6, { align: "right" });
  }
  return doc.output("blob");
}
