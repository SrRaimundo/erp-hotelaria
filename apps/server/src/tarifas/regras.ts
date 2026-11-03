import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import type { Centavos } from "../shared/dinheiro.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";
import type { Data } from "../shared/tempo.js";
import type { FaixaCrianca, TabelaBase } from "./tipos.js";

type PorAdultos = TabelaBase["porAdultos"];

export type TabelaBaseCategoria = TabelaBase & { categoriaId: string; piso: Centavos | null; teto: Centavos | null };
export type Temporada = {
  id: string; nome: string; inicio: Data; fim: Data; prioridade: number; percentual: number | null;
  tabelas: (TabelaBase & { categoriaId: string })[];
};
export const TIPOS_CANAL = ["direta", "ota", "agencia", "passante"] as const;
export type TipoCanal = (typeof TIPOS_CANAL)[number];
export const CANAL_REFERENCIA = "Balcão";
export type Canal = { id: string; nome: string; percentual: number; exigeSinal: boolean; tipo: TipoCanal; comissaoPercentual: number };
export type FaixaOcupacao = { acimaDe: number; percentual: number };
export type Pacote = {
  id: string; nome: string; categoriaId: string; inicio: Data; fim: Data; minNoites: number;
  valorNoite: PorAdultos; ativo: boolean;
};
export type Restricao = {
  categoriaId: string; data: Data; minNoites: number | null;
  fechadoChegada: boolean; fechadoSaida: boolean; fechadoVenda: boolean;
};

async function registrar(tx: Contexto, ator: string, acao: string, alvoId: string, dados: object): Promise<void> {
  await auditar(tx, { ator, acao: `tarifas.${acao}`, alvoTipo: "tarifas", alvoId, dados });
  await registrarEvento(tx, "tarifas.RegrasAlteradas", { regra: acao });
}

// ---------- tabela base ----------

export async function salvarTabelaBase(
  ctx: Contexto,
  d: { categoriaId: string; porAdultos: PorAdultos; adultoExtra: Centavos; piso?: Centavos | null; teto?: Centavos | null },
  ator: string,
): Promise<TabelaBaseCategoria> {
  return emTransacao(ctx, async (tx) => {
    const r: TabelaBaseCategoria = {
      categoriaId: d.categoriaId, porAdultos: d.porAdultos, adultoExtra: d.adultoExtra,
      piso: d.piso ?? null, teto: d.teto ?? null,
    };
    const valores = { por_adultos: JSON.stringify(r.porAdultos), adulto_extra: r.adultoExtra, piso: r.piso, teto: r.teto };
    await tx.db
      .insertInto("tabelas_base")
      .values({ categoria_id: r.categoriaId, ...valores })
      .onConflict((oc) => oc.column("categoria_id").doUpdateSet(valores))
      .execute();
    await registrar(tx, ator, "tabela_base", r.categoriaId, r);
    return r;
  });
}

export async function listarTabelasBase(ctx: Contexto): Promise<TabelaBaseCategoria[]> {
  const ls = await ctx.db.selectFrom("tabelas_base").selectAll().orderBy("categoria_id").execute();
  return ls.map((l) => ({
    categoriaId: l.categoria_id, porAdultos: JSON.parse(l.por_adultos), adultoExtra: l.adulto_extra, piso: l.piso, teto: l.teto,
  }));
}

// ---------- temporadas ----------

