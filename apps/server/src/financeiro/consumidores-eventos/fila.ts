import type { Evento } from "../../infra/barramento.js";
import { criarAlerta, resolverAlerta } from "../../infra/alertas.js";
import { auditar } from "../../infra/auditoria.js";
import { ErroDominio } from "../../shared/erros.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { processarPagamentoEstornado, processarPagamentoRegistrado, processarValorAReceberCriado } from "./hospedagem-pagamento.js";

/**
 * Fila do Financeiro: lê os eventos de hospedagem do `outbox` (gravados na mesma transação da operação do hotel)
 * a partir de um cursor persistido (`fin_cursor`), em ordem de `seq`. Cada evento e o avanço do cursor
 * acontecem na MESMA transação: ou o efeito e o cursor valem, ou nenhum. A falha de um evento não avança o cursor
 * (os seguintes esperam, preservando a ordem), é tentada de novo no ciclo seguinte e, após repetidas falhas,
 * abre um alerta. Nada disso corre dentro da operação do hotel: roda depois do commit.
 */
const NOME = "hospedagem";
export const FALHAS_PARA_ALERTA = 3;

type Tratador = (tx: Contexto, e: Pick<Evento, "payload" | "criadoEm">) => Promise<void>;
const TRATADORES: Record<string, Tratador> = {
  "hospedagem.PagamentoRegistrado": processarPagamentoRegistrado,
  "hospedagem.ValorAReceberCriado": processarValorAReceberCriado,
  "hospedagem.PagamentoEstornado": processarPagamentoEstornado,
};

export type ResultadoFila = { processados: number; falhou?: { seq: number; erro: string } };

async function lerCursor(db: Contexto["db"]): Promise<number> {
  const c = await db.selectFrom("fin_cursor").select("ultimo_seq").where("nome", "=", NOME).executeTakeFirst();
  return Number(c?.ultimo_seq ?? 0);
}

async function varrer(ctx: Contexto): Promise<ResultadoFila> {
  let processados = 0;
  for (;;) {
    let linha: { seq: number; tipo: string; payload: string; criado_em: string } | undefined;
    try {
      const cursor = await lerCursor(ctx.db);
      linha = (await ctx.db
        .selectFrom("outbox")
        .select(["seq", "tipo", "payload", "criado_em"])
        .where("seq", ">", cursor)
        .where("tipo", "in", Object.keys(TRATADORES))
        .orderBy("seq")
        .limit(1)
        .executeTakeFirst()) as typeof linha;
    } catch (erro) {
      // Ler a fila nunca derruba quem chamou (nem a subida do servidor): fica registrado e tenta de novo no próximo ciclo.
      console.error("Financeiro: não foi possível ler a fila de eventos:", erro);
      return { processados, falhou: { seq: 0, erro: erro instanceof Error ? erro.message : String(erro) } };
    }
    if (!linha) return { processados };
    try {
      await emTransacao(ctx, async (tx) => {
        if ((await lerCursor(tx.db)) >= linha.seq) return; // outro ciclo já tratou
        await TRATADORES[linha.tipo]!(tx, { payload: JSON.parse(linha.payload), criadoEm: linha.criado_em });
        await tx.db
          .updateTable("fin_cursor")
          .set({ ultimo_seq: linha.seq, falha_seq: null, falhas: 0, ultimo_erro: null })
          .where("nome", "=", NOME)
          .execute();
        const abertos = await tx.db.selectFrom("alertas").select("id").where("tipo", "=", "financeiro_evento_falhou").where("alvo_id", "=", String(linha.seq)).where("resolvido_em", "is", null).execute();
        for (const a of abertos) await resolverAlerta(tx, a.id, "sistema");
      });
      processados++;
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      console.error(`Financeiro: evento ${linha.seq} (${linha.tipo}) falhou:`, erro);
      await registrarFalha(ctx, linha.seq, linha.tipo, mensagem);
      return { processados, falhou: { seq: linha.seq, erro: mensagem } };
    }
  }
}

async function registrarFalha(ctx: Contexto, seq: number, tipo: string, mensagem: string): Promise<void> {
  try {
    await emTransacao(ctx, async (tx) => {
      const atual = await tx.db.selectFrom("fin_cursor").select(["falha_seq", "falhas"]).where("nome", "=", NOME).executeTakeFirst();
      const falhas = atual?.falha_seq === seq ? Number(atual.falhas) + 1 : 1;
      await tx.db.updateTable("fin_cursor").set({ falha_seq: seq, falhas, ultimo_erro: mensagem }).where("nome", "=", NOME).execute();
      if (falhas >= FALHAS_PARA_ALERTA) {
        await criarAlerta(tx, {
          tipo: "financeiro_evento_falhou",
          alvoTipo: "outbox",
          alvoId: String(seq),
          mensagem: `O Financeiro não conseguiu registrar o evento ${tipo} (nº ${seq}) após ${falhas} tentativas: ${mensagem}. Os eventos seguintes aguardam. Corrija a causa; o sistema tenta de novo sozinho.`,
        });
      }
    });
  } catch (erro) {
    console.error("Financeiro: não foi possível registrar a falha do evento:", erro);
  }
}

const filas = new WeakMap<object, { rodando: Promise<ResultadoFila> | null; novo: boolean }>();

/** Consome o que estiver pendente. Chamadas simultâneas se juntam numa só varredura (que repete se chegou evento novo). */
export function processarPendentes(ctx: Contexto): Promise<ResultadoFila> {
  let e = filas.get(ctx.db);
  if (!e) filas.set(ctx.db, (e = { rodando: null, novo: false }));
  if (e.rodando) {
    e.novo = true;
    return e.rodando;
  }
  const estado = e;
  estado.rodando = (async () => {
    let total = 0;
    let r: ResultadoFila;
    do {
      estado.novo = false;
      r = await varrer(ctx);
      total += r.processados;
    } while (estado.novo && !r.falhou);
    return { ...r, processados: total };
  })().finally(() => {
    estado.rodando = null;
  });
  return estado.rodando;
}

