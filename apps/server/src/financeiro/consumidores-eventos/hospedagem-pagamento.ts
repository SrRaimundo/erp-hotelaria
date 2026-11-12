import type { Evento } from "../../infra/barramento.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { novoId, type UUID } from "../../shared/ids.js";
import type { Lançamento } from "../modelos/lançamento.js";
import { CaixaBancoService } from "../servicos/caixa-banco.js";
import { ContasReceberService } from "../servicos/contas-receber.js";
import { FaturamentoService } from "../servicos/faturamento.js";
import { LançamentoService } from "../servicos/lançamentos.js";
import { LocalService, type Usuario } from "../servicos/locais.js";

const USUARIO_SISTEMA: Usuario = { email: "sistema@financeiro", dispositivo: "consumidor-eventos" };
const FORMAS_LANCAMENTO = ["dinheiro", "pix", "debito", "credito"] as const;
type FormaLancamento = (typeof FORMAS_LANCAMENTO)[number];
export const REFERENCIA_PAGAMENTO = "hospedagem_pagamento";

export type PagamentoRegistrado = { pagamentoId: string; contaId: string; reservaId: string | null; formaCodigo: string; valor: number };
export type ValorAReceberCriado = { valorAReceberId: string; contaId: string; reservaId: string; valor: number };

/**
 * Resolve o local financeiro da hospedagem. Há um Local por pousada; usa-se `parametros.local_padrao_hospedagem`
 * quando ele aponta para um fin_local existente, senão o próprio Local (mesmo fallback de LocalService).
 */
async function resolverLocal(tx: Contexto): Promise<UUID | null> {
  const base = await tx.db.selectFrom("fin_local").select("id").where("ativo", "=", 1).orderBy("criado_em").orderBy("id").executeTakeFirst();
  if (!base) return null;
  const local = await new LocalService(tx).obter(base.id);
  const padrao = local.parametros.local_padrao_hospedagem;
  const existe = await tx.db.selectFrom("fin_local").select("id").where("id", "=", padrao).executeTakeFirst();
  return (existe ? padrao : local.id) as UUID;
}

async function contaCaixa(tx: Contexto, local_id: UUID): Promise<UUID | null> {
  const c = await tx.db.selectFrom("fin_conta_bancaria").select("id").where("local_id", "=", local_id).where("nome", "=", "Caixa").executeTakeFirst();
  return (c?.id ?? null) as UUID | null;
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
  if (!(p.valor > 0)) {
    console.log(`Financeiro: pagamento ${p.pagamentoId} com valor ${p.valor} ignorado (estorno não tratado).`);
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
    if (!local_id) throw new Error("Financeiro: nenhum Local ativo para registrar pagamento de hospedagem.");

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
      console.log(`Financeiro: lançamento ${lanc.id} (${forma}) aguarda roteamento de cartão.`);
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
    if (!local_id) throw new Error("Financeiro: nenhum Local ativo para faturar checkout.");
    const v = await tx.db
      .selectFrom("valores_a_receber")
      .select(["responsavel_nome", "responsavel_documento", "valor"])
      .where("id", "=", e.valorAReceberId)
      .executeTakeFirst();
    if (!v) throw new Error(`Financeiro: valor a receber ${e.valorAReceberId} não encontrado.`);

    const cliente_id = await upsertCliente(tx, local_id, v.responsavel_nome, v.responsavel_documento);
    const valor = Dinheiro.de(e.valor ?? v.valor);
    const faturamentos = new FaturamentoService(tx);
    const fat = await faturamentos.criarParaCheckout(e.valorAReceberId as UUID, cliente_id, local_id, valor, USUARIO_SISTEMA);
    const cobr = await faturamentos.gerarCobranca(fat.id, "boleto", USUARIO_SISTEMA);
    // data_vencimento do faturamento = emissão + 30 dias
    await new ContasReceberService(tx).criarRecebivel(
      fat.id, cliente_id, local_id, cobr.numero_documento, valor, cobr.data_vencimento, USUARIO_SISTEMA,
    );
  });
}

/** Assina os eventos de hospedagem no barramento do contexto. */
export function registrarConsumidoresHospedagem(ctx: Contexto & { barramento: { assinar(tipo: string, fn: (e: Evento) => void | Promise<void>): void } }): void {
  ctx.barramento.assinar("hospedagem.PagamentoRegistrado", (e) => processarPagamentoRegistrado(ctx, e));
  ctx.barramento.assinar("hospedagem.ValorAReceberCriado", (e) => processarValorAReceberCriado(ctx, e));
}
