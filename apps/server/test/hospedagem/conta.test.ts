import { beforeEach, describe, expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { alterarReserva, cancelarReserva } from "../../src/hospedagem/alteracao.js";
import { estornarLancamento, estornarPagamento, extrato, lancar, pagoNaReserva, registrarPagamento, saldo } from "../../src/hospedagem/conta.js";
import { criarReserva, obterReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { alertasAbertos } from "../../src/infra/alertas.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { abrirCaixa, fecharCaixa } from "../../src/nucleo/caixa.js";
import { ativarForma } from "../../src/nucleo/formas-pagamento.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { criarUsuario } from "../../src/nucleo/usuarios.js";
import { criarQuarto } from "../../src/nucleo/quartos.js";
import { criarProduto } from "../../src/nucleo/produtos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let recepcao: UsuarioSessao;
let dados: NovaReserva;
const admin = { login: "admin", senha: "admin" };
const aut = { motivo: "Lançado por engano", supervisor: admin };

beforeEach(async () => {
  ctx = await criarContextoTeste();
  const std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  await criarQuarto(ctx, { numero: "12", categoriaId: std }, "u1");
  await ctx.db.insertInto("hospedes").values({
    id: "h1", nome: "Titular", nome_busca: "titular", documento_tipo: "cpf", documento: "1", nacionalidade: "BR",
  }).execute();
  await entrarComo(ctx, "recepcao");
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "teste-recepcao").executeTakeFirstOrThrow();
  recepcao = (await carregarUsuarioSessao(ctx, l.id))!;
  dados = { titularId: "h1", categoriaId: std, chegada: "2026-11-20", saida: "2026-11-23", adultos: 2, criancasNascimento: [], canal: "Balcão" };
});

const extra = (contaId: string, valorUnitario = 5000, quantidade = 1) =>
  lancar(ctx, { contaId, tipo: "extra", origem: "hospedagem", descricao: "Lavanderia", quantidade, valorUnitario }, recepcao.id);

describe("conta do hóspede", () => {
  test("pagamento do sinal confirma a pré-reserva", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await abrirCaixa(ctx, recepcao.id, 0);
    await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 27000 }, recepcao);
    const d = await obterReserva(ctx, r.id);
    expect(d.estado).toBe("confirmada");
    expect(d.pago).toBe(27000);
    const ev = await ctx.db.selectFrom("outbox").select("tipo").where("tipo", "in", ["hospedagem.ReservaConfirmada", "hospedagem.PagamentoRegistrado"]).execute();
    expect(ev.map((e) => e.tipo).sort()).toEqual(["hospedagem.PagamentoRegistrado", "hospedagem.ReservaConfirmada"]);
    const aud = await ctx.db.selectFrom("auditoria").select("acao").where("alvo_id", "=", r.id).execute();
    expect(aud.map((a) => a.acao)).toContain("reserva.confirmar");
    const mov = await ctx.db.selectFrom("movimentos_caixa").select(["forma_codigo", "valor"]).execute();
    expect(mov).toEqual([{ forma_codigo: "pix", valor: 27000 }]);
  });

  test("alteração que reduz o sinal abaixo do já pago confirma a pré-reserva", async () => {
    const r = await criarReserva(ctx, dados, recepcao); // sinal 27000
    await abrirCaixa(ctx, recepcao.id, 0);
    await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 20000 }, recepcao);
    expect((await obterReserva(ctx, r.id)).estado).toBe("pre_reserva");
    const alterada = await alterarReserva(ctx, r.id, { saida: "2026-11-22" }, recepcao); // 60000 → sinal 18000
    expect(alterada).toMatchObject({ estado: "confirmada", valorSinal: 18000 });
    const aud = await ctx.db.selectFrom("auditoria").select("acao").where("alvo_id", "=", r.id).execute();
    expect(aud.map((a) => a.acao)).toContain("reserva.confirmar");
    expect(await ctx.db.selectFrom("outbox").select("tipo").where("tipo", "=", "hospedagem.ReservaConfirmada").execute()).toHaveLength(1);
  });

  test("pagamento parcial não confirma; o complemento confirma", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await abrirCaixa(ctx, recepcao.id, 0);
    await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 10000 }, recepcao);
    expect((await obterReserva(ctx, r.id)).estado).toBe("pre_reserva");
    expect(await pagoNaReserva(ctx, r.id)).toBe(10000);
    await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "dinheiro", valor: 17000 }, recepcao);
    expect((await obterReserva(ctx, r.id)).estado).toBe("confirmada");
  });

  test("estorno gera lançamento negativo e não apaga o original", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    const id = await extra(r.contaId);
    expect(await saldo(ctx, r.contaId)).toEqual({ debitos: 5000, creditos: 0, saldo: 5000 });
    await expect(estornarLancamento(ctx, id, recepcao, undefined)).rejects.toMatchObject({ codigo: "SUPERVISOR_NECESSARIO" });
    await estornarLancamento(ctx, id, recepcao, aut);
    expect(await saldo(ctx, r.contaId)).toEqual({ debitos: 0, creditos: 0, saldo: 0 });
    const ex = await extrato(ctx, r.contaId);
    expect(ex).toHaveLength(2);
    expect(ex.map((l) => l.valor).sort((a, b) => a - b)).toEqual([-5000, 5000]);
    await expect(estornarLancamento(ctx, id, recepcao, aut)).rejects.toMatchObject({ codigo: "JA_ESTORNADO" });
    const estorno = ex.find((l) => l.valor < 0)!;
    await expect(estornarLancamento(ctx, estorno.id, recepcao, aut)).rejects.toMatchObject({ codigo: "ESTORNO_INVALIDO" });
    const ev = await ctx.db.selectFrom("outbox").select("tipo").where("tipo", "like", "hospedagem.Lancamento%").execute();
    expect(ev.map((e) => e.tipo).sort()).toEqual(["hospedagem.LancamentoCriado", "hospedagem.LancamentoEstornado"]);
  });

  test("lançamento calcula quantidade × valor unitário e valida", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await extra(r.contaId, 1200, 3);
    expect((await saldo(ctx, r.contaId)).saldo).toBe(3600);
    await expect(extra(r.contaId, 1200, 0)).rejects.toMatchObject({ codigo: "QUANTIDADE_INVALIDA" });
    await expect(extra(r.contaId, 12.5)).rejects.toMatchObject({ codigo: "VALOR_INVALIDO" });
  });

  test("estorno de pagamento usa o caixa de quem estorna e reduz o pago", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    const t1 = await abrirCaixa(ctx, recepcao.id, 0);
    const pid = await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 27000 }, recepcao);
    const outroId = await criarUsuario(ctx, { nome: "Outra", login: "outra", senha: "senha-teste", perfil: "recepcao" }, "admin");
    const outro = (await carregarUsuarioSessao(ctx, typeof outroId === "string" ? outroId : (outroId as any).id))!;
    const t2 = await abrirCaixa(ctx, outro.id, 0);
    await estornarPagamento(ctx, pid, outro, aut);
    expect(await pagoNaReserva(ctx, r.id)).toBe(0);
    expect(await saldo(ctx, r.contaId)).toEqual({ debitos: 0, creditos: 0, saldo: 0 });
    const mov = await ctx.db.selectFrom("movimentos_caixa").select(["valor", "turno_id"]).orderBy("valor").execute();
    expect(mov).toEqual([{ valor: -27000, turno_id: t2.id }, { valor: 27000, turno_id: t1.id }]);
    await expect(estornarPagamento(ctx, pid, outro, aut)).rejects.toMatchObject({ codigo: "JA_ESTORNADO" });
  });

  test("estorno de pagamento em conta fechada é rejeitado", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await abrirCaixa(ctx, recepcao.id, 0);
    const pid = await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 27000 }, recepcao);
    await ctx.db.updateTable("contas").set({ situacao: "fechada" }).where("id", "=", r.contaId).execute();
    await expect(estornarPagamento(ctx, pid, recepcao, aut)).rejects.toMatchObject({ codigo: "CONTA_FECHADA" });
  });

  test("lançamento com valor unitário zero ou negativo é rejeitado", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await expect(extra(r.contaId, -5000)).rejects.toMatchObject({ codigo: "VALOR_INVALIDO" });
    await expect(extra(r.contaId, 0)).rejects.toMatchObject({ codigo: "VALOR_INVALIDO" });
    expect((await saldo(ctx, r.contaId)).saldo).toBe(0);
  });

  test("diária exige reserva e noite de referência", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    const base = { contaId: r.contaId, tipo: "diaria" as const, origem: "hospedagem", descricao: "Diária", quantidade: 1, valorUnitario: 30000 };
    await expect(lancar(ctx, { ...base, dataRef: "2026-11-20" }, "Sistema")).rejects.toMatchObject({ codigo: "DIARIA_INVALIDA" });
    await expect(lancar(ctx, { ...base, reservaId: r.id }, "Sistema")).rejects.toMatchObject({ codigo: "DIARIA_INVALIDA" });
  });

  test("estorno de pagamento exige caixa aberto de quem estorna", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await abrirCaixa(ctx, recepcao.id, 0);
    const pid = await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 27000 }, recepcao);
    await fecharCaixa(ctx, recepcao.id, { dinheiro: 0, pix: 27000 });
    await expect(estornarPagamento(ctx, pid, recepcao, aut)).rejects.toMatchObject({ codigo: "CAIXA_FECHADO" });
  });

  test("pagamento sem caixa aberto é rejeitado", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await expect(
      registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 27000 }, recepcao),
    ).rejects.toMatchObject({ codigo: "CAIXA_FECHADO" });
    expect(await pagoNaReserva(ctx, r.id)).toBe(0);
  });

  test("valor inválido e forma inativa são rejeitados", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await abrirCaixa(ctx, recepcao.id, 0);
    await expect(
      registrarPagamento(ctx, { contaId: r.contaId, formaCodigo: "pix", valor: 0 }, recepcao),
    ).rejects.toMatchObject({ codigo: "VALOR_INVALIDO" });
    await ativarForma(ctx, "pix", false, "u1");
    await expect(
      registrarPagamento(ctx, { contaId: r.contaId, formaCodigo: "pix", valor: 100 }, recepcao),
    ).rejects.toMatchObject({ codigo: "FORMA_INATIVA" });
  });

  test("pagamento em reserva cancelada é aceito e gera alerta", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await cancelarReserva(ctx, r.id, recepcao, aut);
    await abrirCaixa(ctx, recepcao.id, 0);
    await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 27000 }, recepcao);
    expect(await pagoNaReserva(ctx, r.id)).toBe(27000);
    expect((await obterReserva(ctx, r.id)).estado).toBe("cancelada");
    const alertas = await alertasAbertos(ctx);
    expect(alertas.filter((a) => a.tipo === "pagamento_reserva_cancelada" && a.alvoId === r.id)).toHaveLength(1);
  });

  test("conta fechada rejeita lançamento e pagamento", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await abrirCaixa(ctx, recepcao.id, 0);
    await ctx.db.updateTable("contas").set({ situacao: "fechada" }).where("id", "=", r.contaId).execute();
    await expect(extra(r.contaId)).rejects.toMatchObject({ codigo: "CONTA_FECHADA" });
    await expect(
      registrarPagamento(ctx, { contaId: r.contaId, formaCodigo: "pix", valor: 100 }, recepcao),
    ).rejects.toMatchObject({ codigo: "CONTA_FECHADA" });
  });

  test("diária duplicada para a mesma noite é rejeitada pelo banco", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    const diaria = { contaId: r.contaId, reservaId: r.id, tipo: "diaria" as const, origem: "hospedagem", descricao: "Diária", quantidade: 1, valorUnitario: 30000, dataRef: "2026-11-20" };
    await lancar(ctx, diaria, "Sistema");
    await expect(lancar(ctx, diaria, "Sistema")).rejects.toThrow();
    expect(await saldo(ctx, r.contaId)).toMatchObject({ debitos: 30000 });
  });
});

