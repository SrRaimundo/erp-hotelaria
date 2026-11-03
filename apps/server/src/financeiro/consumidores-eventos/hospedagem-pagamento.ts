import { criarAlerta } from "../../infra/alertas.js";
import { auditar } from "../../infra/auditoria.js";
import type { Evento } from "../../infra/barramento.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { novoId, type UUID } from "../../shared/ids.js";
import type { Lançamento } from "../modelos/lançamento.js";
import { CaixaBancoService } from "../servicos/caixa-banco.js";
import { CartaoService } from "../servicos/cartao.js";
import { FaturamentoService } from "../servicos/faturamento.js";
import { reverterLancamento } from "../servicos/reversao.js";
import { LançamentoService } from "../servicos/lançamentos.js";
import { LocalService, type Usuario } from "../servicos/locais.js";

const USUARIO_SISTEMA: Usuario = { email: "sistema@financeiro", dispositivo: "consumidor-eventos" };
const FORMAS_LANCAMENTO = ["dinheiro", "pix", "debito", "credito"] as const;
type FormaLancamento = (typeof FORMAS_LANCAMENTO)[number];
export const REFERENCIA_PAGAMENTO = "hospedagem_pagamento";

export type PagamentoRegistrado = { pagamentoId: string; contaId: string; reservaId: string | null; formaCodigo: string; valor: number };
export type ValorAReceberCriado = { valorAReceberId: string; contaId: string; reservaId: string; valor: number };

/**
 * Resolve o local financeiro da hospedagem: o ativo marcado como padrão na tela Local; sem marcação, o ativo mais antigo.
 * Sem nenhum local, cria o "Principal" para que nenhum pagamento se perca.
 */
async function resolverLocal(tx: Contexto): Promise<UUID> {
  const ativos = (await tx.db.selectFrom("fin_local").select(["id", "parametros"]).where("ativo", "=", 1).orderBy("criado_em").orderBy("id").execute()) as any[];
  const marcado = ativos.find((l) => l.parametros && JSON.parse(l.parametros).hospedagem_padrao === true);
  const escolhido = marcado ?? ativos[0];
  if (escolhido) return escolhido.id as UUID;
  return (await new LocalService(tx).criar(novoId(), "Principal", USUARIO_SISTEMA)).id;
}

async function contaCaixa(tx: Contexto, local_id: UUID): Promise<UUID | null> {
  const c = await tx.db.selectFrom("fin_conta_bancaria").select("id").where("local_id", "=", local_id).where("tipo", "=", "caixa").orderBy("criado_em").orderBy("id").executeTakeFirst();
  return (c?.id as UUID) ?? null;
}

/** Cria ou reaproveita o fin_cliente (por documento, ou por nome quando sem documento). */
async function upsertCliente(tx: Contexto, local_id: UUID, nome: string, documento: string | null | undefined): Promise<UUID> {
  const doc = documento?.trim() ? documento.trim() : null;
  let q = tx.db.selectFrom("fin_cliente").select("id").where("local_id", "=", local_id);
  q = doc ? q.where("cpf_cnpj", "=", doc) : q.where("cpf_cnpj", "is", null).where("nome", "=", nome);
  const existente = await q.executeTakeFirst();
  if (existente) return existente.id as UUID;
  const id = novoId();
  const digitos = (doc ?? "").replace(/\D/g, "");
  await tx.db
    .insertInto("fin_cliente")
    .values({
      id,
      local_id,
      nome,
      cpf_cnpj: doc,
      tipo: digitos.length === 14 ? "pessoa_juridica" : "pessoa_fisica",
      contato: null,
      criado_em: tx.relogio.agora().toISOString(),
    })
    .execute();
  return id;
}

