import { auditar } from "../infra/auditoria.js";
import { criarAlerta } from "../infra/alertas.js";
import { registrarEvento } from "../infra/outbox.js";
import { exigirCaixaAberto, registrarMovimento } from "../nucleo/caixa.js";
import type { UsuarioSessao } from "../nucleo/permissoes.js";
import { autorizarSupervisor } from "../nucleo/supervisor.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import type { Centavos } from "../shared/dinheiro.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";
import type { Data } from "../shared/tempo.js";
import type { Autorizacao } from "./alteracao.js";
import { transicionar } from "./estados.js";

export type NovoLancamento = {
  contaId: string;
  reservaId?: string;
  tipo: "diaria" | "extra";
  origem: string;
  produtoId?: string;
  descricao: string;
  quantidade: number;
  valorUnitario: Centavos;
  dataRef?: Data;
};

export type LinhaExtrato = {
  id: string;
  natureza: "debito" | "credito";
  tipo: string;
  origem: string;
  descricao: string;
  valor: Centavos;
  instante: string;
  estornaId: string | null;
  reservaId: string | null;
};

async function exigirContaAberta(tx: Contexto, contaId: string): Promise<void> {
  const c = await tx.db.selectFrom("contas").select("situacao").where("id", "=", contaId).executeTakeFirst();
  if (!c) throw new ErroDominio("CONTA_NAO_ENCONTRADA", "Conta não encontrada. Confira o número informado.", { contaId });
  if (c.situacao === "fechada") {
    throw new ErroDominio("CONTA_FECHADA", "Esta conta já foi fechada e não aceita novos movimentos.", { contaId });
  }
}

/** Roda na transação do chamador ou abre uma. Lançamentos nunca são alterados: só estornados. */
export async function lancar(ctx: Contexto, d: NovoLancamento, ator: string): Promise<string> {
  if (!Number.isInteger(d.quantidade) || d.quantidade < 1) {
    throw new ErroDominio("QUANTIDADE_INVALIDA", "Quantidade inválida. Informe um número inteiro de 1 em diante.");
  }
  if (!Number.isInteger(d.valorUnitario)) {
    throw new ErroDominio("VALOR_INVALIDO", "Valor inválido. Informe o valor em centavos, sem casas decimais.");
  }
  return emTransacao(ctx, async (tx) => {
    await exigirContaAberta(tx, d.contaId);
    const id = novoId();
    const valor = d.quantidade * d.valorUnitario;
    await tx.db.insertInto("lancamentos").values({
      id, conta_id: d.contaId, reserva_id: d.reservaId ?? null, tipo: d.tipo, origem: d.origem,
      produto_id: d.produtoId ?? null, descricao: d.descricao, quantidade: d.quantidade, valor,
      data_ref: d.dataRef ?? null, estorna_id: null, instante: tx.relogio.agora().toISOString(), usuario: ator,
    }).execute();
    await auditar(tx, {
      ator, acao: "conta.lancar", alvoTipo: "lancamento", alvoId: id,
      dados: { contaId: d.contaId, tipo: d.tipo, origem: d.origem, descricao: d.descricao, quantidade: d.quantidade, valor },
    });
    await registrarEvento(tx, "hospedagem.LancamentoCriado", { lancamentoId: id, contaId: d.contaId, tipo: d.tipo, valor });
    return id;
  });
}

export async function estornarLancamento(
  ctx: Contexto,
  lancamentoId: string,
  usuario: UsuarioSessao,
  autorizacao: Autorizacao | undefined,
): Promise<string> {
  const aut = await autorizarSupervisor(ctx, autorizacao?.supervisor, autorizacao?.motivo);
  return emTransacao(ctx, async (tx) => {
    const o = await tx.db.selectFrom("lancamentos").selectAll().where("id", "=", lancamentoId).executeTakeFirst();
    if (!o) throw new ErroDominio("LANCAMENTO_NAO_ENCONTRADO", "Lançamento não encontrado.", { lancamentoId });
    if (o.tipo === "estorno") {
      throw new ErroDominio("ESTORNO_INVALIDO", "Um estorno não pode ser estornado. Faça um novo lançamento se precisar.");
    }
    const ja = await tx.db.selectFrom("lancamentos").select("id").where("estorna_id", "=", lancamentoId).executeTakeFirst();
    if (ja) throw new ErroDominio("JA_ESTORNADO", "Este lançamento já foi estornado.", { lancamentoId });
    await exigirContaAberta(tx, o.conta_id);
    const id = novoId();
    await tx.db.insertInto("lancamentos").values({
      id, conta_id: o.conta_id, reserva_id: o.reserva_id, tipo: "estorno", origem: o.origem, produto_id: o.produto_id,
      descricao: `Estorno: ${o.descricao}`, quantidade: o.quantidade, valor: -o.valor, data_ref: null,
      estorna_id: o.id, instante: tx.relogio.agora().toISOString(), usuario: usuario.id,
    }).execute();
    await auditar(tx, {
      ator: usuario.id, acao: "conta.estornar_lancamento", alvoTipo: "lancamento", alvoId: lancamentoId,
      motivo: aut.motivo, supervisorId: aut.supervisorId, dados: { estornoId: id, valor: -o.valor },
    });
    await registrarEvento(tx, "hospedagem.LancamentoEstornado", { lancamentoId, estornoId: id, contaId: o.conta_id, valor: -o.valor });
    return id;
  });
}

