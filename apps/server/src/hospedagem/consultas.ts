import { alertasAbertos, type Alerta } from "../infra/alertas.js";
import { buscarHospedes, paraHospede, pendenciasFnrh, type Hospede } from "../nucleo/hospedes.js";
import { obterConfig } from "../nucleo/pousada.js";
import type { SituacaoQuarto } from "../nucleo/quartos.js";
import type { Contexto } from "../shared/contexto.js";
import { formatarBRL, type Centavos } from "../shared/dinheiro.js";
import { dataLocal, diaHoteleiro, diasEntre, horaLocal, idadeEm, somarDias, type Data } from "../shared/tempo.js";
import { pagoNaReserva, saldo } from "./conta.js";
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

export type ItemChegada = ItemReserva & {
  estado: EstadoReserva;
  noites: number;
  adultos: number;
  criancas: number;
  canal: string;
  sinalPendente: Centavos;
  pendenciasFnrh: boolean;
};

export type ItemSaida = ItemReserva & { contaId: string; saldo: Centavos };

export type ItemAtencao = {
  tipo: "sinal_vencendo" | "chegada_atrasada" | "alerta";
  id: string;
  titulo: string;
  detalhe: string;
  reservaId: string | null;
  contaId: string | null;
  telefone: string | null;
  acoes: ("registrar_sinal" | "prorrogar_sinal" | "marcar_no_show" | "abrir_reserva" | "abrir_conta" | "resolver_alerta")[];
};

