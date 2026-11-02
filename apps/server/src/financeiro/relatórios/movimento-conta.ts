import type { Contexto } from "../../shared/contexto.js";
import { ErroDominio } from "../../shared/erros.js";
import type { UUID } from "../../shared/ids.js";
import { intervalo, SINAL } from "./comum.js";

export type ExtratoConta = {
  conta_id: UUID;
  data_inicio: string;
  data_fim: string;
  saldo_inicial: number;
  total_creditos: number;
  total_debitos: number;
  saldo_final: number;
  movimentos: { id: UUID; data: string; tipo: string; lancamento_id: UUID; credito: number; debito: number; saldo_posterior: number }[];
};

/** Extrato detalhado de uma conta no período; saldo corrente recalculado a partir do saldo inicial do período. */
export async function movimentoPorConta(ctx: Contexto, conta_id: UUID, data_inicio: string, data_fim: string): Promise<ExtratoConta> {
  const { inicio, fim } = intervalo(data_inicio, data_fim);
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
  for (const m of movs) {
    if (m.data < inicio) continue;
    const credito = SINAL[m.tipo] === 1 ? m.valor : 0;
    const debito = SINAL[m.tipo] === -1 ? m.valor : 0;
    saldo += credito - debito;
    total_creditos += credito;
    total_debitos += debito;
    movimentos.push({ id: m.id, data: m.data, tipo: m.tipo, lancamento_id: m.lancamento_id, credito, debito, saldo_posterior: saldo });
  }
  return { conta_id, data_inicio, data_fim, saldo_inicial, total_creditos, total_debitos, saldo_final: saldo, movimentos };
}