export async function salvarTemporada(
  ctx: Contexto,
  d: {
    id?: string; nome: string; inicio: Data; fim: Data; prioridade: number; percentual?: number | null;
    tabelas?: (TabelaBase & { categoriaId: string })[];
  },
  ator: string,
): Promise<Temporada> {
  return emTransacao(ctx, async (tx) => {
    const t: Temporada = {
      id: d.id ?? novoId(), nome: d.nome, inicio: d.inicio, fim: d.fim, prioridade: d.prioridade,
      percentual: d.percentual ?? null, tabelas: d.tabelas ?? [],
    };
    const valores = { nome: t.nome, inicio: t.inicio, fim: t.fim, prioridade: t.prioridade, percentual: t.percentual };
    await tx.db
      .insertInto("temporadas")
      .values({ id: t.id, ...valores })
      .onConflict((oc) => oc.column("id").doUpdateSet(valores))
      .execute();
    await tx.db.deleteFrom("temporada_tabelas").where("temporada_id", "=", t.id).execute();
    for (const x of t.tabelas) {
      await tx.db
        .insertInto("temporada_tabelas")
        .values({ temporada_id: t.id, categoria_id: x.categoriaId, por_adultos: JSON.stringify(x.porAdultos), adulto_extra: x.adultoExtra })
        .execute();
    }
    await registrar(tx, ator, "temporada", t.id, t);
    return t;
  });
}

/** Remove a temporada e as tabelas dela. Reservas existentes guardam as noites já calculadas (reserva_noites): seus preços não mudam. */
export async function removerTemporada(ctx: Contexto, id: string, ator: string): Promise<void> {
  await emTransacao(ctx, async (tx) => {
    const t = (await listarTemporadas(tx)).find((x) => x.id === id);
    if (!t) throw new ErroDominio("TEMPORADA_NAO_ENCONTRADA", "Temporada não encontrada.", { id });
    await tx.db.deleteFrom("temporada_tabelas").where("temporada_id", "=", id).execute();
    await tx.db.deleteFrom("temporadas").where("id", "=", id).execute();
    await registrar(tx, ator, "temporada_removida", id, t);
  });
}

export async function listarTemporadas(ctx: Contexto): Promise<Temporada[]> {
  const ts = await ctx.db.selectFrom("temporadas").selectAll().orderBy("inicio").orderBy("id").execute();
  const tabs = await ctx.db.selectFrom("temporada_tabelas").selectAll().orderBy("categoria_id").execute();
  return ts.map((t) => ({
    id: t.id, nome: t.nome, inicio: t.inicio, fim: t.fim, prioridade: t.prioridade, percentual: t.percentual,
    tabelas: tabs
      .filter((x) => x.temporada_id === t.id)
      .map((x) => ({ categoriaId: x.categoria_id, porAdultos: JSON.parse(x.por_adultos), adultoExtra: x.adulto_extra })),
  }));
}

// ---------- dia da semana ----------

export async function salvarPercentualDiaSemana(
  ctx: Contexto,
  d: { dia: number; percentual: number },
  ator: string,
): Promise<{ dia: number; percentual: number }> {
  return emTransacao(ctx, async (tx) => {
    await tx.db
      .insertInto("percentuais_dia_semana")
      .values({ dia: d.dia, percentual: d.percentual })
      .onConflict((oc) => oc.column("dia").doUpdateSet({ percentual: d.percentual }))
      .execute();
    await registrar(tx, ator, "dia_semana", String(d.dia), d);
    return { dia: d.dia, percentual: d.percentual };
  });
}

export async function listarPercentuaisDiaSemana(ctx: Contexto): Promise<{ dia: number; percentual: number }[]> {
  return ctx.db.selectFrom("percentuais_dia_semana").select(["dia", "percentual"]).orderBy("dia").execute();
}

// ---------- canais ----------

async function exigirCanalLivre(tx: Contexto, nome: string, acao: string): Promise<void> {
  const uso = await tx.db.selectFrom("reservas").select("id").where("canal", "=", nome).limit(1).executeTakeFirst();
  if (uso) {
    throw new ErroDominio(
      "CANAL_EM_USO",
      `O canal "${nome}" já tem reservas e não pode ${acao}, porque as reservas guardam o canal pelo nome. Crie outro canal.`,
      { canais: [nome] },
    );
  }
}

