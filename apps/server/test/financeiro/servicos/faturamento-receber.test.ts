import { expect, test } from "vitest";
import { ContasReceberService } from "../../../src/financeiro/servicos/contas-receber.js";
import { FaturamentoService } from "../../../src/financeiro/servicos/faturamento.js";
import { LocalService } from "../../../src/financeiro/servicos/locais.js";
import { Dinheiro } from "../../../src/shared/dinheiro.js";
import { gerarUUID, type UUID } from "../../../src/shared/ids.js";
import { criarContextoTeste } from "../../ajuda.js";

const usuario = { id: "u1", email: "admin@pousada.com", dispositivo: "web" };

async function preparar() {
  const ctx = await criarContextoTeste();
  const local = await new LocalService(ctx).criar(gerarUUID(), "Pousada", usuario);
  const cliente_id = gerarUUID();
  await ctx.db
    .insertInto("fin_cliente")
    .values({ id: cliente_id, local_id: local.id, nome: "Cliente", cpf_cnpj: null, tipo: "pessoa_fisica", contato: null, criado_em: "2026-11-01T00:00:00Z" })
    .execute();
  const conta = await ctx.db.selectFrom("fin_conta_bancaria").select("id").where("local_id", "=", local.id).executeTakeFirstOrThrow();
  return { ctx, local, cliente_id, conta_id: conta.id as UUID, fat: new FaturamentoService(ctx), rec: new ContasReceberService(ctx) };
}

async function recebivel(p: Awaited<ReturnType<typeof preparar>>, valor = 10000) {
  const f = await p.fat.criarParaCheckout(gerarUUID(), p.cliente_id, p.local.id, Dinheiro.de(valor), usuario);
  const g = await p.fat.gerarCobranca(f.id, "pix", usuario);
  const r = await p.rec.criarRecebivel(f.id, p.cliente_id, p.local.id, g.numero_documento, Dinheiro.de(valor), g.data_vencimento, usuario);
  return { f, g, r };
}

test("criarParaCheckout: cria faturamento aberto com auditoria", async () => {
  const p = await preparar();
  const f = await p.fat.criarParaCheckout(gerarUUID(), p.cliente_id, p.local.id, Dinheiro.de(25000), usuario);
  expect(f.status).toBe("aberto");
  expect(f.valor_original.centavos).toBe(25000);
  expect(f.valor_liquido.centavos).toBe(25000);
  expect(f.numero_documento).toBe("");
  expect(await p.fat.obter(f.id)).toEqual(f);
  const aud = await p.ctx.db.selectFrom("auditoria").selectAll().where("acao", "=", "fin_faturamento.criar").execute();
  expect(aud.length).toBe(1);
});

