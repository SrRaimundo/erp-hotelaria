import { auditar } from "../../infra/auditoria.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { ErroDominio } from "../../shared/erros.js";
import { novoId, type UUID } from "../../shared/ids.js";
import type { Lançamento } from "../modelos/lançamento.js";
import { reverterLancamento } from "./reversao.js";
import type { Usuario } from "./locais.js";

export type ParamsCriarLancamento = {
  local_id: UUID;
  data: Date;
  tipo: Lançamento["tipo"];
  origem: Lançamento["origem"];
  valor: Dinheiro;
  forma_pagamento: Lançamento["forma_pagamento"];
  referencia_id?: UUID;
  referencia_tipo?: string;
  /** Padrão "confirmado"; Contas a Pagar nasce "pendente". */
  status?: Lançamento["status"];
  descricao?: string;
  categoria?: string;
  vencimento?: Date;
  fornecedor_id?: UUID;
  parcela_de?: UUID;
  titulo_id?: UUID;
  parcela_num?: number;
  parcela_total?: number;
  usuario: Usuario;
};

function paraLancamento(l: any): Lançamento {
  return {
    id: l.id,
    local_id: l.local_id,
    data: new Date(l.data),
    tipo: l.tipo,
    origem: l.origem,
    valor: Dinheiro.de(l.valor),
    forma_pagamento: l.forma_pagamento,
    descricao: l.descricao ?? "",
    categoria: l.categoria ?? undefined,
    vencimento: l.vencimento ? new Date(l.vencimento) : undefined,
    fornecedor_id: l.fornecedor_id ?? undefined,
    parcela_de: l.parcela_de ?? undefined,
    valor_total: l.valor_total ?? undefined,
    titulo_id: l.titulo_id ?? undefined,
    parcela_num: l.parcela_num ?? undefined,
    parcela_total: l.parcela_total ?? undefined,
    status: l.status,
    referencia_id: l.referencia_id ?? undefined,
    referencia_tipo: l.referencia_tipo ?? undefined,
    auditoria: {
      criado_por: l.criado_por,
      data_criacao: new Date(l.criado_em),
      dispositivo: l.dispositivo ?? "",
      atualizado_por: l.atualizado_por ?? undefined,
      data_atualizacao: l.atualizado_em ? new Date(l.atualizado_em) : undefined,
      motivo_cancelamento: l.motivo_cancelamento ?? undefined,
      supervisor_autorizou: l.motivo_cancelamento ? true : undefined,
    },
  };
}

function exigirAutorizacao(motivo: string, supervisor: string) {
  if (!motivo?.trim()) throw new ErroDominio("VALIDACAO_FALHOU", "Motivo é obrigatório.");
  if (!supervisor?.trim()) throw new ErroDominio("VALIDACAO_FALHOU", "Autorização de supervisor é obrigatória.");
}

export class LançamentoService {
  constructor(private ctx: Contexto) {}

  async criar(p: ParamsCriarLancamento): Promise<Lançamento> {
    if (!Number.isInteger(p.valor.centavos) || p.valor.centavos <= 0) {
      throw new ErroDominio("VALIDACAO_FALHOU", "Valor deve ser positivo.");
    }
    return emTransacao(this.ctx, async (tx) => {
      const local = await tx.db.selectFrom("fin_local").select("id").where("id", "=", p.local_id).executeTakeFirst();
      if (!local) throw new ErroDominio("NAO_ENCONTRADO", "Local não encontrado.");
      const id = novoId();
      await tx.db
        .insertInto("fin_lancamento")
        .values({
          id,
          local_id: p.local_id,
          data: p.data.toISOString(),
          tipo: p.tipo,
          origem: p.origem,
          valor: p.valor.centavos,
          forma_pagamento: p.forma_pagamento,
          status: p.status ?? "confirmado",
          descricao: p.descricao ?? null,
          categoria: p.categoria ?? null,
          vencimento: p.vencimento ? p.vencimento.toISOString() : null,
          fornecedor_id: p.fornecedor_id ?? null,
          parcela_de: p.parcela_de ?? null,
          titulo_id: p.titulo_id ?? null,
          parcela_num: p.parcela_num ?? null,
          parcela_total: p.parcela_total ?? null,
          referencia_id: p.referencia_id ?? null,
          referencia_tipo: p.referencia_tipo ?? null,
          criado_por: p.usuario.email,
          criado_em: tx.relogio.agora().toISOString(),
          dispositivo: p.usuario.dispositivo ?? null,
        })
        .execute();
      const criado = await new LançamentoService(tx).obter(id);
      await auditar(tx, {
        ator: p.usuario.email,
        acao: "fin_lancamento.criar",
        alvoTipo: "fin_lancamento",
        alvoId: id,
        dados: { ...criado, valor: criado.valor.centavos },
      });
      return criado;
    });
  }

  /** Cancela (ver `reverterLancamento`): `supervisor` é o id de quem autorizou. */
  async cancelar(id: UUID, motivo: string, supervisor: string, usuario: Usuario): Promise<Lançamento> {
    exigirAutorizacao(motivo, supervisor);
    return reverterLancamento(this.ctx, id, { modo: "cancelar", motivo, supervisorId: supervisor, usuario });
  }

  /** Estorno: gera o lançamento de tipo oposto referenciando o original, que permanece como está (ver `reverterLancamento`). */
  async estornar(id: UUID, motivo: string, supervisor: string, usuario: Usuario): Promise<Lançamento> {
    exigirAutorizacao(motivo, supervisor);
    return reverterLancamento(this.ctx, id, { modo: "estornar", motivo, supervisorId: supervisor, usuario });
  }

  async listar(local_id: UUID, filtros: { data_inicio?: Date; data_fim?: Date } = {}): Promise<Lançamento[]> {
    let q = this.ctx.db.selectFrom("fin_lancamento").selectAll().where("local_id", "=", local_id);
    if (filtros.data_inicio) q = q.where("data", ">=", filtros.data_inicio.toISOString());
    if (filtros.data_fim) q = q.where("data", "<=", filtros.data_fim.toISOString());
    const linhas = await q.orderBy("data", "desc").orderBy("id").execute();
    return linhas.map(paraLancamento);
  }

  async obter(id: UUID): Promise<Lançamento> {
    const l = await this.ctx.db.selectFrom("fin_lancamento").selectAll().where("id", "=", id).executeTakeFirst();
    if (!l) throw new ErroDominio("NAO_ENCONTRADO", "Lançamento não encontrado.");
    return paraLancamento(l);
  }
}