/** `tipo` e `comissaoPercentual` omitidos mantêm o valor atual do canal (ou direta e 0 num canal novo). */
export async function salvarCanal(
  ctx: Contexto,
  d: { id?: string; nome: string; percentual: number; exigeSinal: boolean; tipo?: TipoCanal; comissaoPercentual?: number },
  ator: string,
): Promise<Canal> {
  return emTransacao(ctx, async (tx) => {
    const atual = await tx.db
      .selectFrom("canais")
      .selectAll()
      .where(d.id ? "id" : "nome", "=", (d.id ?? d.nome) as string)
      .executeTakeFirst();
    const homonimo = (await tx.db.selectFrom("canais").select(["id", "nome"]).execute())
      .find((x) => x.id !== atual?.id && x.nome.toLowerCase() === d.nome.toLowerCase());
    if (homonimo) {
      throw new ErroDominio("CANAL_DUPLICADO", `Já existe o canal "${homonimo.nome}". Escolha outro nome ou edite o existente.`, { canais: [homonimo.nome] });
    }
    if (atual && atual.nome !== d.nome) {
      if (atual.nome === CANAL_REFERENCIA) {
        throw new ErroDominio("CANAL_BALCAO_FIXO", `O canal ${CANAL_REFERENCIA} é a referência de preço e não pode ser renomeado.`, { canais: [atual.nome] });
      }
      await exigirCanalLivre(tx, atual.nome, "ser renomeado");
    }
    const c: Canal = {
      id: atual?.id ?? d.id ?? novoId(), nome: d.nome, percentual: d.percentual, exigeSinal: d.exigeSinal,
      tipo: d.tipo ?? (atual?.tipo as TipoCanal | undefined) ?? "direta",
      comissaoPercentual: d.comissaoPercentual ?? atual?.comissao_percentual ?? 0,
    };
    const valores = { nome: c.nome, percentual: c.percentual, exige_sinal: c.exigeSinal ? 1 : 0, tipo: c.tipo, comissao_percentual: c.comissaoPercentual };
    await tx.db
      .insertInto("canais")
      .values({ id: c.id, ...valores })
      .onConflict((oc) => oc.column("id").doUpdateSet(valores))
      .execute();
    await registrar(tx, ator, "canal", c.id, c);
    return c;
  });
}

export async function removerCanal(ctx: Contexto, id: string, ator: string): Promise<void> {
  await emTransacao(ctx, async (tx) => {
    const c = await tx.db.selectFrom("canais").select("nome").where("id", "=", id).executeTakeFirst();
    if (!c) throw new ErroDominio("CANAL_NAO_ENCONTRADO", "Canal não encontrado.", { id });
    if (c.nome === CANAL_REFERENCIA) {
      throw new ErroDominio("CANAL_BALCAO_FIXO", `O canal ${CANAL_REFERENCIA} é a referência de preço e não pode ser removido.`, { canais: [c.nome] });
    }
    await exigirCanalLivre(tx, c.nome, "ser removido");
    await tx.db.deleteFrom("canais").where("id", "=", id).execute();
    await registrar(tx, ator, "canal_removido", id, { nome: c.nome });
  });
}

export async function listarCanais(ctx: Contexto): Promise<Canal[]> {
  const ls = await ctx.db.selectFrom("canais").selectAll().orderBy("nome").execute();
  return ls.map((l) => ({
    id: l.id, nome: l.nome, percentual: l.percentual, exigeSinal: l.exige_sinal === 1,
    tipo: l.tipo as TipoCanal, comissaoPercentual: l.comissao_percentual,
  }));
}

// ---------- faixas ----------

/** Substitui todas as faixas de ocupação. */
export async function salvarFaixasOcupacao(ctx: Contexto, faixas: FaixaOcupacao[], ator: string): Promise<FaixaOcupacao[]> {
  return emTransacao(ctx, async (tx) => {
    await tx.db.deleteFrom("faixas_ocupacao").execute();
    for (const f of faixas) {
      await tx.db.insertInto("faixas_ocupacao").values({ acima_de: f.acimaDe, percentual: f.percentual }).execute();
    }
    await registrar(tx, ator, "faixas_ocupacao", "faixas_ocupacao", { faixas });
    return listarFaixasOcupacao(tx);
  });
}

