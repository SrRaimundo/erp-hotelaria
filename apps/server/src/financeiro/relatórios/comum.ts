import { obterConfig } from "../../nucleo/pousada.js";
import type { Contexto } from "../../shared/contexto.js";
import { ErroDominio } from "../../shared/erros.js";
import { inicioDoDiaNoFuso, somarDias } from "../../shared/tempo.js";

export const SINAL: Record<string, 1 | -1> = { credito: 1, transferencia_in: 1, debito: -1, transferencia_out: -1 };

/** Início e fim (instantes UTC em ISO) de um dia ou intervalo de dias, contados no fuso da pousada. */
export async function limitesNoFuso(ctx: Contexto, data_inicio: string, data_fim: string): Promise<{ inicio: string; fim: string }> {
  intervalo(data_inicio, data_fim);
  const { fuso } = await obterConfig(ctx);
  return {
    inicio: inicioDoDiaNoFuso(data_inicio, fuso).toISOString(),
    fim: new Date(inicioDoDiaNoFuso(somarDias(data_fim, 1), fuso).getTime() - 1).toISOString(),
  };
}

/** Valida "AAAA-MM-DD" e devolve início/fim do intervalo em UTC (use `limitesNoFuso` para dias da pousada). */
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