export async function pagoNaReserva(ctx: Contexto, reservaId: string): Promise<Centavos> {
  const l = await ctx.db
    .selectFrom("pagamentos")
    .select((eb) => eb.fn.sum<number>("valor").as("total"))
    .where("reserva_id", "=", reservaId)
    .executeTakeFirst();
  return Number(l?.total ?? 0);
}

export async function registrarPagamento(
  ctx: Contexto,
  d: { contaId: string; reservaId?: string; formaCodigo: string; valor: Centavos },
  usuario: UsuarioSessao,
): Promise<string> {
  if (!Number.isInteger(d.valor) || d.valor <= 0) {
    throw new ErroDominio("VALOR_INVALIDO", "Valor inválido. Informe um valor maior que zero, em centavos.");
  }
  return emTransacao(ctx, async (tx) => {
    const turno = await exigirCaixaAberto(tx, usuario.id);
    await exigirContaAberta(tx, d.contaId);
    const forma = await tx.db.selectFrom("formas_pagamento").select("ativa").where("codigo", "=", d.formaCodigo).executeTakeFirst();
    if (!forma) throw new ErroDominio("FORMA_NAO_ENCONTRADA", "Forma de pagamento não encontrada.", { formaCodigo: d.formaCodigo });
    if (forma.ativa !== 1) {
      throw new ErroDominio("FORMA_INATIVA", "Esta forma de pagamento está desativada. Escolha outra forma.", { formaCodigo: d.formaCodigo });
    }
    const reserva = d.reservaId
      ? await tx.db.selectFrom("reservas").select(["estado", "valor_sinal", "conta_id"]).where("id", "=", d.reservaId).executeTakeFirst()
      : undefined;
    if (d.reservaId && (!reserva || reserva.conta_id !== d.contaId)) {
      throw new ErroDominio("RESERVA_NAO_ENCONTRADA", "Reserva não encontrada nesta conta. Confira o número informado.", { reservaId: d.reservaId });
    }

    const id = novoId();
    await tx.db.insertInto("pagamentos").values({
      id, conta_id: d.contaId, reserva_id: d.reservaId ?? null, forma_codigo: d.formaCodigo, valor: d.valor,
      estorna_id: null, turno_id: turno.id, instante: tx.relogio.agora().toISOString(), usuario: usuario.id,
    }).execute();
    await registrarMovimento(tx, turno.id, { formaCodigo: d.formaCodigo, valor: d.valor, origemTipo: "pagamento", origemId: id });
    await auditar(tx, {
      ator: usuario.id, acao: "conta.pagar", alvoTipo: "pagamento", alvoId: id,
      dados: { contaId: d.contaId, reservaId: d.reservaId ?? null, formaCodigo: d.formaCodigo, valor: d.valor },
    });
    await registrarEvento(tx, "hospedagem.PagamentoRegistrado", { pagamentoId: id, contaId: d.contaId, reservaId: d.reservaId ?? null, formaCodigo: d.formaCodigo, valor: d.valor });

    if (reserva && d.reservaId) {
      if (reserva.estado === "cancelada") {
        await criarAlerta(tx, {
          tipo: "pagamento_reserva_cancelada", alvoTipo: "reserva", alvoId: d.reservaId,
          mensagem: "Entrou um pagamento em uma reserva cancelada. Confira com o hóspede e providencie a devolução ou a reativação.",
        });
      } else if (reserva.estado === "pre_reserva" && (await pagoNaReserva(tx, d.reservaId)) >= reserva.valor_sinal) {
        transicionar(reserva.estado, "confirmada");
        await tx.db.updateTable("reservas").set({ estado: "confirmada" }).where("id", "=", d.reservaId).execute();
        await auditar(tx, {
          ator: usuario.id, acao: "reserva.confirmar", alvoTipo: "reserva", alvoId: d.reservaId,
          dados: { valorSinal: reserva.valor_sinal, pagamentoId: id },
        });
        await registrarEvento(tx, "hospedagem.ReservaConfirmada", { reservaId: d.reservaId });
      }
    }
    return id;
  });
}