export async function listarFaixasOcupacao(ctx: Contexto): Promise<FaixaOcupacao[]> {
  const ls = await ctx.db.selectFrom("faixas_ocupacao").selectAll().orderBy("acima_de").execute();
  return ls.map((l) => ({ acimaDe: l.acima_de, percentual: l.percentual }));
}

/** Substitui todas as faixas de criança. */
export async function salvarFaixasCrianca(ctx: Contexto, faixas: FaixaCrianca[], ator: string): Promise<FaixaCrianca[]> {
  return emTransacao(ctx, async (tx) => {
    await tx.db.deleteFrom("faixas_crianca").execute();
    for (const f of faixas) {
      await tx.db
        .insertInto("faixas_crianca")
        .values({ idade_min: f.idadeMin, idade_max: f.idadeMax, tipo: f.tipo, valor: f.valor })
        .execute();
    }
    await registrar(tx, ator, "faixas_crianca", "faixas_crianca", { faixas });
    return listarFaixasCrianca(tx);
  });
}

export async function listarFaixasCrianca(ctx: Contexto): Promise<FaixaCrianca[]> {
  const ls = await ctx.db.selectFrom("faixas_crianca").selectAll().orderBy("idade_min").execute();
  return ls.map((l) => ({ idadeMin: l.idade_min, idadeMax: l.idade_max, tipo: l.tipo, valor: l.valor }));
}

// ---------- pacotes ----------

export async function salvarPacote(ctx: Contexto, d: Omit<Pacote, "id"> & { id?: string }, ator: string): Promise<Pacote> {
  return emTransacao(ctx, async (tx) => {
    const p: Pacote = { ...d, id: d.id ?? novoId() };
    const valores = {
      nome: p.nome, categoria_id: p.categoriaId, inicio: p.inicio, fim: p.fim, min_noites: p.minNoites,
      valor_noite: JSON.stringify(p.valorNoite), ativo: p.ativo ? 1 : 0,
    };
    await tx.db
      .insertInto("pacotes")
      .values({ id: p.id, ...valores })
      .onConflict((oc) => oc.column("id").doUpdateSet(valores))
      .execute();
    await registrar(tx, ator, "pacote", p.id, p);
    return p;
  });
}

export async function listarPacotes(ctx: Contexto): Promise<Pacote[]> {
  const ls = await ctx.db.selectFrom("pacotes").selectAll().orderBy("inicio").orderBy("id").execute();
  return ls.map((l) => ({
    id: l.id, nome: l.nome, categoriaId: l.categoria_id, inicio: l.inicio, fim: l.fim, minNoites: l.min_noites,
    valorNoite: JSON.parse(l.valor_noite), ativo: l.ativo === 1,
  }));
}

// ---------- restrições ----------

export async function salvarRestricao(ctx: Contexto, d: Restricao, ator: string): Promise<Restricao> {
  return emTransacao(ctx, async (tx) => {
    const valores = {
      min_noites: d.minNoites, fechado_chegada: d.fechadoChegada ? 1 : 0,
      fechado_saida: d.fechadoSaida ? 1 : 0, fechado_venda: d.fechadoVenda ? 1 : 0,
    };
    await tx.db
      .insertInto("restricoes")
      .values({ categoria_id: d.categoriaId, data: d.data, ...valores })
      .onConflict((oc) => oc.columns(["categoria_id", "data"]).doUpdateSet(valores))
      .execute();
    await registrar(tx, ator, "restricao", `${d.categoriaId}:${d.data}`, d);
    return { ...d };
  });
}

export async function listarRestricoes(ctx: Contexto, categoriaId?: string): Promise<Restricao[]> {
  let q = ctx.db.selectFrom("restricoes").selectAll();
  if (categoriaId) q = q.where("categoria_id", "=", categoriaId);
  const ls = await q.orderBy("categoria_id").orderBy("data").execute();
  return ls.map((l) => ({
    categoriaId: l.categoria_id, data: l.data, minNoites: l.min_noites,
    fechadoChegada: l.fechado_chegada === 1, fechadoSaida: l.fechado_saida === 1, fechadoVenda: l.fechado_venda === 1,
  }));
}