describe("saldo órfão na conta", () => {
  test("I3: pré-reserva com sinal parcial cancelada gera alerta de crédito a devolver", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await abrirCaixa(ctx, recepcao.id, 0);
    await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 10000 }, recepcao);
    await cancelarReserva(ctx, r.id, recepcao, { motivo: "Desistiu", supervisor: admin });
    const alertas = (await alertasAbertos(ctx)).filter((x) => x.tipo === "conta_com_saldo");
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ alvoTipo: "conta", alvoId: r.contaId });
    expect(alertas[0]!.mensagem).toContain("R$ 100,00");
    expect(alertas[0]!.mensagem).toMatch(/crédito/);
    expect(alertas[0]!.mensagem).toMatch(/devol/);
  });

  test("I3: cancelamento com conta zerada não gera alerta", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await cancelarReserva(ctx, r.id, recepcao, { motivo: "Desistiu", supervisor: admin });
    expect((await alertasAbertos(ctx)).filter((x) => x.tipo === "conta_com_saldo")).toEqual([]);
  });
});

describe("faturado e estorno de pagamento", () => {
  test("I2: faturado só entra pelo check-out", async () => {
    const app = criarApp(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    const r = await criarReserva(ctx, dados, recepcao);
    await abrirCaixa(ctx, recepcao.id, 0);
    await expect(registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "faturado", valor: 1000 }, recepcao))
      .rejects.toMatchObject({ codigo: "FATURADO_SOMENTE_NO_CHECKOUT" });
    const res = await app.inject({ method: "POST", url: `/api/contas/${r.contaId}/pagamentos`, headers: rec, payload: { reservaId: r.id, formaCodigo: "faturado", valor: 1000 } });
    expect(res.statusCode).toBe(422);
    expect(res.json().codigo).toBe("FATURADO_SOMENTE_NO_CHECKOUT");
    expect(await ctx.db.selectFrom("pagamentos").selectAll().execute()).toHaveLength(0);
  });

  test("estornar pagamento exige caixa.operar", async () => {
    await ctx.db.insertInto("perfis").values({ nome: "lancador", limite_desconto: 0 }).execute();
    await ctx.db.insertInto("perfil_permissoes").values({ perfil: "lancador", permissao: "conta.lancar" }).execute();
    await criarUsuario(ctx, { nome: "Lançador", login: "lancador", senha: "senha-teste", perfil: "lancador" }, "admin");
    const app = criarApp(ctx);
    const lanc = { authorization: `Bearer ${(await app.inject({ method: "POST", url: "/api/sessoes", payload: { login: "lancador", senha: "senha-teste" } })).json().token}` };
    const r = await criarReserva(ctx, dados, recepcao);
    await abrirCaixa(ctx, recepcao.id, 0);
    const idP = await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 1000 }, recepcao);
    const res = await app.inject({ method: "POST", url: `/api/pagamentos/${idP}/estornar`, headers: lanc, payload: { motivo: "Erro", supervisor: admin } });
    expect(res.statusCode).toBe(403);
    expect(res.json().detalhes).toMatchObject({ permissao: "caixa.operar" });
  });
});