export async function processarPagamentoRegistrado(ctx: Contexto, evento: Pick<Evento, "payload" | "criadoEm">): Promise<void> {
  const p = evento.payload as PagamentoRegistrado;
  if (!(FORMAS_LANCAMENTO as readonly string[]).includes(p.formaCodigo)) {
    console.log(`Financeiro: pagamento ${p.pagamentoId} (${p.formaCodigo}) ignorado - forma sem lançamento direto.`);
    return;
  }
  const forma = p.formaCodigo as FormaLancamento;
  await emTransacao(ctx, async (tx) => {
    const dup = await tx.db
      .selectFrom("fin_lancamento")
      .select("id")
      .where("referencia_id", "=", p.pagamentoId)
      .where("referencia_tipo", "=", REFERENCIA_PAGAMENTO)
      .executeTakeFirst();
    if (dup) return;
    const local_id = await resolverLocal(tx);

    // Hóspede: titular da reserva; sem reserva, titular da conta.
    const origem = p.reservaId
      ? await tx.db.selectFrom("reservas").select("titular_id").where("id", "=", p.reservaId).executeTakeFirst()
      : await tx.db.selectFrom("contas").select("titular_id").where("id", "=", p.contaId).executeTakeFirst();
    const hospede = origem
      ? await tx.db.selectFrom("hospedes").select(["nome", "documento"]).where("id", "=", origem.titular_id).executeTakeFirst()
      : undefined;
    if (hospede) await upsertCliente(tx, local_id, hospede.nome, hospede.documento);

    const lanc: Lançamento = await new LançamentoService(tx).criar({
      local_id,
      data: new Date(evento.criadoEm),
      tipo: "recebimento",
      origem: "hospedagem",
      valor: Dinheiro.de(p.valor),
      forma_pagamento: forma,
      referencia_id: p.pagamentoId as UUID,
      referencia_tipo: REFERENCIA_PAGAMENTO,
      usuario: USUARIO_SISTEMA,
    });

    if (forma === "dinheiro" || forma === "pix") {
      const conta = await contaCaixa(tx, local_id);
      if (!conta) throw new Error("Financeiro: conta Caixa do Local não encontrada.");
      await new CaixaBancoService(tx).criarMovimento(lanc, conta, USUARIO_SISTEMA);
    } else {
      // Cartão: espera a operadora (previsão, taxa e baixa na tela Cartão de Crédito).
      await new CartaoService(tx).registrarDeLancamento(lanc, forma === "debito" ? "debito" : "credito", "Não informada");
    }
  });
}

export async function processarValorAReceberCriado(ctx: Contexto, evento: Pick<Evento, "payload">): Promise<void> {
  const e = evento.payload as ValorAReceberCriado;
  await emTransacao(ctx, async (tx) => {
    const dup = await tx.db
      .selectFrom("fin_faturamento")
      .select("id")
      .where("referencia_id", "=", e.valorAReceberId)
      .where("status", "!=", "cancelado")
      .executeTakeFirst();
    if (dup) return;
    const local_id = await resolverLocal(tx);
    const v = await tx.db
      .selectFrom("valores_a_receber")
      .select(["responsavel_nome", "responsavel_documento", "valor"])
      .where("id", "=", e.valorAReceberId)
      .executeTakeFirst();
    if (!v) throw new Error(`Financeiro: valor a receber ${e.valorAReceberId} não encontrado.`);

    const cliente_id = await upsertCliente(tx, local_id, v.responsavel_nome, v.responsavel_documento);
    const valor = Dinheiro.de(e.valor ?? v.valor);
    // O checkout faturado fica aberto em Faturamento; a fatura só vai a Contas a Receber quando for fechada ali.
    await new FaturamentoService(tx).criarParaCheckout(e.valorAReceberId as UUID, cliente_id, local_id, valor, USUARIO_SISTEMA);
  });
}

export type PagamentoEstornado = { pagamentoId: string; estornoId: string; contaId: string; reservaId: string | null; valor: number };

const alertarConciliado = (tx: Contexto, alvoId: string, mensagem: string) =>
  criarAlerta(tx, { tipo: "financeiro_estorno_conciliado", alvoTipo: "fin_lancamento", alvoId, mensagem });

/**
 * Estorno de pagamento na hospedagem: desfaz o lançamento do Financeiro e seu efeito (saldo do caixa, cartão a receber,
 * faturamento aberto), uma única vez. Se o dinheiro já foi conciliado (cartão baixado, fatura fechada), não altera nada:
 * abre um alerta para decisão manual.
 */
