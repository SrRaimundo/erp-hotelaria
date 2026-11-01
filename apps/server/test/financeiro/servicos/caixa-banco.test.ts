import { expect, test } from "vitest";
import { CaixaBancoService } from "../../../src/financeiro/servicos/caixa-banco.js";
import { LançamentoService } from "../../../src/financeiro/servicos/lançamentos.js";
import { LocalService } from "../../../src/financeiro/servicos/locais.js";
import { Dinheiro } from "../../../src/shared/dinheiro.js";
import { gerarUUID, type UUID } from "../../../src/shared/ids.js";
import { criarContextoTeste } from "../../ajuda.js";

const usuario = { id: "u1", email: "admin@pousada.com", dispositivo: "web" };

async function preparar(saldo_inicial = 1000000) {
  const ctx = await criarContextoTeste();
  const local = await new LocalService(ctx).criar(gerarUUID(), "Pousada", usuario);
  const caixa_conta = await ctx.db.selectFrom("fin_conta_bancaria").select("id").where("local_id", "=", local.id).executeTakeFirstOrThrow();
  await ctx.db.updateTable("fin_conta_bancaria").set({ saldo_inicial }).where("id", "=", caixa_conta.id).execute();
  const banco_id: UUID = gerarUUID();
  await ctx.db
    .insertInto("fin_conta_bancaria")
    .values({ id: banco_id, local_id: local.id, nome: "Banco", banco: "X", agencia: "1", numero: "99", tipo: "corrente", saldo_inicial: 500000, criado_em: "2026-11-01T00:00:00.000Z" })
    .execute();
  const lancs = new LançamentoService(ctx);
  const criarLanc = (tipo: "recebimento" | "pagamento", centavos: number, data = "2026-11-05T12:00:00Z") =>
    lancs.criar({ local_id: local.id, data: new Date(data), tipo, origem: "manual", valor: Dinheiro.de(centavos), forma_pagamento: "pix", usuario });
  return { ctx, local, conta: caixa_conta.id as UUID, banco_id, caixa: new CaixaBancoService(ctx), criarLanc };
}

test("criarMovimento: recebimento gera credito com saldo anterior/posterior", async () => {
  const { caixa, conta, criarLanc } = await preparar();
  const mov = await caixa.criarMovimento(await criarLanc("recebimento", 50000), conta, usuario);
  expect(mov.tipo).toBe("credito");
  expect(mov.saldo_anterior.centavos).toBe(1000000);
  expect(mov.saldo_posterior.centavos).toBe(1050000);
});

test("criarMovimento: pagamento gera debito e encadeia saldos", async () => {
  const { caixa, conta, criarLanc } = await preparar();
  await caixa.criarMovimento(await criarLanc("recebimento", 50000), conta, usuario);
  const mov = await caixa.criarMovimento(await criarLanc("pagamento", 20000), conta, usuario);
  expect(mov.tipo).toBe("debito");
  expect(mov.saldo_anterior.centavos).toBe(1050000);
  expect(mov.saldo_posterior.centavos).toBe(1030000);
});

test("criarMovimento: conta inexistente, lançamento cancelado e ajuste falham", async () => {
  const { caixa, conta, criarLanc, ctx } = await preparar();
  const l = await criarLanc("recebimento", 100);
  await expect(caixa.criarMovimento(l, gerarUUID(), usuario)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
  await expect(caixa.criarMovimento({ ...l, status: "cancelado" }, conta, usuario)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
  await expect(caixa.criarMovimento({ ...l, tipo: "ajuste" }, conta, usuario)).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  expect((await ctx.db.selectFrom("fin_movimento").select("id").execute()).length).toBe(0);
});

test("obterSaldo: derivado de saldo_inicial + movimentos até a data", async () => {
  const { caixa, conta, criarLanc } = await preparar();
  await caixa.criarMovimento(await criarLanc("recebimento", 50000, "2026-11-05T12:00:00Z"), conta, usuario);
  await caixa.criarMovimento(await criarLanc("pagamento", 20000, "2026-11-10T12:00:00Z"), conta, usuario);
  expect((await caixa.obterSaldo(conta, new Date("2026-11-01T00:00:00Z"))).centavos).toBe(1000000);
  expect((await caixa.obterSaldo(conta, new Date("2026-11-06T00:00:00Z"))).centavos).toBe(1050000);
  expect((await caixa.obterSaldo(conta, new Date("2026-11-30T00:00:00Z"))).centavos).toBe(1030000);
  await expect(caixa.obterSaldo(gerarUUID(), new Date())).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
});

test("listarMovimentos: filtra por período e ordena por data", async () => {
  const { caixa, conta, criarLanc } = await preparar();
  await caixa.criarMovimento(await criarLanc("pagamento", 20000, "2026-11-10T12:00:00Z"), conta, usuario);
  await caixa.criarMovimento(await criarLanc("recebimento", 50000, "2026-11-05T12:00:00Z"), conta, usuario);
  await caixa.criarMovimento(await criarLanc("recebimento", 1000, "2026-12-05T12:00:00Z"), conta, usuario);
  const movs = await caixa.listarMovimentos(conta, new Date("2026-11-01T00:00:00Z"), new Date("2026-11-30T00:00:00Z"));
  expect(movs.map((m) => m.valor.centavos)).toEqual([50000, 20000]);
});

test("transferir: cria débito e crédito ligados ao mesmo lançamento", async () => {
  const { caixa, conta, banco_id, ctx } = await preparar();
  const r = await caixa.transferir(conta, banco_id, Dinheiro.de(30000), usuario);
  expect(r.mov_origem.tipo).toBe("transferencia_out");
  expect(r.mov_destino.tipo).toBe("transferencia_in");
  expect(r.mov_origem.saldo_posterior.centavos).toBe(970000);
  expect(r.mov_destino.saldo_posterior.centavos).toBe(530000);
  expect(r.mov_origem.lancamento_id).toBe(r.mov_destino.lancamento_id);
  const agora = new Date("2099-01-01T00:00:00Z");
  expect((await caixa.obterSaldo(conta, agora)).centavos).toBe(970000);
  expect((await caixa.obterSaldo(banco_id, agora)).centavos).toBe(530000);
  const aud = await ctx.db.selectFrom("auditoria").selectAll().where("acao", "=", "fin_movimento.transferir").execute();
  expect(aud.length).toBe(1);
});

test("transferir: validações (mesma conta, valor, conta inexistente, outro local)", async () => {
  const { caixa, conta, banco_id, ctx } = await preparar();
  await expect(caixa.transferir(conta, conta, Dinheiro.de(100), usuario)).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  await expect(caixa.transferir(conta, banco_id, Dinheiro.zero(), usuario)).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  await expect(caixa.transferir(conta, gerarUUID(), Dinheiro.de(100), usuario)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
  const outro = await new LocalService(ctx).criar(gerarUUID(), "Outra", usuario);
  const contaOutro = await ctx.db.selectFrom("fin_conta_bancaria").select("id").where("local_id", "=", outro.id).executeTakeFirstOrThrow();
  await expect(caixa.transferir(conta, contaOutro.id as UUID, Dinheiro.de(100), usuario)).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  expect((await ctx.db.selectFrom("fin_movimento").select("id").execute()).length).toBe(0);
});
