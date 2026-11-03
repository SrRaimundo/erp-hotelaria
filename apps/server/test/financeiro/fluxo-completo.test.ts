import { expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { processarPagamentoRegistrado, processarValorAReceberCriado } from "../../src/financeiro/consumidores-eventos/hospedagem-pagamento.js";
import { LocalService } from "../../src/financeiro/servicos/locais.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import { gerarUUID } from "../../src/shared/ids.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

const CRIADO = "2026-11-10T15:00:00.000Z";

test("fluxo financeiro completo: sinal, checkout dividido, faturado e idempotência", async () => {
  // Setup
  const ctx = await criarContextoTeste();
  const app = criarApp(ctx);
  const admin = await entrarComo(ctx, "admin"); // perfil admin possui caixa.operar
  const local = await new LocalService(ctx).criar(gerarUUID(), "Pousada", { email: "a@b.c" });
  const caixa = await ctx.db.selectFrom("fin_conta_bancaria").select("id").where("local_id", "=", local.id).where("nome", "=", "Caixa").executeTakeFirstOrThrow();
  const cat = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 2, maxCriancas: 0, comodidades: [] }, "u1")).id;
  await salvarHospede(ctx, { id: "h1", nome: "Maria Hospede", documentoTipo: "cpf", documento: "52998224725", nascimento: "1990-01-01", nacionalidade: "BR" }, "u1");
  await ctx.db.insertInto("contas").values({ id: "c1", titular_id: "h1", situacao: "aberta" }).execute();
  await ctx.db.insertInto("reservas").values({
    id: "r1", codigo: 1, estado: "pre_reserva", titular_id: "h1", categoria_id: cat, quarto_id: null, chegada: "2026-11-10", saida: "2026-11-12",
    adultos: 1, criancas: "[]", canal: "Balcao", conta_id: "c1", valor_sinal: 0, criada_em: CRIADO,
  } as any).execute();

  const saldo = async () =>
    (await app.inject({ method: "GET", url: `/api/financeiro/caixa-banco/saldo?conta_id=${caixa.id}&data=2026-12-31`, headers: admin })).json().saldo;
  const lancs = () => ctx.db.selectFrom("fin_lancamento").selectAll().orderBy("criado_em").execute();
  const movs = () => ctx.db.selectFrom("fin_movimento").selectAll().execute();
  const pag = (pagamentoId: string, formaCodigo: string, valor: number) => ({
    criadoEm: CRIADO,
    payload: { pagamentoId, contaId: "c1", reservaId: "r1", formaCodigo, valor, criadoEm: CRIADO },
  });

  // Fase 1: sinal por pix
  const sinal = pag("p-sinal", "pix", 5000);
  await processarPagamentoRegistrado(ctx, sinal);
  let ls = await lancs();
  expect(ls).toHaveLength(1);
  expect(ls[0]).toMatchObject({ origem: "hospedagem", forma_pagamento: "pix", valor: 5000, tipo: "recebimento" });
  let ms = await movs();
  expect(ms).toHaveLength(1);
  expect(ms[0]).toMatchObject({ tipo: "credito", valor: 5000, conta_id: caixa.id });
  expect(await saldo()).toBe(5000);

  // Fase 2: checkout dividido (dinheiro + pix)
  const evDinheiro = pag("p-din", "dinheiro", 10000);
  const evPix = pag("p-pix", "pix", 7000);
  await processarPagamentoRegistrado(ctx, evDinheiro);
  await processarPagamentoRegistrado(ctx, evPix);
  ls = await lancs();
  expect(ls).toHaveLength(3);
  ms = await movs();
  expect(ms).toHaveLength(3);
  expect(ms.every((m) => m.tipo === "credito" && m.conta_id === caixa.id)).toBe(true);
  expect(await saldo()).toBe(22000);

  // Fase 3: faturado a terceiro
  await ctx.db.insertInto("valores_a_receber").values({
    id: "v1", conta_id: "c1", reserva_id: "r1", responsavel_nome: "Empresa X Ltda", responsavel_documento: "11222333000181",
    valor: 90000, criado_em: CRIADO, situacao: "aberto",
  }).execute();
  const evFat = { payload: { valorAReceberId: "v1", contaId: "c1", reservaId: "r1", valor: 90000 } };
  await processarValorAReceberCriado(ctx, evFat);
  const fats = await ctx.db.selectFrom("fin_faturamento").selectAll().execute();
  expect(fats).toHaveLength(1);
  expect(fats[0]!.numero_documento).toMatch(/^FAT-\d{4}-\d+$/);
  const recs = await ctx.db.selectFrom("fin_conta_receber").selectAll().execute();
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ status: "pendente", valor_original: 90000, numero_documento: fats[0]!.numero_documento });
  expect(new Date(recs[0]!.data_vencimento).getTime() - new Date(CRIADO).getTime()).toBe(30 * 86400000);
  const rel = await app.inject({ method: "GET", url: `/api/financeiro/relatorios/contas-receber?local_id=${local.id}`, headers: admin });
  expect(rel.statusCode).toBe(200);
  const pos = rel.json();
  expect(pos.itens).toHaveLength(1);
  expect(pos.itens[0]).toMatchObject({ numero_documento: fats[0]!.numero_documento, valor_pendente: 90000, situacao: "aberto" });
  expect(pos.situacoes.aberto.valor_pendente).toBe(90000);

  // Fase 4: idempotência (reprocessa os mesmos eventos)
  for (const ev of [sinal, evDinheiro, evPix]) await processarPagamentoRegistrado(ctx, ev);
  await processarValorAReceberCriado(ctx, evFat);
  expect(await lancs()).toHaveLength(3);
  expect(await movs()).toHaveLength(3);
  expect(await ctx.db.selectFrom("fin_faturamento").selectAll().execute()).toHaveLength(1);
  expect(await ctx.db.selectFrom("fin_conta_receber").selectAll().execute()).toHaveLength(1);
  expect(await saldo()).toBe(22000);
});