export async function estornarPagamento(
  ctx: Contexto,
  pagamentoId: string,
  usuario: UsuarioSessao,
  autorizacao: Autorizacao | undefined,
): Promise<string> {
  const aut = await autorizarSupervisor(ctx, autorizacao?.supervisor, autorizacao?.motivo);
  return emTransacao(ctx, async (tx) => {
    const o = await tx.db.selectFrom("pagamentos").selectAll().where("id", "=", pagamentoId).executeTakeFirst();
    if (!o) throw new ErroDominio("PAGAMENTO_NAO_ENCONTRADO", "Pagamento não encontrado.", { pagamentoId });
    if (o.estorna_id) {
      throw new ErroDominio("ESTORNO_INVALIDO", "Um estorno não pode ser estornado. Registre um novo pagamento se precisar.");
    }
    const ja = await tx.db.selectFrom("pagamentos").select("id").where("estorna_id", "=", pagamentoId).executeTakeFirst();
    if (ja) throw new ErroDominio("JA_ESTORNADO", "Este pagamento já foi estornado.", { pagamentoId });
    const turno = await exigirCaixaAberto(tx, usuario.id);
    const id = novoId();
    await tx.db.insertInto("pagamentos").values({
      id, conta_id: o.conta_id, reserva_id: o.reserva_id, forma_codigo: o.forma_codigo, valor: -o.valor,
      estorna_id: o.id, turno_id: turno.id, instante: tx.relogio.agora().toISOString(), usuario: usuario.id,
    }).execute();
    await registrarMovimento(tx, turno.id, { formaCodigo: o.forma_codigo, valor: -o.valor, origemTipo: "pagamento", origemId: id });
    await auditar(tx, {
      ator: usuario.id, acao: "conta.estornar_pagamento", alvoTipo: "pagamento", alvoId: pagamentoId,
      motivo: aut.motivo, supervisorId: aut.supervisorId, dados: { estornoId: id, valor: -o.valor },
    });
    await registrarEvento(tx, "hospedagem.PagamentoEstornado", { pagamentoId, estornoId: id, contaId: o.conta_id, reservaId: o.reserva_id, valor: -o.valor });
    return id;
  });
}

export async function saldo(ctx: Contexto, contaId: string): Promise<{ debitos: Centavos; creditos: Centavos; saldo: Centavos }> {
  const d = await ctx.db.selectFrom("lancamentos").select((eb) => eb.fn.sum<number>("valor").as("t")).where("conta_id", "=", contaId).executeTakeFirst();
  const c = await ctx.db.selectFrom("pagamentos").select((eb) => eb.fn.sum<number>("valor").as("t")).where("conta_id", "=", contaId).executeTakeFirst();
  const debitos = Number(d?.t ?? 0);
  const creditos = Number(c?.t ?? 0);
  return { debitos, creditos, saldo: debitos - creditos };
}

export async function extrato(ctx: Contexto, contaId: string): Promise<LinhaExtrato[]> {
  const ls = await ctx.db.selectFrom("lancamentos").selectAll().where("conta_id", "=", contaId).execute();
  const ps = await ctx.db.selectFrom("pagamentos").selectAll().where("conta_id", "=", contaId).execute();
  const linhas: LinhaExtrato[] = [
    ...ls.map((l): LinhaExtrato => ({
      id: l.id, natureza: "debito", tipo: l.tipo, origem: l.origem, descricao: l.descricao, valor: l.valor,
      instante: l.instante, estornaId: l.estorna_id, reservaId: l.reserva_id,
    })),
    ...ps.map((p): LinhaExtrato => ({
      id: p.id, natureza: "credito", tipo: p.estorna_id ? "estorno" : "pagamento", origem: "caixa",
      descricao: `Pagamento (${p.forma_codigo})`, valor: p.valor, instante: p.instante, estornaId: p.estorna_id, reservaId: p.reserva_id,
    })),
  ];
  return linhas.sort((a, b) => (a.instante === b.instante ? a.id.localeCompare(b.id) : a.instante.localeCompare(b.instante)));
}
