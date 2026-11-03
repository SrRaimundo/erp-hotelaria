import type { Contexto } from "../../shared/contexto.js";
import type { UUID } from "../../shared/ids.js";
import { limitesNoFuso, SINAL } from "./comum.js";

export type FluxoCaixa = {
  local_id: UUID;
  data: string;
  saldo_inicial: number;
  entradas: number;
  saidas: number;
  transferencias_entrada: number;
  transferencias_saida: number;
  saldo_final: number;
  /** Taxas de cartão do dia: despesa só de registro, sem movimento de caixa (já descontadas do que o banco recebeu). */
  taxas_cartao: number;
};

/** Fluxo de caixa diário de um local (valores em centavos). Entradas = créditos; saídas = débitos. */
export async function fluxoCaixaDiario(ctx: Contexto, local_id: UUID, data: string): Promise<FluxoCaixa> {
  const { inicio, fim } = await limitesNoFuso(ctx, data, data);
  const contas = await ctx.db.selectFrom("fin_conta_bancaria").select("saldo_inicial").where("local_id", "=", local_id).execute();
  const movs = await ctx.db
    .selectFrom("fin_movimento")
    .select(["tipo", "valor", "data"])
    .where("local_id", "=", local_id)
    .where("data", "<=", fim)
    .execute();
  let saldo_inicial = contas.reduce((s: number, c: any) => s + c.saldo_inicial, 0);
  const r: Record<string, number> = { credito: 0, debito: 0, transferencia_in: 0, transferencia_out: 0 };
  for (const m of movs as any[]) {
    if (m.data < inicio) saldo_inicial += SINAL[m.tipo] * m.valor;
    else r[m.tipo] += m.valor;
  }
  const taxas = (await ctx.db
    .selectFrom("fin_lancamento")
    .select("valor")
    .where("local_id", "=", local_id)
    .where("referencia_tipo", "=", "taxa_cartao")
    .where("status", "!=", "cancelado")
    .where("data", ">=", inicio)
    .where("data", "<=", fim)
    .execute()) as { valor: number }[];
  const saldo_final = saldo_inicial + r.credito - r.debito + r.transferencia_in - r.transferencia_out;
  return {
    local_id, data, saldo_inicial, entradas: r.credito, saidas: r.debito,
    taxas_cartao: taxas.reduce((s, t) => s + t.valor, 0),
    transferencias_entrada: r.transferencia_in, transferencias_saida: r.transferencia_out, saldo_final,
  };
}