test("criarParaCheckout: valida valor, local, cliente e checkout duplicado", async () => {
  const p = await preparar();
  const co = gerarUUID();
  await expect(p.fat.criarParaCheckout(co, p.cliente_id, p.local.id, Dinheiro.zero(), usuario)).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  await expect(p.fat.criarParaCheckout(co, p.cliente_id, gerarUUID(), Dinheiro.de(100), usuario)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
  await expect(p.fat.criarParaCheckout(co, gerarUUID(), p.local.id, Dinheiro.de(100), usuario)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
  await p.fat.criarParaCheckout(co, p.cliente_id, p.local.id, Dinheiro.de(100), usuario);
  await expect(p.fat.criarParaCheckout(co, p.cliente_id, p.local.id, Dinheiro.de(100), usuario)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
});

test("gerarCobranca: gera numero_documento sequencial e grava forma", async () => {
  const p = await preparar();
  const a = await p.fat.criarParaCheckout(gerarUUID(), p.cliente_id, p.local.id, Dinheiro.de(100), usuario);
  const b = await p.fat.criarParaCheckout(gerarUUID(), p.cliente_id, p.local.id, Dinheiro.de(100), usuario);
  const ga = await p.fat.gerarCobranca(a.id, "boleto", usuario);
  const gb = await p.fat.gerarCobranca(b.id, "pix", usuario);
  expect(ga.numero_documento).toBe("FAT-2026-000001");
  expect(gb.numero_documento).toBe("FAT-2026-000002");
  expect(ga.forma_cobranca).toBe("boleto");
  expect(gb.forma_cobranca).toBe("pix");
});

test("gerarCobranca: não repete, rejeita forma inválida e inexistente", async () => {
  const p = await preparar();
  const a = await p.fat.criarParaCheckout(gerarUUID(), p.cliente_id, p.local.id, Dinheiro.de(100), usuario);
  await p.fat.gerarCobranca(a.id, "pix", usuario);
  await expect(p.fat.gerarCobranca(a.id, "pix", usuario)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
  await expect(p.fat.gerarCobranca(a.id, "cartao" as any, usuario)).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  await expect(p.fat.gerarCobranca(gerarUUID(), "pix", usuario)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
});

test("criarRecebivel: cria pendente a partir do faturamento; valida documento e duplicidade", async () => {
  const p = await preparar();
  const { f, g, r } = await recebivel(p);
  expect(r.status).toBe("pendente");
  expect(r.valor_recebido.centavos).toBe(0);
  expect(r.valor_pendente!.centavos).toBe(10000);
  expect(r.forma_pagamento).toBe("pix");
  expect(r.numero_documento).toBe(g.numero_documento);
  await expect(
    p.rec.criarRecebivel(f.id, p.cliente_id, p.local.id, g.numero_documento, Dinheiro.de(10000), g.data_vencimento, usuario),
  ).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
  await expect(
    p.rec.criarRecebivel(f.id, p.cliente_id, p.local.id, "XXX", Dinheiro.de(10000), g.data_vencimento, usuario),
  ).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  await expect(
    p.rec.criarRecebivel(gerarUUID(), p.cliente_id, p.local.id, "X", Dinheiro.de(1), g.data_vencimento, usuario),
  ).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
});

test("confirmarPagamento: parcial depois total; atualiza saldo, lançamentos e faturamento", async () => {
  const p = await preparar();
  const { f, r } = await recebivel(p);
  await expect(p.rec.confirmarPagamento(r.id, Dinheiro.de(4000), p.conta_id, usuario)).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  const parcial = await p.rec.confirmarPagamento(r.id, Dinheiro.de(4000), p.conta_id, usuario, new Date("2026-12-30T12:00:00Z"));
  // a original fica quitada pela parte paga; o saldo vira uma nova parcela vinculada
  expect(parcial.status).toBe("recebido");
  expect(parcial.valor_recebido.centavos).toBe(4000);
  expect(parcial.valor_original.centavos).toBe(4000);
  expect((await p.fat.obter(f.id)).status).toBe("parcialmente_pago");
  const filha = (await p.ctx.db.selectFrom("fin_conta_receber").selectAll().where("parcela_de", "=", r.id).executeTakeFirstOrThrow()) as any;
  expect(filha.valor_original).toBe(6000);

  const total = await p.rec.confirmarPagamento(filha.id, Dinheiro.de(6000), p.conta_id, usuario);
  expect(total.status).toBe("recebido");
  expect(total.conta_destino_id).toBe(p.conta_id);
  const fat = await p.fat.obter(f.id);
  expect(fat.status).toBe("pago");
  expect(fat.lançamentos_id.length).toBe(2);

  const movs = await p.ctx.db.selectFrom("fin_movimento").selectAll().where("conta_id", "=", p.conta_id).execute();
  expect(movs.length).toBe(2);
  expect(movs.map((m: any) => m.saldo_posterior).sort((a: number, b: number) => a - b)).toEqual([4000, 10000]);
  const lanc = await p.ctx.db.selectFrom("fin_lancamento").selectAll().where("referencia_tipo", "=", "conta_receber").execute();
  expect(lanc.length).toBe(2);
  expect(lanc[0].tipo).toBe("recebimento");
});

test("confirmarPagamento: rejeita excesso, valor inválido, conta inexistente e recebível quitado", async () => {
  const p = await preparar();
  const { r } = await recebivel(p);
  await expect(p.rec.confirmarPagamento(r.id, Dinheiro.de(10001), p.conta_id, usuario)).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  await expect(p.rec.confirmarPagamento(r.id, Dinheiro.zero(), p.conta_id, usuario)).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  await expect(p.rec.confirmarPagamento(r.id, Dinheiro.de(100), gerarUUID(), usuario)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
  await expect(p.rec.confirmarPagamento(gerarUUID(), Dinheiro.de(100), p.conta_id, usuario)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
  await p.rec.confirmarPagamento(r.id, Dinheiro.de(10000), p.conta_id, usuario);
  await expect(p.rec.confirmarPagamento(r.id, Dinheiro.de(1), p.conta_id, usuario)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
  expect((await p.rec.obter(r.id)).valor_recebido.centavos).toBe(10000);
});
