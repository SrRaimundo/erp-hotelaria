import { obterConfig } from "../../nucleo/pousada.js";
import { dataLocal } from "../../shared/tempo.js";
import type { Contexto } from "../../shared/contexto.js";
import type { UUID } from "../../shared/ids.js";
import { numeroBase } from "../servicos/contas-receber.js";
import { rotuloParcela } from "../servicos/parcelamento.js";

export type SituacaoReceber = "aberto" | "vencido" | "parcialmente_recebido" | "recebido";

type Totais = { quantidade: number; valor_original: number; valor_recebido: number; valor_pendente: number };

export type PosicaoReceber = {
  local_id: UUID;
  situacoes: Record<SituacaoReceber, Totais>;
  itens: {
    id: UUID; numero_documento: string; cliente_id: UUID; cliente_nome: string; parcela_de: UUID | null; valor_total: number | null; titulo_id: UUID | null; parcela_num: number | null; parcela_total: number | null;
    /** Nome para a tela: "documento – parcela 2/4" (e "– saldo" na parcela do saldo de um recebimento parcial). */
    rotulo: string; origem: string; categoria: string | null; observacao: string | null;
    /** Conta manual pendente e intocada: pode editar e cancelar. */
    editavel: boolean;
    /** Conta manual pendente e intocada (inclusive parcela de título): pode cancelar. */
    cancelavel: boolean;
    /** Último recebimento ainda de pé (para estornar). */
    lancamento_id: UUID | null; data_vencimento: string;
    valor_original: number; valor_recebido: number; valor_pendente: number; situacao: SituacaoReceber;
  }[];
};

/** Posição de contas a receber. Vencido = não quitada com vencimento anterior a hoje (parcial vencida conta como vencido). Canceladas ficam fora. */
export async function posicaoContasReceber(ctx: Contexto, local_id: UUID): Promise<PosicaoReceber> {
  const { fuso } = await obterConfig(ctx);
  const hoje = dataLocal(ctx.relogio.agora(), fuso);
  const linhas = (await ctx.db
    .selectFrom("fin_conta_receber as r")
    .innerJoin("fin_cliente as c", "c.id", "r.cliente_id")
    .select(["r.id", "r.numero_documento", "r.cliente_id", "c.nome as cliente_nome", "r.data_vencimento", "r.valor_original", "r.valor_recebido", "r.status", "r.parcela_de", "r.valor_total", "r.titulo_id", "r.parcela_num", "r.parcela_total", "r.origem", "r.categoria", "r.observacao", "r.lançamentos_id"])
    .where("r.local_id", "=", local_id)
    .where("r.status", "!=", "cancelado")
    .orderBy("r.data_vencimento")
    .execute()) as any[];
  const comFilha = new Set(
    ((await ctx.db.selectFrom("fin_conta_receber").select("parcela_de").where("local_id", "=", local_id).where("parcela_de", "is not", null).where("status", "!=", "cancelado").execute()) as any[]).map((x) => x.parcela_de as string),
  );
  const vazio = (): Totais => ({ quantidade: 0, valor_original: 0, valor_recebido: 0, valor_pendente: 0 });
  const situacoes: PosicaoReceber["situacoes"] = { aberto: vazio(), vencido: vazio(), parcialmente_recebido: vazio(), recebido: vazio() };
  const itens: PosicaoReceber["itens"] = [];
  for (const l of linhas) {
    let situacao: SituacaoReceber;
    if (l.status === "recebido") situacao = "recebido";
    else if (dataLocal(new Date(l.data_vencimento), fuso) < hoje) situacao = "vencido";
    else if (l.status === "parcialmente_recebido") situacao = "parcialmente_recebido";
    else situacao = "aberto";
    const pendente = situacao === "recebido" ? 0 : l.valor_original - l.valor_recebido;
    const s = situacoes[situacao];
    s.quantidade++;
    s.valor_original += l.valor_original;
    s.valor_recebido += l.valor_recebido;
    s.valor_pendente += pendente;
    itens.push({
      id: l.id, numero_documento: l.numero_documento, cliente_id: l.cliente_id, cliente_nome: l.cliente_nome, parcela_de: l.parcela_de ?? null, valor_total: l.valor_total ?? null, titulo_id: l.titulo_id ?? null, parcela_num: l.parcela_num ?? null, parcela_total: l.parcela_total ?? null,
      rotulo: l.titulo_id ? rotuloParcela(numeroBase(l.numero_documento), l.parcela_num, l.parcela_total, !!l.parcela_de) : l.numero_documento,
      origem: l.origem, categoria: l.categoria ?? null, observacao: l.observacao ?? null,
      cancelavel: l.origem === "manual" && l.status === "pendente" && l.valor_recebido === 0 && l.valor_total == null && !comFilha.has(l.id),
      editavel: l.origem === "manual" && !l.titulo_id && l.status === "pendente" && l.valor_recebido === 0 && l.valor_total == null && !comFilha.has(l.id),
      lancamento_id: l["lançamentos_id"] ? ((JSON.parse(l["lançamentos_id"]) as string[]).at(-1) as UUID | undefined) ?? null : null, data_vencimento: l.data_vencimento,
      valor_original: l.valor_original, valor_recebido: l.valor_recebido, valor_pendente: pendente, situacao,
    });
  }
  return { local_id, situacoes, itens };
}
