import { obterConfig } from "../../nucleo/pousada.js";
import { dataLocal } from "../../shared/tempo.js";
import type { Contexto } from "../../shared/contexto.js";
import type { UUID } from "../../shared/ids.js";

export type SituacaoReceber = "aberto" | "vencido" | "parcialmente_recebido" | "recebido";

type Totais = { quantidade: number; valor_original: number; valor_recebido: number; valor_pendente: number };

export type PosicaoReceber = {
  local_id: UUID;
  situacoes: Record<SituacaoReceber, Totais>;
  itens: {
    id: UUID; numero_documento: string; cliente_id: UUID; cliente_nome: string; data_vencimento: string;
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
    .select(["r.id", "r.numero_documento", "r.cliente_id", "c.nome as cliente_nome", "r.data_vencimento", "r.valor_original", "r.valor_recebido", "r.status"])
    .where("r.local_id", "=", local_id)
    .where("r.status", "!=", "cancelado")
    .orderBy("r.data_vencimento")
    .execute()) as any[];
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
      id: l.id, numero_documento: l.numero_documento, cliente_id: l.cliente_id, cliente_nome: l.cliente_nome, data_vencimento: l.data_vencimento,
      valor_original: l.valor_original, valor_recebido: l.valor_recebido, valor_pendente: pendente, situacao,
    });
  }
  return { local_id, situacoes, itens };
}
