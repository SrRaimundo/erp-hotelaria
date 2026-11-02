import { ErroDominio } from "../../shared/erros.js";

export const SINAL: Record<string, 1 | -1> = { credito: 1, transferencia_in: 1, debito: -1, transferencia_out: -1 };

/** Valida "AAAA-MM-DD" e devolve início/fim (UTC) do intervalo. */
export function intervalo(data_inicio: string, data_fim: string): { inicio: string; fim: string } {
  for (const d of [data_inicio, data_fim]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) {
      throw new ErroDominio("VALIDACAO_FALHOU", "Data inválida; use AAAA-MM-DD.");
    }
  }
  if (data_inicio > data_fim) throw new ErroDominio("VALIDACAO_FALHOU", "data_inicio deve ser anterior ou igual a data_fim.");
  return { inicio: `${data_inicio}T00:00:00.000Z`, fim: `${data_fim}T23:59:59.999Z` };
}

export function intervaloDia(data: string): { inicio: string; fim: string } {
  return intervalo(data, data);
}
