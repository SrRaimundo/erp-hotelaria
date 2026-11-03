import { auditar } from "../../infra/auditoria.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { ErroDominio } from "../../shared/erros.js";
import { novoId, type UUID } from "../../shared/ids.js";
import type { Lançamento } from "../modelos/lançamento.js";
import { CaixaBancoService } from "./caixa-banco.js";
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

  async cancelar(id: UUID, motivo: string, supervisor: string, usuario: Usuario): Promise<Lançamento> {
    exigirAutorizacao(motivo, supervisor);
    return emTransacao(this.ctx, async (tx) => {
      const svc = new LançamentoService(tx);
      const antes = await svc.obter(id);
      if (antes.status === "cancelado") throw new ErroDominio("ESTADO_INVALIDO", "Lançamento já cancelado.");
      await tx.db
        .updateTable("fin_lancamento")
        .set({
          status: "cancelado",
          motivo_cancelamento: motivo,
          atualizado_por: usuario.email,
          atualizado_em: tx.relogio.agora().toISOString(),
        })
        .where("id", "=", id)
        .execute();
      // O dinheiro que já passou pelo Caixa/Banco volta; o cartão ainda a receber deixa de ser esperado.
      await new CaixaBancoService(tx).reverterMovimentos(id, id, usuario);
      await tx.db.updateTable("fin_cartao_movimento").set({ status: "cancelado" }).where("lancamento_id", "=", id).where("status", "=", "a_receber").execute();
      const depois = await svc.obter(id);
      await auditar(tx, {
        ator: usuario.email,
        acao: "fin_lancamento.cancelar",
        alvoTipo: "fin_lancamento",
        alvoId: id,
        dados: { motivo, supervisor, dispositivo: usuario.dispositivo },
      });
      return depois;
    });
  }

  /** Estorno: gera Lançamento de tipo oposto (recebimento<->pagamento) referenciando o original, que permanece intacto. */
  async estornar(id: UUID, motivo: string, supervisor: string, usuario: Usuario): Promise<Lançamento> {
    exigirAutorizacao(motivo, supervisor);
    return emTransacao(this.ctx, async (tx) => {
      const svc = new LançamentoService(tx);
      const original = await svc.obter(id);
      if (original.status === "cancelado") throw new ErroDominio("ESTADO_INVALIDO", "Lançamento cancelado não pode ser estornado.");
      if (original.referencia_tipo === "estorno") throw new ErroDominio("ESTADO_INVALIDO", "Estorno não pode ser estornado.");
      const jaEstornado = await tx.db
        .selectFrom("fin_lancamento")
        .select("id")
        .where("referencia_id", "=", id)
        .where("referencia_tipo", "=", "estorno")
        .executeTakeFirst();
      if (jaEstornado) throw new ErroDominio("ESTADO_INVALIDO", "Lançamento já estornado.");
      const oposto = original.tipo === "recebimento" ? "pagamento" : original.tipo === "pagamento" ? "recebimento" : original.tipo;
      const novo = await svc.criar({
        local_id: original.local_id,
        data: tx.relogio.agora(),
        tipo: oposto,
        origem: original.origem,
        valor: original.valor,
        forma_pagamento: original.forma_pagamento,
        referencia_id: id,
        referencia_tipo: "estorno",
        usuario,
      });
      await tx.db.updateTable("fin_lancamento").set({ motivo_cancelamento: motivo }).where("id", "=", novo.id).execute();
      // Estorno de dinheiro que já passou pelo Caixa/Banco devolve o saldo da mesma conta.
      await new CaixaBancoService(tx).reverterMovimentos(id, novo.id, usuario);
      await auditar(tx, {
        ator: usuario.email,
        acao: "fin_lancamento.estornar",
        alvoTipo: "fin_lancamento",
        alvoId: id,
        dados: { motivo, supervisor, estorno_id: novo.id },
      });
      return svc.obter(novo.id);
    });
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
