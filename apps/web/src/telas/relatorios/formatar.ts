import type { Coluna, Relatorio, Secao } from "../../api/tipos";
import { formatarData } from "../../lib/datas";
import { formatarReais } from "../../lib/dinheiro";

type Valor = string | number | null | undefined;

/** Traço para valor ausente (ex.: saldo de reserva irmã na conta do grupo). */
export const VAZIO = "—";

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** Único lugar que formata valores de relatório: o visor e o PDF leem daqui. Coluna "em-branco" fica vazia, para escrever à mão. */
export function formatarCelula(coluna: Coluna, valor: Valor): string {
  if (coluna.tipo === "em-branco") return "";
  if (valor === null || valor === undefined || valor === "") return VAZIO;
  if (coluna.tipo === "dinheiro") return typeof valor === "number" ? formatarReais(valor) : valor;
  if (coluna.tipo === "data") return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? formatarData(valor, true) : String(valor);
  return String(valor);
}

export type TabelaFormatada = {
  titulos: string[];
  /** Alinhamento por coluna: números e dinheiro à direita. */
  alinhamentos: ("esquerda" | "direita")[];
  emBranco: boolean[];
  linhas: string[][];
  /** Linha de totais já formatada (primeira coluna "Total" se não tiver total próprio) ou null. */
  totais: string[] | null;
};

export function tabelaDaSecao(secao: Secao): TabelaFormatada {
  const { colunas } = secao;
  const totais = secao.totais ?? null;
  return {
    titulos: colunas.map((c) => c.titulo),
    alinhamentos: colunas.map((c) => (c.tipo === "numero" || c.tipo === "dinheiro" ? "direita" : "esquerda")),
    emBranco: colunas.map((c) => c.tipo === "em-branco"),
    linhas: secao.linhas.map((l) => colunas.map((c) => formatarCelula(c, l[c.chave]))),
    totais: totais ? colunas.map((c, i) => (c.chave in totais ? formatarCelula(c, totais[c.chave]) : i === 0 ? "Total" : "")) : null,
  };
}

/** "dd/mm/aaaa HH:MM" na hora do navegador. */
export function formatarInstante(iso: string): string {
  const d = new Date(iso);
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()} ${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

/** "AAAA-MM-DD" do instante, na hora do navegador. */
export function dataDoInstante(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}

/** `<id>-<data>.pdf`: a data é a do filtro (AAAA-MM-DD) quando há; senão a do instante de geração. */
export const nomeDoArquivo = (r: Pick<Relatorio, "id" | "geradoEm">, data?: string) => `${r.id}-${data || dataDoInstante(r.geradoEm)}.pdf`;
