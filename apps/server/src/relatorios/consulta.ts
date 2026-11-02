import { sql } from "kysely";
import { obterConfig } from "../nucleo/pousada.js";
import type { Contexto } from "../shared/contexto.js";
import { dataValida, diaHoteleiro, diasEntre, type Data } from "../shared/tempo.js";
import { z } from "zod";
import type { EstadoReserva } from "../hospedagem/estados.js";
import { A_DEFINIR } from "./modelo.js";

export type ReservaRel = {
  reservaId: string;
  codigo: number;
  hospede: string;
  telefone: string | null;
  quarto: string;
  categoria: string;
  adultos: number;
  criancas: number;
  chegada: Data;
  saida: Data;
  noites: number;
  estado: EstadoReserva;
  contaId: string;
};

const ROTULO_ESTADO: Record<EstadoReserva, string> = {
  pre_reserva: "Pré-reserva", confirmada: "Confirmada", hospedada: "Hospedada",
  finalizada: "Finalizada", cancelada: "Cancelada", no_show: "No-show",
};
export const rotuloEstado = (e: EstadoReserva) => ROTULO_ESTADO[e];

/** Filtro `data` (YYYY-MM-DD, opcional; vazio vale como ausente). */
export const filtroData = z.object({
  data: z.preprocess((v) => (v === "" ? undefined : v), z.string().refine(dataValida, "Data inválida. Use AAAA-MM-DD.").optional()),
});

export async function dataOuHoje(ctx: Contexto, data: Data | undefined): Promise<Data> {
  if (data) return data;
  const config = await obterConfig(ctx);
  return diaHoteleiro(ctx.relogio.agora(), config.fuso, config.viradaDia);
}

export const ordemQuarto = (a: { quarto: string; hospede: string }, b: { quarto: string; hospede: string }) => {
  const semA = a.quarto === A_DEFINIR, semB = b.quarto === A_DEFINIR;
  if (semA !== semB) return semA ? 1 : -1;
  return a.quarto.localeCompare(b.quarto, "pt-BR", { numeric: true }) || a.hospede.localeCompare(b.hospede, "pt-BR");
};

/**
 * Todas as reservas dos estados pedidos que cumprem `onde` (sem paginação, ao contrário de listarReservas,
 * que é limitada a 100 por página e não traz telefone, pessoas nem conta). Quarto desativado continua aparecendo.
 */
export async function reservasParaRelatorio(
  ctx: Contexto,
  estados: EstadoReserva[],
  onde: { reservaId?: string; contaId?: string; chegada?: Data; saida?: Data; chegadaAntes?: Data; saidaDepoisOuEm?: Data },
): Promise<ReservaRel[]> {
  let qb = ctx.db
    .selectFrom("reservas as r")
    .innerJoin("hospedes as h", "h.id", "r.titular_id")
    .innerJoin("categorias as c", "c.id", "r.categoria_id")
    .leftJoin("quartos as q", "q.id", "r.quarto_id")
    .select([
      "r.id as reservaId", "r.codigo", "h.nome as hospede", "h.telefone", "q.numero as quarto", "c.nome as categoria",
      "r.adultos", "r.criancas", "r.chegada", "r.saida", "r.estado", "r.conta_id as contaId",
    ])
    .where("r.estado", "in", estados);
  if (onde.reservaId) qb = qb.where("r.id", "=", onde.reservaId);
  if (onde.contaId) qb = qb.where("r.conta_id", "=", onde.contaId);
  if (onde.chegada) qb = qb.where("r.chegada", "=", onde.chegada);
  if (onde.saida) qb = qb.where("r.saida", "=", onde.saida);
  if (onde.chegadaAntes) qb = qb.where("r.chegada", "<", onde.chegadaAntes);
  if (onde.saidaDepoisOuEm) qb = qb.where("r.saida", ">=", onde.saidaDepoisOuEm);
  const linhas = await qb.execute();
  return linhas
    .map((l): ReservaRel => ({
      reservaId: l.reservaId, codigo: l.codigo, hospede: l.hospede, telefone: l.telefone ?? null, quarto: l.quarto ?? A_DEFINIR,
      categoria: l.categoria, adultos: l.adultos, criancas: (JSON.parse(l.criancas) as unknown[]).length,
      chegada: l.chegada, saida: l.saida, noites: diasEntre(l.chegada, l.saida), estado: l.estado, contaId: l.contaId,
    }))
    .sort(ordemQuarto);
}

/** Saldo (débitos − créditos) de várias contas em 2 consultas, no lugar de `saldo()` por conta (N+1). */
export async function saldosDeContas(ctx: Contexto, contaIds: string[]): Promise<Map<string, number>> {
  const saldos = new Map<string, number>(contaIds.map((id) => [id, 0]));
  for (let i = 0; i < contaIds.length; i += 500) {
    const lote = contaIds.slice(i, i + 500);
    const deb = await ctx.db.selectFrom("lancamentos").select(["conta_id", sql<number>`sum(valor)`.as("t")]).where("conta_id", "in", lote).groupBy("conta_id").execute();
    const cred = await ctx.db.selectFrom("pagamentos").select(["conta_id", sql<number>`sum(valor)`.as("t")]).where("conta_id", "in", lote).groupBy("conta_id").execute();
    for (const d of deb) saldos.set(d.conta_id, (saldos.get(d.conta_id) ?? 0) + Number(d.t));
    for (const c of cred) saldos.set(c.conta_id, (saldos.get(c.conta_id) ?? 0) - Number(c.t));
  }
  return saldos;
}
