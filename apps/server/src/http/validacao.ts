import { z } from "zod";
import { dataValida, diasEntre, MAX_NOITES } from "../shared/tempo.js";

/** Data de calendário AAAA-MM-DD que existe de fato (2026-02-30 é recusada). */
export const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD")
  .refine(dataValida, "Esta data não existe no calendário. Confira o dia e o mês.");

/** Estadia de no máximo MAX_NOITES noites (só avalia quando a saída vem depois da chegada). */
export const estadiaPermitida = (p: { chegada: string; saida: string }) => !(p.chegada < p.saida) || diasEntre(p.chegada, p.saida) <= MAX_NOITES;
export const MSG_ESTADIA_LONGA = `A estadia pode ter no máximo ${MAX_NOITES} noites. Encurte o período.`;
