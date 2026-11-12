import { describe, expect, test } from "vitest";
import { criarApp } from "../../../src/http/app.js";
import { FaturamentoService } from "../../../src/financeiro/servicos/faturamento.js";
import { LançamentoService } from "../../../src/financeiro/servicos/lançamentos.js";
import { LocalService } from "../../../src/financeiro/servicos/locais.js";
import { ContasReceberService } from "../../../src/financeiro/servicos/contas-receber.js";
import { Dinheiro } from "../../../src/shared/dinheiro.js";
import { gerarUUID, type UUID } from "../../../src/shared/ids.js";
import { criarContextoTeste, entrarComo } from "../../ajuda.js";

const usuario = { id: "u1", email: "admin@pousada.com", dispositivo: "web" };
const supervisor = { login: "admin", senha: "admin" };

async function cenario() {
  const ctx = await criarContextoTeste();
  const app = criarApp(ctx);
  const admin = await entrarComo(ctx, "admin");
  const local = await new LocalService(ctx).criar(gerarUUID(), "Pousada", usuario);
  const cliente_id = gerarUUID();
  await ctx.db
    .insertInto("fin_cliente")
    .values({ id: cliente_id, local_id: local.id, nome: "Cliente", cpf_cnpj: null, tipo: "pessoa_fisica", contato: null, criado_em: "2026-11-01T00:00:00Z" })
    .execute();
  const caixa = await ctx.db.selectFrom("fin_conta_bancaria").select("id").where("local_id", "=", local.id).executeTakeFirstOrThrow();
  return { ctx, app, admin, local, cliente_id, caixa_id: caixa.id as UUID };
}

async function novoLancamento(ctx: Awaited<ReturnType<typeof cenario>>["ctx"], local_id: UUID, data = new Date("2026-11-05T12:00:00Z")) {
  return new LançamentoService(ctx).criar({
    local_id, data, tipo: "recebimento", origem: "manual", valor: Dinheiro.de(5000), forma_pagamento: "pix", usuario,
  });
}

