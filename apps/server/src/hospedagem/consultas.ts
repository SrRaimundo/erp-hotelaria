import { alertasAbertos, type Alerta } from "../infra/alertas.js";
import { buscarHospedes, type Hospede } from "../nucleo/hospedes.js";
import { obterConfig } from "../nucleo/pousada.js";
import type { SituacaoQuarto } from "../nucleo/quartos.js";
import type { Contexto } from "../shared/contexto.js";
import { diaHoteleiro, type Data } from "../shared/tempo.js";
import type { EstadoReserva } from "./estados.js";

export type ItemReserva = {
  reservaId: string;
  codigo: number;
  titular: string;
  quartoNumero: string | null;
  chegada: Data;
  saida: Data;
};

export type Barra = {
  reservaId: string;
  codigo: number;
  quartoId: string | null;
  categoriaId: string;
  chegada: Data;
  saida: Data;
  estado: EstadoReserva;
  titular: string;
};

export type Mapa = {
  quartos: { id: string; numero: string; categoria: string; situacao: SituacaoQuarto }[];
  barras: Barra[];
};

export type Painel = {
  dia: Data;
  chegadas: ItemReserva[];
  saidas: ItemReserva[];
  hospedados: number;
  quartosSujos: { quartoId: string; numero: string }[];
  sinaisVencendo: ItemReserva[];
  chegadasVencidas: ItemReserva[];
  alertas: Alerta[];
};

export type ResultadoBusca = { tipo: "quarto" | "hospede" | "reserva"; id: string; rotulo: string; acoes: string[] };

const ESTADOS_NO_MAPA: EstadoReserva[] = ["pre_reserva", "confirmada", "hospedada", "finalizada"];
const LIMITE_BUSCA = 10;

/** Reservas com titular e número do quarto (se houver), na ordem de chegada. */
function reservasComTitular(ctx: Contexto) {
  return ctx.db
    .selectFrom("reservas as r")
    .innerJoin("hospedes as h", "h.id", "r.titular_id")
    .leftJoin("quartos as q", "q.id", "r.quarto_id")
    .orderBy("r.chegada")
    .orderBy("r.codigo");
}

const campos = ["r.id as reservaId", "r.codigo", "h.nome as titular", "q.numero as quartoNumero", "r.chegada", "r.saida"] as const;

export async function mapaOcupacao(ctx: Contexto, p: { inicio: Data; fim: Data; categoriaId?: string }): Promise<Mapa> {
  let qq = ctx.db
    .selectFrom("quartos as q")
    .innerJoin("categorias as c", "c.id", "q.categoria_id")
    .select(["q.id", "q.numero", "c.nome as categoria", "q.situacao"])
    .orderBy("q.numero");
  if (p.categoriaId) qq = qq.where("q.categoria_id", "=", p.categoriaId);

  let qb = reservasComTitular(ctx)
    .select(["r.id as reservaId", "r.codigo", "r.quarto_id", "r.categoria_id", "r.chegada", "r.saida", "r.estado", "h.nome as titular"])
    .where("r.estado", "in", ESTADOS_NO_MAPA)
    .where("r.chegada", "<=", p.fim)
    .where("r.saida", ">", p.inicio);
  if (p.categoriaId) qb = qb.where("r.categoria_id", "=", p.categoriaId);

  const quartos = await qq.execute();
  const barras = await qb.execute();
  return {
    quartos: quartos.map((q) => ({ id: q.id, numero: q.numero, categoria: q.categoria, situacao: q.situacao })),
    barras: barras.map((b) => ({
      reservaId: b.reservaId, codigo: b.codigo, quartoId: b.quarto_id, categoriaId: b.categoria_id,
      chegada: b.chegada, saida: b.saida, estado: b.estado, titular: b.titular,
    })),
  };
}

