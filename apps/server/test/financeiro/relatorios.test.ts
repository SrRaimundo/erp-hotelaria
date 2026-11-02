import { expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { CaixaBancoService } from "../../src/financeiro/servicos/caixa-banco.js";
import { LançamentoService } from "../../src/financeiro/servicos/lançamentos.js";
import { LocalService } from "../../src/financeiro/servicos/locais.js";
import { Dinheiro } from "../../src/shared/dinheiro.js";
import { gerarUUID } from "../../src/shared/ids.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

const usuario = { id: "u1", email: "admin@pousada.com", dispositivo: "web" };

async function preparar() {
  const ctx = await criarContextoTeste();
  const local = await new LocalService(ctx).criar(gerarUUID(), "Pousada", usuario);
  const conta = (await ctx.db.selectFrom("fin_conta_bancaria").select("id").where("local_id", "=", local.id).executeTakeFirstOrThrow()).id;
  await ctx.db.updateTable("fin_conta_bancaria").set({ saldo_inicial: 100000 }).where("id", "=", conta).execute();
  const lancs = new LançamentoService(ctx);
  const caixa = new CaixaBancoService(ctx);
  const mov = async (tipo: "recebimento" | "pagamento", c: number, data: string, forma: "pix" | "credito" = "pix") =>
    caixa.criarMovimento(
      await lancs.criar({ local_id: local.id, data: new Date(data), tipo, origem: "manual", valor: Dinheiro.de(c), forma_pagamento: forma, usuario }),
      conta,
      usuario,
    );
  await mov("recebimento", 50000, "2026-11-04T12:00:00Z");
  await mov("recebimento", 20000, "2026-11-05T12:00:00Z");
  await mov("pagamento", 5000, "2026-11-05T15:00:00Z");
  const app = criarApp(ctx);
  const h = await entrarComo(ctx, "admin");
  return { ctx, local, conta, app, h };
}

test("fluxo de caixa diário e movimento por conta", async () => {
  const { app, h, local, conta } = await preparar();
  const f = await app.inject({ method: "GET", url: `/api/financeiro/relatorios/fluxo-caixa?local_id=${local.id}&data=2026-11-05`, headers: h });
  expect(f.statusCode).toBe(200);
  expect(f.json()).toMatchObject({ saldo_inicial: 150000, entradas: 20000, saidas: 5000, saldo_final: 165000 });
  const m = (await app.inject({ method: "GET", url: `/api/financeiro/relatorios/movimento?conta_id=${conta}&data_inicio=2026-11-05&data_fim=2026-11-05`, headers: h })).json();
  expect(m).toMatchObject({ saldo_inicial: 150000, total_creditos: 20000, total_debitos: 5000, saldo_final: 165000 });
  expect(m.movimentos.map((x: any) => x.saldo_posterior)).toEqual([170000, 165000]);
});

test("consolidado por local", async () => {
  const { app, h, local } = await preparar();
  const r = (await app.inject({ method: "GET", url: "/api/financeiro/relatorios/consolidado?data_inicio=2026-11-05&data_fim=2026-11-30", headers: h })).json();
  expect(r.locais.find((l: any) => l.local_id === local.id)).toMatchObject({ saldo_inicial: 150000, recebimentos: 20000, pagamentos: 5000, saldo_final: 165000 });
  expect(r.total.saldo_final).toBe(165000);
});

test("contas a receber e cartão", async () => {
  const { ctx, app, h, local } = await preparar();
  const cli = gerarUUID();
  await ctx.db.insertInto("fin_cliente").values({ id: cli, local_id: local.id, nome: "C", tipo: "pf", criado_em: "2026-11-01T00:00:00Z" }).execute();
  const cr = (numero: string, venc: string, rec: number, status: string) =>
    ctx.db.insertInto("fin_conta_receber").values({
      id: gerarUUID(), local_id: local.id, cliente_id: cli, numero_documento: numero, valor_original: 10000, valor_recebido: rec,
      data_vencimento: venc, forma_pagamento: "pix", status, criado_em: "2026-11-01T00:00:00Z",
    } as any).execute();
  await cr("1", "2026-12-01", 0, "pendente");
  await cr("2", "2026-10-01", 0, "pendente");
  await cr("3", "2026-12-01", 4000, "parcialmente_recebido");
  await cr("4", "2026-12-01", 10000, "recebido");
  await cr("5", "2026-12-01", 0, "cancelado");
  const r = (await app.inject({ method: "GET", url: `/api/financeiro/relatorios/contas-receber?local_id=${local.id}`, headers: h })).json();
  expect(r.situacoes.aberto.quantidade).toBe(1);
  expect(r.situacoes.vencido).toMatchObject({ quantidade: 1, valor_pendente: 10000 });
  expect(r.situacoes.parcialmente_recebido).toMatchObject({ quantidade: 1, valor_pendente: 6000 });
  expect(r.situacoes.recebido).toMatchObject({ quantidade: 1, valor_pendente: 0 });
  expect(r.itens).toHaveLength(4);

  const lancs = new LançamentoService(ctx);
  await lancs.criar({ local_id: local.id, data: new Date("2026-11-05T12:00:00Z"), tipo: "recebimento", origem: "manual", valor: Dinheiro.de(30000), forma_pagamento: "credito", usuario });
  const c = (await app.inject({ method: "GET", url: `/api/financeiro/relatorios/cartao?local_id=${local.id}`, headers: h })).json();
  expect(c.aberto.quantidade + c.fechado.quantidade + c.liquidado.quantidade).toBe(1);
  expect(c.aberto.valor + c.fechado.valor + c.liquidado.valor).toBe(30000);
});

test("validação, 401 e 404", async () => {
  const { app, h } = await preparar();
  expect((await app.inject({ method: "GET", url: "/api/financeiro/relatorios/cartao?local_id=x" })).statusCode).toBe(401);
  expect((await app.inject({ method: "GET", url: "/api/financeiro/relatorios/consolidado?data_inicio=ontem&data_fim=2026-11-30", headers: h })).statusCode).toBe(422);
  expect((await app.inject({ method: "GET", url: "/api/financeiro/relatorios/movimento?conta_id=nao&data_inicio=2026-11-01&data_fim=2026-11-02", headers: h })).statusCode).toBe(422);
});