describe("rotas do Financeiro", () => {
  test("exige autenticação e permissão financeira", async () => {
    const { ctx, app, local } = await cenario();
    const url = `/api/financeiro/lancamentos?local_id=${local.id}`;
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    const gov = await entrarComo(ctx, "governanca");
    expect((await app.inject({ method: "GET", url, headers: gov })).statusCode).toBe(403);
  });

  test("recepção (sem financeiro.gerenciar) recebe 403 e admin 200", async () => {
    const { ctx, app, admin, local } = await cenario();
    const url = `/api/financeiro/lancamentos?local_id=${local.id}`;
    const rec = await entrarComo(ctx, "recepcao");
    expect((await app.inject({ method: "GET", url, headers: rec })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url, headers: admin })).statusCode).toBe(200);
  });

  test("GET lançamentos lista por local e período", async () => {
    const { ctx, app, admin, local } = await cenario();
    await novoLancamento(ctx, local.id);
    const base = `/api/financeiro/lancamentos?local_id=${local.id}`;
    const dentro = await app.inject({ method: "GET", url: `${base}&data_inicio=2026-11-05&data_fim=2026-11-05`, headers: admin });
    expect(dentro.statusCode).toBe(200);
    expect(dentro.json()).toHaveLength(1);
    expect(dentro.json()[0].valor).toBe(5000);
    const fora = await app.inject({ method: "GET", url: `${base}&data_inicio=2026-11-06`, headers: admin });
    expect(fora.json()).toHaveLength(0);
    const ruim = await app.inject({ method: "GET", url: "/api/financeiro/lancamentos", headers: admin });
    expect(ruim.statusCode).toBe(400);
  });

  test("DELETE lançamento cancela com supervisor e recusa sem autorização", async () => {
    const { ctx, app, admin, local } = await cenario();
    const l = await novoLancamento(ctx, local.id);
    const url = `/api/financeiro/lancamentos/${l.id}`;
    const sem = await app.inject({ method: "DELETE", url, headers: admin, payload: { motivo: "erro" } });
    expect(sem.statusCode).toBe(422);
    expect(sem.json().codigo).toBe("SUPERVISOR_NECESSARIO");
    const senhaErrada = await app.inject({ method: "DELETE", url, headers: admin, payload: { motivo: "erro", supervisor: { login: "admin", senha: "x" } } });
    expect(senhaErrada.statusCode).toBe(422);
    const ok = await app.inject({ method: "DELETE", url, headers: admin, payload: { motivo: "lançado em duplicidade", supervisor } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("cancelado");
    const deNovo = await app.inject({ method: "DELETE", url, headers: admin, payload: { motivo: "x", supervisor } });
    expect(deNovo.json().codigo).toBe("ESTADO_INVALIDO");
  });

  test("DELETE com credencial de quem não é supervisor é recusado (403)", async () => {
    const { ctx, app, local } = await cenario();
    const l = await novoLancamento(ctx, local.id);
    const rec = await entrarComo(ctx, "recepcao");
    const r = await app.inject({
      method: "DELETE", url: `/api/financeiro/lancamentos/${l.id}`, headers: rec,
      payload: { motivo: "x", supervisor: { login: "teste-recepcao", senha: "senha-teste" } },
    });
    expect(r.statusCode).toBe(403);
  });

  test("não existe rota que gere só a cobrança: a fatura só fecha por /faturamentos/:id/fechar (nada fica sem Conta a Receber)", async () => {
    const { ctx, app, admin, local, cliente_id } = await cenario();
    const f = await new FaturamentoService(ctx).criarParaCheckout(gerarUUID(), cliente_id, local.id, Dinheiro.de(20000), usuario);
    const velha = await app.inject({ method: "POST", url: "/api/financeiro/faturamento/gerar-cobranca", headers: admin, payload: { faturamento_id: f.id, forma: "pix" } });
    expect(velha.statusCode).toBe(404);
    expect((await ctx.db.selectFrom("fin_faturamento").select("numero_documento").executeTakeFirstOrThrow()).numero_documento).toBeNull();
    const ok = await app.inject({ method: "POST", url: `/api/financeiro/faturamentos/${f.id}/fechar`, headers: admin, payload: { forma: "pix", data_vencimento: "2026-12-10" } });
    expect(ok.statusCode).toBe(200);
    expect(await ctx.db.selectFrom("fin_conta_receber").selectAll().execute()).toHaveLength(1);
  });

  test("PUT confirmar-pagamento recebe, movimenta conta e recusa excesso", async () => {
    const { ctx, app, admin, local, cliente_id, caixa_id } = await cenario();
    const fat = new FaturamentoService(ctx);
    const f = await fat.criarParaCheckout(gerarUUID(), cliente_id, local.id, Dinheiro.de(10000), usuario);
    const g = await fat.gerarCobranca(f.id, "pix", usuario);
    const r = await new ContasReceberService(ctx).criarRecebivel(f.id, cliente_id, local.id, g.numero_documento, Dinheiro.de(10000), g.data_vencimento, usuario);
    const url = `/api/financeiro/contas-receber/${r.id}/confirmar-pagamento`;
    const semData = await app.inject({ method: "PUT", url, headers: admin, payload: { valor: 4000, conta_bancaria_id: caixa_id } });
    expect(semData.statusCode).toBe(422);
    const parcial = await app.inject({ method: "PUT", url, headers: admin, payload: { valor: 4000, conta_bancaria_id: caixa_id, novo_vencimento: "2026-12-30" } });
    expect(parcial.statusCode).toBe(200);
    expect(parcial.json()).toMatchObject({ status: "recebido", valor_recebido: 4000, valor_original: 4000 });
    const excesso = await app.inject({ method: "PUT", url, headers: admin, payload: { valor: 7000, conta_bancaria_id: caixa_id } });
    expect(excesso.statusCode).toBe(422); // a original já está quitada; o saldo é outra parcela
    const invalido = await app.inject({ method: "PUT", url, headers: admin, payload: { valor: -1, conta_bancaria_id: caixa_id } });
    expect(invalido.statusCode).toBe(400);
    const saldo = await app.inject({ method: "GET", url: `/api/financeiro/caixa-banco/saldo?conta_id=${caixa_id}`, headers: admin });
    expect(saldo.json().saldo).toBe(4000);
  });

  test("POST transferencia move saldo entre contas; mesma conta é recusada", async () => {
    const { ctx, app, admin, local, caixa_id } = await cenario();
    const banco_id = gerarUUID();
    await ctx.db
      .insertInto("fin_conta_bancaria")
      .values({ id: banco_id, local_id: local.id, nome: "Banco", banco: "B", agencia: "1", numero: "2", tipo: "corrente", saldo_inicial: 50000, criado_em: "2026-11-01T00:00:00Z" })
      .execute();
    const url = "/api/financeiro/caixa-banco/transferencia";
    const ok = await app.inject({ method: "POST", url, headers: admin, payload: { origem: banco_id, destino: caixa_id, valor: 12000 } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().mov_origem.saldo_posterior).toBe(38000);
    const saldo = async (id: string) =>
      (await app.inject({ method: "GET", url: `/api/financeiro/caixa-banco/saldo?conta_id=${id}&data=2026-12-31`, headers: admin })).json().saldo;
    expect(await saldo(banco_id)).toBe(38000);
    expect(await saldo(caixa_id)).toBe(12000);
    const igual = await app.inject({ method: "POST", url, headers: admin, payload: { origem: banco_id, destino: banco_id, valor: 100 } });
    expect(igual.statusCode).toBe(422);
    const inexistente = await app.inject({ method: "GET", url: `/api/financeiro/caixa-banco/saldo?conta_id=${gerarUUID()}`, headers: admin });
    expect(inexistente.json().codigo).toBe("NAO_ENCONTRADO");
  });
});