export async function painelDoDia(ctx: Contexto): Promise<Painel> {
  const agora = ctx.relogio.agora();
  const config = await obterConfig(ctx);
  const dia = diaHoteleiro(agora, config.fuso, config.viradaDia);
  const ate = new Date(agora.getTime() + 24 * 3_600_000).toISOString();

  const chegadas = await reservasComTitular(ctx).select(campos).where("r.estado", "in", ["pre_reserva", "confirmada"]).where("r.chegada", "=", dia).execute();
  const saidas = await reservasComTitular(ctx).select(campos).where("r.estado", "=", "hospedada").where("r.saida", "=", dia).execute();
  const hospedados = await ctx.db.selectFrom("reservas").select((eb) => eb.fn.countAll<number>().as("n")).where("estado", "=", "hospedada").executeTakeFirstOrThrow();
  const sujos = await ctx.db.selectFrom("quartos").select(["id", "numero"]).where("situacao", "=", "sujo").orderBy("numero").execute();
  const sinais = await reservasComTitular(ctx)
    .select(campos)
    .where("r.estado", "=", "pre_reserva")
    .where("r.prazo_sinal", ">", agora.toISOString())
    .where("r.prazo_sinal", "<=", ate)
    .execute();
  const vencidas = await reservasComTitular(ctx).select(campos).where("r.estado", "=", "confirmada").where("r.chegada", "<", dia).execute();
  return {
    dia,
    chegadas,
    saidas,
    hospedados: Number(hospedados.n),
    quartosSujos: sujos.map((q) => ({ quartoId: q.id, numero: q.numero })),
    sinaisVencendo: sinais,
    chegadasVencidas: vencidas,
    alertas: await alertasAbertos(ctx),
  };
}

const ACOES_RESERVA: Partial<Record<EstadoReserva, string[]>> = {
  pre_reserva: ["abrir", "registrar_pagamento"],
  confirmada: ["abrir", "checkin"],
  hospedada: ["abrir", "lancar_extra", "checkout"],
};

const diaMes = (d: Data) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function rotuloHospede(h: Hospede): string {
  if (!h.documento) return h.nome;
  if (h.documentoTipo === "cpf") return `${h.nome} — CPF ***.***.${h.documento.slice(6, 9)}-${h.documento.slice(9, 11)}`;
  return `${h.nome} — ${h.documento}`;
}

/** Dígitos curtos (≤ 4): quarto e código de reserva. Demais termos: nome, CPF ou documento do hóspede. */
export async function buscaUniversal(ctx: Contexto, q: string): Promise<ResultadoBusca[]> {
  const termo = q.trim();
  if (!termo) return [];
  const r: ResultadoBusca[] = [];

  if (/^\d{1,4}$/.test(termo)) {
    const quartos = await ctx.db.selectFrom("quartos").select(["id", "numero"]).where("numero", "=", termo).orderBy("id").execute();
    for (const x of quartos) r.push({ tipo: "quarto", id: x.id, rotulo: `Quarto ${x.numero}`, acoes: ["ver_quarto"] });
    const reservas = await reservasComTitular(ctx)
      .select(["r.id", "r.codigo", "r.estado", "r.chegada", "r.saida", "h.nome as titular"])
      .where("r.codigo", "=", Number(termo))
      .execute();
    for (const x of reservas) {
      r.push({
        tipo: "reserva",
        id: x.id,
        rotulo: `Reserva #${x.codigo} — ${x.titular} (${diaMes(x.chegada)}–${diaMes(x.saida)})`,
        acoes: ACOES_RESERVA[x.estado as EstadoReserva] ?? ["abrir"],
      });
    }
  } else {
    for (const h of await buscarHospedes(ctx, termo)) {
      r.push({ tipo: "hospede", id: h.id, rotulo: rotuloHospede(h), acoes: ["nova_reserva", "ver_historico"] });
    }
  }
  return r.slice(0, LIMITE_BUSCA);
}

export async function historicoEstadias(ctx: Contexto, hospedeId: string): Promise<ItemReserva[]> {
  return reservasComTitular(ctx)
    .clearOrderBy()
    .select(campos)
    .where("r.titular_id", "=", hospedeId)
    .where("r.estado", "=", "finalizada")
    .orderBy("r.chegada", "desc")
    .orderBy("r.codigo", "desc")
    .execute();
}