export async function processarPagamentoEstornado(ctx: Contexto, evento: Pick<Evento, "payload" | "criadoEm">): Promise<void> {
  const p = evento.payload as PagamentoEstornado;
  await emTransacao(ctx, async (tx) => {
    const l = (await tx.db
      .selectFrom("fin_lancamento")
      .select(["id", "status", "valor"])
      .where("referencia_tipo", "=", REFERENCIA_PAGAMENTO)
      .where("referencia_id", "=", p.pagamentoId)
      .executeTakeFirst()) as { id: UUID; status: string; valor: number } | undefined;

    if (!l) return faturadoEstornado(tx, p);
    if (l.status === "cancelado") return; // já desfeito: o mesmo estorno não age de novo
    const cartao = (await tx.db.selectFrom("fin_cartao_movimento").select(["bandeira", "tipo", "status"]).where("lancamento_id", "=", l.id).executeTakeFirst()) as { status: string; bandeira: string; tipo: string } | undefined;
    if (cartao?.status === "baixado") {
      await alertarConciliado(tx, l.id, `O pagamento em cartão (${cartao.bandeira}, ${cartao.tipo}) de R$ ${(l.valor / 100).toFixed(2).replace(".", ",")} foi estornado na hospedagem, mas o cartão já foi baixado no Caixa e Banco. Nada foi alterado: decida se estorna a baixa em Caixa e Banco.`);
      return;
    }
    await reverterLancamento(tx, l.id, { modo: "cancelar", motivo: "Estorno do pagamento na hospedagem", usuario: USUARIO_SISTEMA, interno: true });
  });
}

/** Pagamento faturado estornado: cancela o faturamento ainda aberto; fatura já fechada exige decisão manual. */
async function faturadoEstornado(tx: Contexto, p: PagamentoEstornado): Promise<void> {
  const pag = (await tx.db.selectFrom("pagamentos").select("forma_codigo").where("id", "=", p.pagamentoId).executeTakeFirst()) as { forma_codigo: string } | undefined;
  if (pag?.forma_codigo !== "faturado") return; // forma sem lançamento no Financeiro
  const candidatos = (await tx.db
    .selectFrom("valores_a_receber as v")
    .innerJoin("fin_faturamento as f", "f.referencia_id", "v.id")
    .select(["f.id", "f.numero_documento", "f.valor_original"])
    .where("v.conta_id", "=", p.contaId)
    .where("v.valor", "=", -p.valor)
    .where("f.status", "!=", "cancelado")
    .$if(!!p.reservaId, (q) => q.where("v.reserva_id", "=", p.reservaId!))
    .execute()) as { id: UUID; numero_documento: string | null; valor_original: number }[];
  if (candidatos.length === 0) return;
  if (candidatos.length > 1) {
    await alertarConciliado(tx, p.pagamentoId, `Um pagamento faturado de R$ ${(-p.valor / 100).toFixed(2).replace(".", ",")} foi estornado na hospedagem, mas há mais de um faturamento com esse valor nesta conta. Nada foi alterado: cancele o faturamento correto em Faturamento.`);
    return;
  }
  const f = candidatos[0]!;
  if (f.numero_documento) {
    await alertarConciliado(tx, f.id, `O valor faturado (documento ${f.numero_documento}, R$ ${(f.valor_original / 100).toFixed(2).replace(".", ",")}) foi estornado na hospedagem, mas a fatura já foi fechada em Contas a Receber. Nada foi alterado: decida o que fazer com a cobrança.`);
    return;
  }
  await tx.db.updateTable("fin_faturamento").set({ status: "cancelado" }).where("id", "=", f.id).execute();
  await auditar(tx, { ator: USUARIO_SISTEMA.email, acao: "fin_faturamento.cancelar", alvoTipo: "fin_faturamento", alvoId: f.id, motivo: "Estorno do pagamento faturado na hospedagem" });
}
