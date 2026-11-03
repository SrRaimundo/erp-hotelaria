import { auditar } from "../../infra/auditoria.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { ErroDominio } from "../../shared/erros.js";
import { novoId, type UUID } from "../../shared/ids.js";
import type { Lançamento } from "../modelos/lançamento.js";
import type { Movimento } from "../modelos/movimento.js";
import type { Usuario } from "./locais.js";

const SINAL: Record<Movimento["tipo"], 1 | -1> = {
  credito: 1,
  transferencia_in: 1,
  debito: -1,
  transferencia_out: -1,
};

function paraMovimento(m: any): Movimento {
  return {
    id: m.id,
    local_id: m.local_id,
    conta_id: m.conta_id,
    lancamento_id: m.lancamento_id,
    tipo: m.tipo,
    valor: Dinheiro.de(m.valor),
    saldo_anterior: Dinheiro.de(m.saldo_anterior),
    saldo_posterior: Dinheiro.de(m.saldo_posterior),
    data: new Date(m.data),
    criado_em: new Date(m.criado_em),
  };
}

/**
 * Caixa/Banco. O saldo NÃO é armazenado: é saldo_inicial da conta + soma assinada dos Movimentos.
 * Cada Movimento guarda saldo_anterior/saldo_posterior como retrato da época da criação.
 */
export class CaixaBancoService {
  constructor(private ctx: Contexto) {}

  private async obterConta(ctx: Contexto, conta_id: UUID) {
    const conta = await ctx.db.selectFrom("fin_conta_bancaria").selectAll().where("id", "=", conta_id).executeTakeFirst();
    if (!conta) throw new ErroDominio("NAO_ENCONTRADO", "Conta não encontrada.");
    return conta;
  }

  /** Saldo atual (todos os movimentos já gravados), usado como saldo_anterior do próximo movimento. */
  private async saldoAtual(ctx: Contexto, conta_id: UUID, saldo_inicial: number): Promise<number> {
    const movs = await ctx.db.selectFrom("fin_movimento").select(["tipo", "valor"]).where("conta_id", "=", conta_id).execute();
    return movs.reduce((s: number, m: any) => s + SINAL[m.tipo as Movimento["tipo"]] * m.valor, saldo_inicial);
  }

  private async inserir(
    ctx: Contexto,
    p: { local_id: UUID; conta_id: UUID; lancamento_id: UUID; tipo: Movimento["tipo"]; valor: Dinheiro; data: Date; saldo_inicial: number; reversao?: boolean },
  ): Promise<Movimento> {
    const anterior = await this.saldoAtual(ctx, p.conta_id, p.saldo_inicial);
    const posterior = anterior + SINAL[p.tipo] * p.valor.centavos;
    const id = novoId();
    await ctx.db
      .insertInto("fin_movimento")
      .values({
        id,
        local_id: p.local_id,
        conta_id: p.conta_id,
        lancamento_id: p.lancamento_id,
        tipo: p.tipo,
        valor: p.valor.centavos,
        saldo_anterior: anterior,
        saldo_posterior: posterior,
        data: p.data.toISOString(),
        reversao: p.reversao ? 1 : 0,
        criado_em: ctx.relogio.agora().toISOString(),
      })
      .execute();
    const m = await ctx.db.selectFrom("fin_movimento").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    return paraMovimento(m);
  }

  /** `valor` opcional movimenta menos que o lançamento (ex.: cartão baixado pelo líquido, sem a taxa). */
  async criarMovimento(lancamento: Lançamento, conta_id: UUID, usuario: Usuario, valor?: Dinheiro, data?: Date): Promise<Movimento> {
    if (lancamento.status === "cancelado") throw new ErroDominio("ESTADO_INVALIDO", "Lançamento cancelado não gera movimento.");
    if (lancamento.tipo !== "recebimento" && lancamento.tipo !== "pagamento") {
      throw new ErroDominio("VALIDACAO_FALHOU", "Apenas recebimento ou pagamento geram movimento direto.");
    }
    return emTransacao(this.ctx, async (tx) => {
      const conta = await this.obterConta(tx, conta_id);
      if (conta.local_id !== lancamento.local_id) {
        throw new ErroDominio("VALIDACAO_FALHOU", "Conta e lançamento pertencem a locais diferentes.");
      }
      const mov = await this.inserir(tx, {
        local_id: lancamento.local_id,
        conta_id,
        lancamento_id: lancamento.id,
        tipo: lancamento.tipo === "recebimento" ? "credito" : "debito",
        valor: valor ?? lancamento.valor,
        data: data ?? lancamento.data,
        saldo_inicial: conta.saldo_inicial,
      });
      await auditar(tx, {
        ator: usuario.email,
        acao: "fin_movimento.criar",
        alvoTipo: "fin_movimento",
        alvoId: mov.id,
        dados: { conta_id, lancamento_id: lancamento.id, tipo: mov.tipo, valor: mov.valor.centavos },
      });
      return mov;
    });
  }