export type Painel = {
  dia: Data;
  chegadas: ItemChegada[];
  saidas: ItemSaida[];
  hospedados: number;
  quartosSujos: { quartoId: string; numero: string }[];
  sinaisVencendo: ItemReserva[];
  chegadasVencidas: ItemReserva[];
  alertas: Alerta[];
  ocupacao: { ocupados: number; total: number; percentual: number };
  numeros: {
    chegadas: number;
    chegadasJaHospedadas: number;
    saidas: number;
    hospedados: number;
    pessoasHospedadas: number;
    quartosSujos: number;
    quartosManutencao: number;
    livresHoje: number;
  };
  governanca: { quartoId: string; numero: string; situacao: "sujo" | "em_manutencao" | "bloqueado"; motivo: string | null }[];
  proximosDias: { dia: Data; chegadas: number; saidas: number; ocupacaoPct: number }[];
  atencao: ItemAtencao[];
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

async function ocupacaoDoDia(ctx: Contexto, d: Data, total: number): Promise<{ ocupados: number; percentual: number }> {
  const l = await ctx.db
    .selectFrom("reservas")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("estado", "in", ESTADOS_EM_ABERTO)
    .where("chegada", "<=", d)
    .where("saida", ">", d)
    .executeTakeFirstOrThrow();
  const ocupados = Number(l.n);
  return { ocupados, percentual: total > 0 ? Math.round((ocupados / total) * 100) : 0 };
}

async function contarReservas(ctx: Contexto, coluna: "chegada" | "saida", d: Data): Promise<number> {
  const l = await ctx.db
    .selectFrom("reservas")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("estado", "in", ESTADOS_EM_ABERTO)
    .where(coluna, "=", d)
    .executeTakeFirstOrThrow();
  return Number(l.n);
}

async function governancaDoPainel(ctx: Contexto): Promise<Painel["governanca"]> {
  const quartos = await ctx.db.selectFrom("quartos").select(["id", "numero", "situacao"]).where("situacao", "in", ["sujo", "em_manutencao", "bloqueado"]).execute();
  quartos.sort((a, b) => a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));
  const itens: Painel["governanca"] = [];
  for (const q of quartos) {
    const ultima = await ctx.db
      .selectFrom("auditoria")
      .select("motivo")
      .where("acao", "=", "quarto.situacao")
      .where("alvo_id", "=", q.id)
      .orderBy("instante", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst();
    itens.push({ quartoId: q.id, numero: q.numero, situacao: q.situacao as "sujo" | "em_manutencao" | "bloqueado", motivo: ultima?.motivo ?? null });
  }
  return itens;
}

const semCampoExtra = (x: ItemReserva): ItemReserva => ({
  reservaId: x.reservaId, codigo: x.codigo, titular: x.titular, quartoNumero: x.quartoNumero, chegada: x.chegada, saida: x.saida,
});

export async function painelDoDia(ctx: Contexto): Promise<Painel> {
  const agora = ctx.relogio.agora();
  const config = await obterConfig(ctx);
  const dia = diaHoteleiro(agora, config.fuso, config.viradaDia);
  const ate = new Date(agora.getTime() + 24 * 3_600_000).toISOString();

  const linhasChegadas = await reservasComTitular(ctx)
    .select([...campos, "r.estado", "r.adultos", "r.criancas", "r.canal", "r.valor_sinal", "r.titular_id"])
    .where("r.estado", "in", ESTADOS_EM_ABERTO)
    .where("r.chegada", "=", dia)
    .execute();
  const linhasSaidas = await reservasComTitular(ctx).select([...campos, "r.conta_id"]).where("r.estado", "=", "hospedada").where("r.saida", "=", dia).execute();
  const hospedadas = await ctx.db.selectFrom("reservas").select(["adultos", "criancas"]).where("estado", "=", "hospedada").execute();
  const sujos = await ctx.db.selectFrom("quartos").select(["id", "numero"]).where("situacao", "=", "sujo").orderBy("numero").execute();
  const sinais = await reservasComTitular(ctx)
    .clearOrderBy()
    .select([...campos, "r.valor_sinal", "r.prazo_sinal", "h.telefone"])
    .where("r.estado", "=", "pre_reserva")
    .where("r.prazo_sinal", ">", agora.toISOString())
    .where("r.prazo_sinal", "<=", ate)
    .orderBy("r.prazo_sinal")
    .orderBy("r.codigo")
    .execute();
  const vencidas = await reservasComTitular(ctx).select([...campos, "h.telefone"]).where("r.estado", "=", "confirmada").where("r.chegada", "<", dia).execute();
  const alertas = await alertasAbertos(ctx);

  const situacoes = await ctx.db.selectFrom("quartos").select("situacao").execute();
  const total = situacoes.filter((q) => q.situacao !== "em_manutencao" && q.situacao !== "bloqueado").length;
  const { ocupados, percentual } = await ocupacaoDoDia(ctx, dia, total);

  const titulares = linhasChegadas.length
    ? await ctx.db.selectFrom("hospedes").selectAll().where("id", "in", linhasChegadas.map((c) => c.titular_id)).execute()
    : [];
  const hospedePorId = new Map(titulares.map((t) => [t.id, paraHospede(t)]));
  const chegadas: ItemChegada[] = [];
  for (const c of linhasChegadas) {
    const titular = hospedePorId.get(c.titular_id)!;
    const adulto = !titular.nascimento || idadeEm(titular.nascimento, c.chegada) >= 18;
    const pago = await pagoNaReserva(ctx, c.reservaId);
    chegadas.push({
      ...semCampoExtra(c),
      estado: c.estado, noites: diasEntre(c.chegada, c.saida), adultos: c.adultos, criancas: (JSON.parse(c.criancas) as unknown[]).length,
      canal: c.canal, sinalPendente: Math.max(0, c.valor_sinal - pago), pendenciasFnrh: pendenciasFnrh(titular, adulto).length > 0,
    });
  }
  const saidas: ItemSaida[] = [];
  for (const s of linhasSaidas) {
    saidas.push({ ...semCampoExtra(s), contaId: s.conta_id, saldo: (await saldo(ctx, s.conta_id)).saldo });
  }

  const proximosDias: Painel["proximosDias"] = [];
  for (const n of [1, 2]) {
    const d = somarDias(dia, n);
    proximosDias.push({
      dia: d,
      chegadas: await contarReservas(ctx, "chegada", d),
      saidas: await contarReservas(ctx, "saida", d),
      ocupacaoPct: (await ocupacaoDoDia(ctx, d, total)).percentual,
    });
  }

  const atencao: ItemAtencao[] = [];
  const hojeLocal = dataLocal(agora, config.fuso);
  for (const s of sinais) {
    const prazo = new Date(s.prazo_sinal!);
    const hora = horaLocal(prazo, config.fuso);
    const faltam = Math.max(0, s.valor_sinal - (await pagoNaReserva(ctx, s.reservaId)));
    atencao.push({
      tipo: "sinal_vencendo",
      id: `sinal:${s.reservaId}`,
      titulo: dataLocal(prazo, config.fuso) === hojeLocal ? `Sinal vence às ${hora}` : `Sinal vence amanhã às ${hora}`,
      detalhe: `Reserva #${s.codigo} · ${s.titular} · ${diaMes(s.chegada)}–${diaMes(s.saida)} · faltam ${formatarBRL(faltam)}`,
      reservaId: s.reservaId,
      contaId: null,
      telefone: s.telefone ?? null,
      acoes: ["registrar_sinal", "prorrogar_sinal"],
    });
  }
  for (const v of vencidas) {
    atencao.push({
      tipo: "chegada_atrasada",
      id: `atraso:${v.reservaId}`,
      titulo: "Chegada atrasada",
      detalhe: `Reserva #${v.codigo} · ${v.titular} · era para ${diaMes(v.chegada)}, qto ${v.quartoNumero ?? "sem quarto"}`,
      reservaId: v.reservaId,
      contaId: null,
      telefone: v.telefone ?? null,
      acoes: ["marcar_no_show", "abrir_reserva"],
    });
  }
  for (const a of alertas) {
    let reservaId: string | null = null;
    let contaId: string | null = null;
    const acoes: ItemAtencao["acoes"] = [];
    if (a.alvoTipo === "reserva") {
      reservaId = a.alvoId;
      acoes.push("abrir_reserva");
    } else if (a.alvoTipo === "conta") {
      contaId = a.alvoId;
      const r = await ctx.db.selectFrom("reservas").select("id").where("conta_id", "=", a.alvoId).orderBy("criada_em", "desc").orderBy("codigo", "desc").executeTakeFirst();
      reservaId = r?.id ?? null;
      acoes.push("abrir_conta");
    }
    acoes.push("resolver_alerta");
    atencao.push({ tipo: "alerta", id: a.id, titulo: a.mensagem, detalhe: "", reservaId, contaId, telefone: null, acoes });
  }

  return {
    dia,
    chegadas,
    saidas,
    hospedados: hospedadas.length,
    quartosSujos: sujos.map((q) => ({ quartoId: q.id, numero: q.numero })),
    sinaisVencendo: sinais.map(semCampoExtra),
    chegadasVencidas: vencidas.map(semCampoExtra),
    alertas,
    ocupacao: { ocupados, total, percentual },
    numeros: {
      chegadas: chegadas.length,
      chegadasJaHospedadas: chegadas.filter((c) => c.estado === "hospedada").length,
      saidas: saidas.length,
      hospedados: hospedadas.length,
      pessoasHospedadas: hospedadas.reduce((t, h) => t + h.adultos + (JSON.parse(h.criancas) as unknown[]).length, 0),
      quartosSujos: sujos.length,
      quartosManutencao: situacoes.filter((q) => q.situacao === "em_manutencao").length,
      livresHoje: Math.max(0, total - ocupados),
    },
    governanca: await governancaDoPainel(ctx),
    proximosDias,
    atencao,
  };
}

const ACOES_RESERVA: Partial<Record<EstadoReserva, string[]>> = {
  pre_reserva: ["abrir", "registrar_pagamento"],
  confirmada: ["abrir", "checkin"],
  hospedada: ["abrir", "lancar_extra", "checkout"],
};

const diaMes = (d: Data) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const ESTADOS_EM_ABERTO: EstadoReserva[] = ["pre_reserva", "confirmada", "hospedada"];
const camposBusca = ["r.id", "r.codigo", "r.estado", "r.chegada", "r.saida", "h.nome as titular"] as const;

function resultadoReserva(x: { id: string; codigo: number; estado: string; chegada: Data; saida: Data; titular: string }): ResultadoBusca {
  return {
    tipo: "reserva",
    id: x.id,
    rotulo: `Reserva #${x.codigo} — ${x.titular} (${diaMes(x.chegada)}–${diaMes(x.saida)})`,
    acoes: ACOES_RESERVA[x.estado as EstadoReserva] ?? ["abrir"],
  };
}

function rotuloHospede(h: Hospede): string {
  if (!h.documento) return h.nome;
  if (h.documentoTipo === "cpf") return `${h.nome} — CPF ***.***.${h.documento.slice(6, 9)}-${h.documento.slice(9, 11)}`;
  return `${h.nome} — ${h.documento}`;
}

/**
 * Dígitos curtos (≤ 4): quarto e código de reserva. Demais termos: nome, CPF ou documento do hóspede,
 * precedidos das reservas em aberto em que ele é titular. Ordem: quartos, reservas, hóspedes.
 */
export async function buscaUniversal(ctx: Contexto, q: string): Promise<ResultadoBusca[]> {
  const termo = q.trim();
  if (!termo) return [];
  const r: ResultadoBusca[] = [];

  if (/^\d{1,4}$/.test(termo)) {
    const quartos = await ctx.db.selectFrom("quartos").select(["id", "numero"]).where("numero", "=", termo).orderBy("id").execute();
    for (const x of quartos) r.push({ tipo: "quarto", id: x.id, rotulo: `Quarto ${x.numero}`, acoes: ["ver_quarto"] });
    const reservas = await reservasComTitular(ctx).select(camposBusca).where("r.codigo", "=", Number(termo)).execute();
    for (const x of reservas) r.push(resultadoReserva(x));
  } else {
    const hospedes = await buscarHospedes(ctx, termo);
    if (hospedes.length > 0) {
      const reservas = await reservasComTitular(ctx)
        .select(camposBusca)
        .where("r.titular_id", "in", hospedes.map((h) => h.id))
        .where("r.estado", "in", ESTADOS_EM_ABERTO)
        .limit(LIMITE_BUSCA)
        .execute();
      for (const x of reservas) r.push(resultadoReserva(x));
    }
    for (const h of hospedes) {
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