describe("rotas da conta", () => {
  test("lançar, pagar, consultar e estornar", async () => {
    const app = criarApp(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    const gov = await entrarComo(ctx, "governanca");
    const r = await criarReserva(ctx, dados, recepcao);
    await criarProduto(ctx, { codigo: "AGUA", nome: "Água", precoCentavos: 700, unidade: "un", grupo: "bebidas", tipo: "produto" }, "u1");
    const url = `/api/contas/${r.contaId}`;

    expect((await app.inject({ method: "POST", url: `${url}/lancamentos`, headers: gov, payload: { tipo: "extra", produtoCodigo: "AGUA", quantidade: 2 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `${url}/lancamentos`, headers: rec, payload: { tipo: "diaria", descricao: "x", valorUnitario: 1, quantidade: 1 } })).statusCode).toBe(400);
    const l1 = await app.inject({ method: "POST", url: `${url}/lancamentos`, headers: rec, payload: { tipo: "extra", produtoCodigo: "AGUA", quantidade: 2 } });
    expect(l1.statusCode).toBe(200);
    const l2 = await app.inject({ method: "POST", url: `${url}/lancamentos`, headers: rec, payload: { tipo: "extra", descricao: "Lavanderia", valorUnitario: 3000, quantidade: 1 } });
    expect(l2.statusCode).toBe(200);

    expect((await app.inject({ method: "POST", url: `${url}/lancamentos`, headers: rec, payload: { tipo: "extra", descricao: "x", valorUnitario: -500, quantidade: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `${url}/lancamentos`, headers: rec, payload: { tipo: "extra", descricao: "x", valorUnitario: 0, quantidade: 1 } })).statusCode).toBe(400);
    const semCaixa = await app.inject({ method: "POST", url: `${url}/pagamentos`, headers: rec, payload: { reservaId: r.id, formaCodigo: "pix", valor: 27000 } });
    expect(semCaixa.statusCode).toBe(422);
    await abrirCaixa(ctx, recepcao.id, 0);
    expect((await app.inject({ method: "POST", url: `${url}/pagamentos`, headers: gov, payload: { formaCodigo: "pix", valor: 100 } })).statusCode).toBe(403);
    const pg = await app.inject({ method: "POST", url: `${url}/pagamentos`, headers: rec, payload: { reservaId: r.id, formaCodigo: "pix", valor: 27000 } });
    expect(pg.statusCode).toBe(200);
    expect((await obterReserva(ctx, r.id)).estado).toBe("confirmada");

    const c = await app.inject({ method: "GET", url, headers: rec });
    expect(c.statusCode).toBe(200);
    expect(c.json().saldo).toEqual({ debitos: 4400, creditos: 27000, saldo: -22600 });
    expect(c.json().extrato).toHaveLength(3);

    const idL = l1.json().id;
    expect((await app.inject({ method: "POST", url: `/api/lancamentos/${idL}/estornar`, headers: rec, payload: { motivo: "x" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/lancamentos/${idL}/estornar`, headers: gov, payload: { motivo: "x", supervisor: admin } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/lancamentos/${idL}/estornar`, headers: rec, payload: { motivo: "Erro", supervisor: admin } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/lancamentos/${idL}/estornar`, headers: rec, payload: { motivo: "Erro", supervisor: admin } })).statusCode).toBe(422);
    const idP = pg.json().id;
    expect((await app.inject({ method: "POST", url: `/api/pagamentos/${idP}/estornar`, headers: rec, payload: { motivo: "Erro", supervisor: admin } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url, headers: rec })).json().saldo).toEqual({ debitos: 3000, creditos: 0, saldo: 3000 });
  });
});
