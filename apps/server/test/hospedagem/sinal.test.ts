import { beforeEach, describe, expect, test } from "vitest";
import { lancar, registrarPagamento } from "../../src/hospedagem/conta.js";
import { criarReserva, obterReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { processarSinais } from "../../src/hospedagem/sinal.js";
import { alertasAbertos } from "../../src/infra/alertas.js";
import { abrirCaixa } from "../../src/nucleo/caixa.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { criarQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { RelogioFixo } from "../../src/shared/relogio.js";
import { salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let recepcao: UsuarioSessao;
let dados: NovaReserva;

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

const avancar = (h: number) => (ctx.relogio as RelogioFixo).avancarHoras(h);

describe("prazo do sinal", () => {
  test("ciclo completo: aviso no prazo, cancelamento após a tolerância", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    avancar(47);
    expect((await processarSinais(ctx)).avisadas).toEqual([]);
    avancar(1);
    expect((await processarSinais(ctx)).avisadas).toEqual([r.id]);
    expect((await alertasAbertos(ctx)).map((a) => a.tipo)).toEqual(["sinal_vencido"]);
    avancar(11);
    expect((await processarSinais(ctx)).canceladas).toEqual([]);
    avancar(1);
    expect((await processarSinais(ctx)).canceladas).toEqual([r.id]);
    expect((await obterReserva(ctx, r.id)).estado).toBe("cancelada");
    const aud = await ctx.db.selectFrom("auditoria").selectAll().where("acao", "=", "reserva.cancelar").executeTakeFirst();
    expect(aud).toMatchObject({ ator: "Sistema", motivo: "sinal não pago", alvo_id: r.id });
    const ev = await ctx.db.selectFrom("outbox").selectAll().where("tipo", "=", "hospedagem.ReservaCancelada").execute();
    expect(ev).toHaveLength(1);
    expect(JSON.parse(ev[0]!.payload)).toEqual({ reservaId: r.id, motivo: "sinal não pago", automatico: true });
    expect(await alertasAbertos(ctx)).toEqual([]);
    const al = await ctx.db.selectFrom("alertas").select("resolvido_por").executeTakeFirstOrThrow();
    expect(al.resolvido_por).toBe("Sistema");
  });

  test("I3: cancelamento automático com consumo na conta gera alerta de saldo", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await lancar(ctx, { contaId: r.contaId, tipo: "extra", origem: "hospedagem", descricao: "Transfer", quantidade: 1, valorUnitario: 8000 }, recepcao.id);
    avancar(48);
    await processarSinais(ctx);
    avancar(12);
    expect((await processarSinais(ctx)).canceladas).toEqual([r.id]);
    const alertas = await alertasAbertos(ctx);
    expect(alertas.map((a) => [a.tipo, a.alvoTipo, a.alvoId])).toEqual([["conta_com_saldo", "conta", r.contaId]]);
    expect(alertas[0]!.mensagem).toContain("R$ 80,00");
  });

  test("pagamento parcial impede o cancelamento automático e gera alerta", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await abrirCaixa(ctx, recepcao.id, 0);
    await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 10000 }, recepcao);
    avancar(48);
    expect((await processarSinais(ctx)).avisadas).toEqual([r.id]);
    avancar(12);
    expect(await processarSinais(ctx)).toEqual({ avisadas: [], canceladas: [] });
    expect((await obterReserva(ctx, r.id)).estado).toBe("pre_reserva");
    expect((await alertasAbertos(ctx)).map((a) => a.tipo).sort()).toEqual(["sinal_parcial", "sinal_vencido"]);
  });

  test("rodar duas vezes não duplica aviso nem alerta", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    avancar(48);
    expect((await processarSinais(ctx)).avisadas).toEqual([r.id]);
    expect((await processarSinais(ctx)).avisadas).toEqual([]);
    expect(await alertasAbertos(ctx)).toHaveLength(1);
    avancar(12);
    expect((await processarSinais(ctx)).canceladas).toEqual([r.id]);
    expect((await processarSinais(ctx)).canceladas).toEqual([]);
    const ev = await ctx.db.selectFrom("outbox").select("id").where("tipo", "=", "hospedagem.ReservaCancelada").execute();
    expect(ev).toHaveLength(1);
  });

  test("reserva confirmada nunca é processada", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await abrirCaixa(ctx, recepcao.id, 0);
    await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 27000 }, recepcao);
    avancar(100);
    expect(await processarSinais(ctx)).toEqual({ avisadas: [], canceladas: [] });
    expect((await obterReserva(ctx, r.id)).estado).toBe("confirmada");
    expect(await alertasAbertos(ctx)).toEqual([]);
  });
});