/** Aguarda a varredura em andamento (encerramento ordenado). */
export async function aguardarFila(ctx: Contexto): Promise<void> {
  await filas.get(ctx.db)?.rodando?.catch(() => undefined);
}

/** O barramento só avisa que há evento novo (latência baixa); a verdade está no outbox e no cursor. */
export function ligarFilaFinanceiro(ctx: Contexto & { barramento: { assinar(tipo: string, fn: (e: Evento) => void | Promise<void>): void } }): void {
  for (const tipo of Object.keys(TRATADORES)) {
    ctx.barramento.assinar(tipo, async () => {
      await processarPendentes(ctx);
    });
  }
}

const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
const valorDoPayload = (payload: string): number | null => {
  try {
    const v = (JSON.parse(payload) as { valor?: unknown }).valor;
    return typeof v === "number" ? Math.abs(v) : null;
  } catch {
    return null;
  }
};

export type EstadoFila = {
  cursor: number;
  pendentes: number;
  bloqueado: { seq: number; tipo: string; valor: number | null; erro: string; falhas: number; criado_em: string } | null;
  ignorados: { seq: number; tipo: string; valor: number | null; motivo: string; ator: string; criado_em: string }[];
};

/** Situação da fila para a tela de administração: posição, evento bloqueado (com o erro) e o que já foi ignorado. */
export async function estadoFila(ctx: Contexto): Promise<EstadoFila> {
  const c = (await ctx.db.selectFrom("fin_cursor").selectAll().where("nome", "=", NOME).executeTakeFirst()) as any;
  const cursor = Number(c?.ultimo_seq ?? 0);
  const tipos = Object.keys(TRATADORES);
  const pend = await ctx.db.selectFrom("outbox").select((eb) => eb.fn.count<number>("seq").as("n")).where("seq", ">", cursor).where("tipo", "in", tipos).executeTakeFirst();
  let bloqueado: EstadoFila["bloqueado"] = null;
  if (c?.falha_seq) {
    const e = (await ctx.db.selectFrom("outbox").select(["seq", "tipo", "payload", "criado_em"]).where("seq", "=", c.falha_seq).executeTakeFirst()) as any;
    if (e && e.seq > cursor) bloqueado = { seq: e.seq, tipo: e.tipo, valor: valorDoPayload(e.payload), erro: c.ultimo_erro ?? "", falhas: Number(c.falhas), criado_em: e.criado_em };
  }
  const ig = (await ctx.db.selectFrom("fin_evento_ignorado").selectAll().orderBy("seq", "desc").execute()) as any[];
  return {
    cursor, pendentes: Number(pend?.n ?? 0), bloqueado,
    ignorados: ig.map((i) => ({ seq: i.seq, tipo: i.tipo, valor: i.valor, motivo: i.motivo, ator: i.ator, criado_em: i.criado_em })),
  };
}

/**
 * Saída para um evento que não passa: o administrador (com motivo e supervisor) ignora o evento bloqueado. Fica registro
 * permanente (tabela, auditoria e alerta com o valor) e a fila segue. Só vale para o evento que está bloqueando.
 */
export async function ignorarEvento(ctx: Contexto, seq: number, o: { motivo: string; supervisorId: string; ator: string }): Promise<void> {
  await emTransacao(ctx, async (tx) => {
    const c = (await tx.db.selectFrom("fin_cursor").selectAll().where("nome", "=", NOME).executeTakeFirst()) as any;
    if (!c || !c.falha_seq || c.falha_seq !== seq || Number(c.ultimo_seq) >= seq) {
      throw new ErroDominio("ESTADO_INVALIDO", "Esse evento não é o que está bloqueando a fila. Atualize a tela.");
    }
    const e = (await tx.db.selectFrom("outbox").select(["seq", "tipo", "payload"]).where("seq", "=", seq).executeTakeFirstOrThrow()) as any;
    const valor = valorDoPayload(e.payload);
    await tx.db.insertInto("fin_evento_ignorado").values({
      seq, tipo: e.tipo, payload: e.payload, valor, erro: c.ultimo_erro ?? null, motivo: o.motivo, ator: o.ator, criado_em: tx.relogio.agora().toISOString(),
    }).execute();
    await tx.db.updateTable("fin_cursor").set({ ultimo_seq: seq, falha_seq: null, falhas: 0, ultimo_erro: null }).where("nome", "=", NOME).execute();
    const abertos = await tx.db.selectFrom("alertas").select("id").where("tipo", "=", "financeiro_evento_falhou").where("alvo_id", "=", String(seq)).where("resolvido_em", "is", null).execute();
    for (const a of abertos) await resolverAlerta(tx, a.id, o.ator);
    await criarAlerta(tx, {
      tipo: "financeiro_evento_ignorado", alvoTipo: "outbox", alvoId: String(seq),
      mensagem: `O evento ${e.tipo} (nº ${seq}${valor !== null ? `, ${reais(valor)}` : ""}) NÃO foi registrado no Financeiro: foi ignorado por decisão do administrador (${o.motivo}). Confira se o valor precisa ser lançado à mão.`,
    });
    await auditar(tx, { ator: o.ator, acao: "fin_fila.ignorar", alvoTipo: "outbox", alvoId: String(seq), motivo: o.motivo, supervisorId: o.supervisorId, dados: { tipo: e.tipo, valor, erro: c.ultimo_erro } });
  });
}
