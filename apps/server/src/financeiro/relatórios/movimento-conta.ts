import { obterConfig } from "../../nucleo/pousada.js";
import { dataLocal } from "../../shared/tempo.js";
import type { Contexto } from "../../shared/contexto.js";
import { ErroDominio } from "../../shared/erros.js";
import type { UUID } from "../../shared/ids.js";
import { limitesNoFuso, SINAL } from "./comum.js";

export type ExtratoConta = {
  conta_id: UUID;
  data_inicio: string;
  data_fim: string;
  saldo_inicial: number;
  total_creditos: number;
  total_debitos: number;
  saldo_final: number;
  movimentos: {
    id: UUID; data: string; /** Dia local da pousada. */ dia: string; tipo: string; lancamento_id: UUID; credito: number; debito: number; saldo_posterior: number;
    /** Do lançamento de origem (para a tela). */
    descricao: string; origem: string;
    /** Recebimento/pagamento ainda não revertido: a tela oferece "Estornar". */
    estornavel: boolean;
  }[];
};

/** Extrato detalhado de uma conta no período; saldo corrente recalculado a partir do saldo inicial do período. */
export async function movimentoPorConta(ctx: Contexto, conta_id: UUID, data_inicio: string, data_fim: string): Promise<ExtratoConta> {
  const { inicio, fim } = await limitesNoFuso(ctx, data_inicio, data_fim);
  const conta = await ctx.db.selectFrom("fin_conta_bancaria").select("saldo_inicial").where("id", "=", conta_id).executeTakeFirst();
  if (!conta) throw new ErroDominio("NAO_ENCONTRADO", "Conta não encontrada.");
  const movs = (await ctx.db
    .selectFrom("fin_movimento")
    .selectAll()
    .where("conta_id", "=", conta_id)
    .where("data", "<=", fim)
    .orderBy("data")
    .orderBy("criado_em")
    .orderBy("id")
    .execute()) as any[];
  let saldo = conta.saldo_inicial;
  for (const m of movs) if (m.data < inicio) saldo += SINAL[m.tipo] * m.valor;
  const saldo_inicial = saldo;
  let total_creditos = 0;
  let total_debitos = 0;
  const movimentos: ExtratoConta["movimentos"] = [];
  const { fuso } = await obterConfig(ctx);
  const ids = [...new Set(movs.map((m) => m.lancamento_id as string))];
  const lancs = new Map<string, any>();
  const estornados = new Set<string>();
  if (ids.length > 0) {
    for (const l of (await ctx.db.selectFrom("fin_lancamento").select(["id", "status", "tipo", "origem", "descricao", "referencia_tipo"]).where("id", "in", ids).execute()) as any[]) lancs.set(l.id, l);
    for (const e of (await ctx.db.selectFrom("fin_lancamento").select("referencia_id").where("referencia_tipo", "=", "estorno").where("referencia_id", "in", ids).execute()) as any[]) estornados.add(e.referencia_id);
  }
  for (const m of movs) {
    if (m.data < inicio) continue;
    const credito = SINAL[m.tipo] === 1 ? m.valor : 0;
    const debito = SINAL[m.tipo] === -1 ? m.valor : 0;
    saldo += credito - debito;
    total_creditos += credito;
    total_debitos += debito;
    const l = lancs.get(m.lancamento_id);
    const estornavel = !!l && (l.tipo === "recebimento" || l.tipo === "pagamento") && l.status !== "cancelado" && l.referencia_tipo !== "estorno" && l.referencia_tipo !== "taxa_cartao" && !estornados.has(l.id);
    movimentos.push({ id: m.id, data: m.data, dia: dataLocal(new Date(m.data), fuso), descricao: l?.descricao ?? "", origem: l?.origem ?? "", estornavel, tipo: m.tipo, lancamento_id: m.lancamento_id, credito, debito, saldo_posterior: saldo });
  }
  return { conta_id, data_inicio, data_fim, saldo_inicial, total_creditos, total_debitos, saldo_final: saldo, movimentos };
}
