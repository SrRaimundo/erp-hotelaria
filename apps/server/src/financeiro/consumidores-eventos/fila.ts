import type { Evento } from "../../infra/barramento.js";
import { criarAlerta, resolverAlerta } from "../../infra/alertas.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { processarPagamentoRegistrado, processarValorAReceberCriado } from "./hospedagem-pagamento.js";

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
};
export function registrarTratador(tipo: string, fn: Tratador): void {
  TRATADORES[tipo] = fn;
}

export type ResultadoFila = { processados: number; falhou?: { seq: number; erro: string } };

async function lerCursor(db: Contexto["db"]): Promise<number> {
  const c = await db.selectFrom("fin_cursor").select("ultimo_seq").where("nome", "=", NOME).executeTakeFirst();
  return Number(c?.ultimo_seq ?? 0);
}

async function varrer(ctx: Contexto): Promise<ResultadoFila> {
  let processados = 0;
  for (;;) {
    const cursor = await lerCursor(ctx.db);
    const tipos = Object.keys(TRATADORES);
    const linha = (await ctx.db
      .selectFrom("outbox")
      .select(["seq", "tipo", "payload", "criado_em"])
      .where("seq", ">", cursor)
      .where("tipo", "in", tipos)
      .orderBy("seq")
      .limit(1)
      .executeTakeFirst()) as { seq: number; tipo: string; payload: string; criado_em: string } | undefined;
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
