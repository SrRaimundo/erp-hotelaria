import type { Contexto } from "../../shared/contexto.js";
import type { UUID } from "../../shared/ids.js";
import { limitesNoFuso, SINAL } from "./comum.js";

export type ConsolidadoLocal = {
  local_id: UUID;
  nome: string;
  saldo_inicial: number;
  recebimentos: number;
  pagamentos: number;
  /** Taxas de cartão no período (despesa só de registro; não entra em pagamentos nem no saldo). */
  taxas_cartao: number;
  saldo_final: number;
};

/** Comparativo por Local no período. Recebimentos = créditos; pagamentos = débitos; transferências só afetam o saldo. */
export async function consolidadoPorLocal(ctx: Contexto, data_inicio: string, data_fim: string) {
  const { inicio, fim } = await limitesNoFuso(ctx, data_inicio, data_fim);
  const locais = (await ctx.db.selectFrom("fin_local").select(["id", "nome"]).orderBy("nome").execute()) as any[];
  const contas = (await ctx.db.selectFrom("fin_conta_bancaria").select(["local_id", "saldo_inicial"]).execute()) as any[];
  const movs = (await ctx.db.selectFrom("fin_movimento").select(["local_id", "tipo", "valor", "data", "reversao"]).where("data", "<=", fim).execute()) as any[];
  const mapa = new Map<string, ConsolidadoLocal>();
  const variacao = new Map<string, number>();
  for (const l of locais) {
    mapa.set(l.id, { local_id: l.id, nome: l.nome, saldo_inicial: 0, recebimentos: 0, pagamentos: 0, taxas_cartao: 0, saldo_final: 0 });
    variacao.set(l.id, 0);
  }
  for (const c of contas) if (mapa.has(c.local_id)) mapa.get(c.local_id)!.saldo_inicial += c.saldo_inicial;
  for (const m of movs) {
    const l = mapa.get(m.local_id);
    if (!l) continue;
    if (m.data < inicio) {
      l.saldo_inicial += SINAL[m.tipo] * m.valor;
      continue;
    }
    if (m.reversao && m.tipo === "debito") l.recebimentos -= m.valor;
    else if (m.reversao && m.tipo === "credito") l.pagamentos -= m.valor;
    else if (m.tipo === "credito") l.recebimentos += m.valor;
    else if (m.tipo === "debito") l.pagamentos += m.valor;
    variacao.set(m.local_id, variacao.get(m.local_id)! + SINAL[m.tipo] * m.valor);
  }
  const taxas = (await ctx.db
    .selectFrom("fin_lancamento")
    .select(["local_id", "valor"])
    .where("referencia_tipo", "=", "taxa_cartao")
    .where("status", "!=", "cancelado")
    .where("data", ">=", inicio)
    .where("data", "<=", fim)
    .execute()) as any[];
  for (const t of taxas) if (mapa.has(t.local_id)) mapa.get(t.local_id)!.taxas_cartao += t.valor;
  const lista = [...mapa.values()];
  for (const l of lista) l.saldo_final = l.saldo_inicial + variacao.get(l.local_id)!;
  const total = lista.reduce(
    (t, l) => ({
      saldo_inicial: t.saldo_inicial + l.saldo_inicial,
      recebimentos: t.recebimentos + l.recebimentos,
      pagamentos: t.pagamentos + l.pagamentos,
      taxas_cartao: t.taxas_cartao + l.taxas_cartao,
      saldo_final: t.saldo_final + l.saldo_final,
    }),
    { saldo_inicial: 0, recebimentos: 0, pagamentos: 0, taxas_cartao: 0, saldo_final: 0 },
  );
  return { data_inicio, data_fim, locais: lista, total };
}
