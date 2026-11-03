import { readFileSync } from "node:fs";
import { beforeEach, expect, test } from "vitest";
import { processarPagamentoRegistrado, processarValorAReceberCriado, registrarConsumidoresHospedagem } from "../../../src/financeiro/consumidores-eventos/hospedagem-pagamento.js";
import { LocalService } from "../../../src/financeiro/servicos/locais.js";
import { criarCategoria } from "../../../src/nucleo/categorias.js";
import { salvarHospede } from "../../../src/nucleo/hospedes.js";
import { gerarUUID } from "../../../src/shared/ids.js";
import { criarContextoTeste } from "../../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let localId: string;
let vez = 0;
const CRIADO = "2026-11-10T15:00:00.000Z";

beforeEach(async () => {
  ctx = await criarContextoTeste();
  localId = (await new LocalService(ctx).criar(gerarUUID(), "Pousada", { email: "a@b.c" })).id;
  const cat = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 2, maxCriancas: 0, comodidades: [] }, "u1")).id;
  await salvarHospede(ctx, {
    id: "h1", nome: "Maria Hospede", documentoTipo: "cpf", documento: "52998224725", nascimento: "1990-01-01", nacionalidade: "BR",
  }, "u1");
  await ctx.db.insertInto("contas").values({ id: "c1", titular_id: "h1", situacao: "aberta" }).execute();
  await ctx.db.insertInto("reservas").values({
    id: "r1", codigo: 1, estado: "hospedada", titular_id: "h1", categoria_id: cat, quarto_id: null, chegada: "2026-11-10", saida: "2026-11-12",
    adultos: 1, criancas: "[]", canal: "Balcao", conta_id: "c1", valor_sinal: 0, criada_em: CRIADO,
  }).execute();
});

const pagamento = (formaCodigo: string, valor = 15000, reservaId: string | null = "r1") => ({
  criadoEm: CRIADO,
  payload: { pagamentoId: `p${++vez}`, contaId: "c1", reservaId, formaCodigo, valor, criadoEm: CRIADO },
});

const movimentos = () => ctx.db.selectFrom("fin_movimento").selectAll().execute();

test.each(["dinheiro", "pix"])("pagamento %s: lança recebimento e movimenta o Caixa", async (forma) => {
  const ev = pagamento(forma);
  await processarPagamentoRegistrado(ctx, ev);
  const ls = await ctx.db.selectFrom("fin_lancamento").selectAll().execute();
  expect(ls).toHaveLength(1);
  expect(ls[0]).toMatchObject({ tipo: "recebimento", origem: "hospedagem", forma_pagamento: forma, valor: 15000, local_id: localId, referencia_id: ev.payload.pagamentoId });
  const movs = await movimentos();
  expect(movs).toHaveLength(1);
  expect(movs[0]).toMatchObject({ tipo: "credito", valor: 15000, lancamento_id: ls[0]!.id });
  const clientes = await ctx.db.selectFrom("fin_cliente").selectAll().execute();
  expect(clientes).toHaveLength(1);
  expect(clientes[0]).toMatchObject({ nome: "Maria Hospede", cpf_cnpj: "52998224725" });
});

test.each(["debito", "credito"])("pagamento %s: lança sem movimento (roteamento de cartão futuro)", async (forma) => {
  await processarPagamentoRegistrado(ctx, pagamento(forma));
  const ls = await ctx.db.selectFrom("fin_lancamento").selectAll().execute();
  expect(ls).toHaveLength(1);
  expect(ls[0]!.forma_pagamento).toBe(forma);
  expect(await movimentos()).toHaveLength(0);
});

test("pagamento: idempotente, reaproveita cliente, usa titular da conta sem reserva e ignora faturado", async () => {
  const ev = pagamento("pix", 5000, null);
  await processarPagamentoRegistrado(ctx, ev);
  await processarPagamentoRegistrado(ctx, ev);
  await processarPagamentoRegistrado(ctx, pagamento("dinheiro"));
  await processarPagamentoRegistrado(ctx, pagamento("faturado"));
  expect(await ctx.db.selectFrom("fin_lancamento").selectAll().execute()).toHaveLength(2);
  expect(await ctx.db.selectFrom("fin_cliente").selectAll().execute()).toHaveLength(1);
});

test("ValorAReceberCriado: cria cliente, faturamento, cobrança e recebível com vencimento em 30 dias", async () => {
  await ctx.db.insertInto("valores_a_receber").values({
    id: "v1", conta_id: "c1", reserva_id: "r1", responsavel_nome: "Empresa X Ltda", responsavel_documento: "11222333000181",
    valor: 90000, criado_em: CRIADO, situacao: "aberto",
  }).execute();
  const ev = { payload: { valorAReceberId: "v1", contaId: "c1", reservaId: "r1", valor: 90000 } };
  await processarValorAReceberCriado(ctx, ev);
  await processarValorAReceberCriado(ctx, ev); // idempotente
  const cli = await ctx.db.selectFrom("fin_cliente").selectAll().execute();
  expect(cli).toHaveLength(1);
  expect(cli[0]).toMatchObject({ nome: "Empresa X Ltda", tipo: "pessoa_juridica" });
  const fats = await ctx.db.selectFrom("fin_faturamento").selectAll().execute();
  expect(fats).toHaveLength(1);
  expect(fats[0]).toMatchObject({ referencia_id: "v1", valor_original: 90000, forma_cobranca: "boleto", cliente_id: cli[0]!.id });
  const recs = await ctx.db.selectFrom("fin_conta_receber").selectAll().execute();
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ numero_documento: fats[0]!.numero_documento, valor_original: 90000, status: "pendente" });
  expect(new Date(recs[0]!.data_vencimento).getTime() - new Date(CRIADO).getTime()).toBe(30 * 86400000);
});

test("registrarConsumidoresHospedagem: assina o evento no barramento", async () => {
  registrarConsumidoresHospedagem(ctx);
  const ev = pagamento("dinheiro");
  ctx.barramento.publicar({ id: "e1", seq: 1, tipo: "hospedagem.PagamentoRegistrado", payload: ev.payload, criadoEm: CRIADO });
  await new Promise((r) => setTimeout(r, 150));
  expect(await ctx.db.selectFrom("fin_lancamento").selectAll().execute()).toHaveLength(1);
});

test("consumidores de eventos não dependem de permissão de usuário", () => {
  const fonte = readFileSync(new URL("../../../src/financeiro/consumidores-eventos/hospedagem-pagamento.ts", import.meta.url), "utf8");
  expect(fonte).not.toMatch(/exigirPermissao|exigirAlgumaPermissao|PERMISSAO_FINANCEIRO|financeiro\.gerenciar/);
});