  /**
   * Desfaz o efeito líquido dos movimentos de `origem_id` em cada conta, gravando movimentos opostos ligados a `para_id`
   * (o próprio lançamento ao cancelar; o lançamento de estorno ao estornar). Sem movimentos, não faz nada.
   */
  async reverterMovimentos(origem_id: UUID, para_id: UUID, usuario: Usuario): Promise<void> {
    await emTransacao(this.ctx, async (tx) => {
      const movs = (await tx.db.selectFrom("fin_movimento").selectAll().where("lancamento_id", "=", origem_id).execute()) as any[];
      const liquido = new Map<string, { local_id: UUID; valor: number }>();
      for (const m of movs) {
        const atual = liquido.get(m.conta_id) ?? { local_id: m.local_id, valor: 0 };
        atual.valor += SINAL[m.tipo as Movimento["tipo"]] * m.valor;
        liquido.set(m.conta_id, atual);
      }
      for (const [conta_id, { local_id, valor }] of liquido) {
        if (valor === 0) continue;
        const conta = await this.obterConta(tx, conta_id as UUID);
        const mov = await this.inserir(tx, {
          local_id, conta_id: conta_id as UUID, lancamento_id: para_id, tipo: valor > 0 ? "debito" : "credito",
          valor: Dinheiro.de(Math.abs(valor)), data: tx.relogio.agora(), saldo_inicial: conta.saldo_inicial, reversao: true,
        });
        await auditar(tx, {
          ator: usuario.email, acao: "fin_movimento.reverter", alvoTipo: "fin_movimento", alvoId: mov.id,
          dados: { origem_id, conta_id, valor: mov.valor.centavos },
        });
      }
    });
  }

  /** Saldo da conta ao fim de `data` (saldo_inicial + movimentos com data <= `data`). */
  async obterSaldo(conta_id: UUID, data: Date): Promise<Dinheiro> {
    const conta = await this.obterConta(this.ctx, conta_id);
    const movs = await this.ctx.db
      .selectFrom("fin_movimento")
      .select(["tipo", "valor"])
      .where("conta_id", "=", conta_id)
      .where("data", "<=", data.toISOString())
      .execute();
    return Dinheiro.de(movs.reduce((s: number, m: any) => s + SINAL[m.tipo as Movimento["tipo"]] * m.valor, conta.saldo_inicial));
  }

  async listarMovimentos(conta_id: UUID, data_inicio: Date, data_fim: Date): Promise<Movimento[]> {
    const linhas = await this.ctx.db
      .selectFrom("fin_movimento")
      .selectAll()
      .where("conta_id", "=", conta_id)
      .where("data", ">=", data_inicio.toISOString())
      .where("data", "<=", data_fim.toISOString())
      .orderBy("data")
      .orderBy("criado_em")
      .orderBy("id")
      .execute();
    return linhas.map(paraMovimento);
  }

  async transferir(
    conta_origem_id: UUID,
    conta_destino_id: UUID,
    valor: Dinheiro,
    usuario: Usuario,
  ): Promise<{ mov_origem: Movimento; mov_destino: Movimento }> {
    if (!Number.isInteger(valor.centavos) || valor.centavos <= 0) throw new ErroDominio("VALIDACAO_FALHOU", "Valor deve ser positivo.");
    if (conta_origem_id === conta_destino_id) throw new ErroDominio("VALIDACAO_FALHOU", "Contas de origem e destino devem ser diferentes.");
    return emTransacao(this.ctx, async (tx) => {
      const origem = await this.obterConta(tx, conta_origem_id);
      const destino = await this.obterConta(tx, conta_destino_id);
      if (origem.local_id !== destino.local_id) throw new ErroDominio("VALIDACAO_FALHOU", "Transferência só entre contas do mesmo local.");
      const agora = tx.relogio.agora();
      const lancamento_id = novoId();
      await tx.db
        .insertInto("fin_lancamento")
        .values({
          id: lancamento_id,
          local_id: origem.local_id,
          data: agora.toISOString(),
          tipo: "transferencia",
          origem: "manual",
          valor: valor.centavos,
          forma_pagamento: "transferencia",
          status: "confirmado",
          referencia_id: null,
          referencia_tipo: "transferencia",
          criado_por: usuario.email,
          criado_em: agora.toISOString(),
          dispositivo: usuario.dispositivo ?? null,
        })
        .execute();
      const mov_origem = await this.inserir(tx, {
        local_id: origem.local_id, conta_id: conta_origem_id, lancamento_id, tipo: "transferencia_out",
        valor, data: agora, saldo_inicial: origem.saldo_inicial,
      });
      const mov_destino = await this.inserir(tx, {
        local_id: destino.local_id, conta_id: conta_destino_id, lancamento_id, tipo: "transferencia_in",
        valor, data: agora, saldo_inicial: destino.saldo_inicial,
      });
      await auditar(tx, {
        ator: usuario.email,
        acao: "fin_movimento.transferir",
        alvoTipo: "fin_lancamento",
        alvoId: lancamento_id,
        dados: { conta_origem_id, conta_destino_id, valor: valor.centavos },
      });
      return { mov_origem, mov_destino };
    });
  }
}
