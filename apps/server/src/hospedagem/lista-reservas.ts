import { sql } from "kysely";
import { normalizarBusca } from "../nucleo/hospedes.js";
import type { Centavos } from "../nucleo/caixa.js";
import type { Contexto } from "../shared/contexto.js";
import type { Data } from "../shared/tempo.js";
import type { ItemReserva } from "./consultas.js";
import type { EstadoReserva } from "./estados.js";

export type ItemListaReserva = ItemReserva & { estado: EstadoReserva; canal: string; categoria: string; total: Centavos };

export type FiltroReservas = {
  inicio?: Data;
  fim?: Data;
  estados?: EstadoReserva[];
  canal?: string;
  q?: string;
  pagina?: number;
  porPagina?: number;
};

const POR_PAGINA_PADRAO = 50;
const POR_PAGINA_MAX = 100;

/** Lista paginada de reservas; período por sobreposição, ordem chegada e código decrescentes. */
export async function listarReservas(ctx: Contexto, f: FiltroReservas): Promise<{ itens: ItemListaReserva[]; total: number }> {
  const porPagina = Math.min(Math.max(Math.trunc(f.porPagina ?? POR_PAGINA_PADRAO), 1), POR_PAGINA_MAX);
  const pagina = Math.max(Math.trunc(f.pagina ?? 1), 1);

  const base = () => {
    let qb = ctx.db
      .selectFrom("reservas as r")
      .innerJoin("hospedes as h", "h.id", "r.titular_id")
      .innerJoin("categorias as c", "c.id", "r.categoria_id")
      .leftJoin("quartos as q", "q.id", "r.quarto_id");
    if (f.inicio) qb = qb.where("r.saida", ">", f.inicio);
    if (f.fim) qb = qb.where("r.chegada", "<=", f.fim);
    if (f.estados && f.estados.length > 0) qb = qb.where("r.estado", "in", f.estados);
    if (f.canal) qb = qb.where("r.canal", "=", f.canal);
    const termo = f.q?.trim();
    if (termo) {
      const padrao = `%${normalizarBusca(termo).replace(/[!%_]/g, (c) => "!" + c)}%`; // "!" é o caractere de escape do LIKE
      qb = /^\d+$/.test(termo)
        ? qb.where((eb) => eb.or([eb("r.codigo", "=", Number(termo)), sql<boolean>`h.nome_busca like ${padrao} escape '!'`]))
        : qb.where(sql<boolean>`h.nome_busca like ${padrao} escape '!'`);
    }
    return qb;
  };

  const { n } = await base().select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow();
  const linhas = await base()
    .select([
      "r.id as reservaId", "r.codigo", "h.nome as titular", "q.numero as quartoNumero", "r.chegada", "r.saida",
      "r.estado", "r.canal", "c.nome as categoria",
      sql<number>`(select coalesce(sum(valor), 0) from reserva_noites where reserva_id = r.id)`.as("total"),
    ])
    .orderBy("r.chegada", "desc")
    .orderBy("r.codigo", "desc")
    .limit(porPagina)
    .offset((pagina - 1) * porPagina)
    .execute();
  return { itens: linhas.map((l) => ({ ...l, total: Number(l.total) })), total: Number(n) };
}
