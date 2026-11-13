import { beforeEach, describe, expect, test, vi } from "vitest";
import { ligarFilaFinanceiro, processarPendentes } from "../../src/financeiro/consumidores-eventos/fila.js";
import { LocalService } from "../../src/financeiro/servicos/locais.js";
import { registrarPagamento } from "../../src/hospedagem/conta.js";
import { registrarEvento } from "../../src/infra/outbox.js";
import { emTransacao } from "../../src/shared/contexto.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import { gerarUUID } from "../../src/shared/ids.js";
import { abrirCaixa } from "../../src/nucleo/caixa.js";
import { criarContextoTeste } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
const CRIADO = "2026-11-10T15:00:00.000Z";

async function publicar(tipo: string, payload: object) {
  await emTransacao(ctx, (tx) => registrarEvento(tx, tipo, payload));
}
const pag = (pagamentoId: string, formaCodigo = "pix", valor = 5000) => ({ pagamentoId, contaId: "c1", reservaId: "r1", formaCodigo, valor });
const lancs = () => ctx.db.selectFrom("fin_lancamento").selectAll().execute();
const movs = () => ctx.db.selectFrom("fin_movimento").selectAll().execute();
const cursor = async () => Number((await ctx.db.selectFrom("fin_cursor").select("ultimo_seq").where("nome", "=", "hospedagem").executeTakeFirstOrThrow()).ultimo_seq);

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined); // falhas esperadas são registradas no console
  ctx = await criarContextoTeste();
  await new LocalService(ctx).criar(gerarUUID(), "Pousada", { email: "a@b.c" });
  const cat = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 2, maxCriancas: 0, comodidades: [] }, "u1")).id;
  await salvarHospede(ctx, { id: "h1", nome: "Maria", documentoTipo: "cpf", documento: "52998224725", nascimento: "1990-01-01", nacionalidade: "BR" }, "u1");
  await ctx.db.insertInto("contas").values({ id: "c1", titular_id: "h1", situacao: "aberta" }).execute();
  await ctx.db.insertInto("reservas").values({
    id: "r1", codigo: 1, estado: "hospedada", titular_id: "h1", categoria_id: cat, quarto_id: null, chegada: "2026-11-10", saida: "2026-11-12",
    adultos: 1, criancas: "[]", canal: "Balcao", conta_id: "c1", valor_sinal: 0, criada_em: CRIADO,
  } as any).execute();
});

describe("fila do Financeiro sobre o outbox", () => {
  test("queda entre o commit e o consumo: ao reiniciar, o pagamento vira lançamento exatamente uma vez", async () => {
    // Sem assinante no barramento: é como se o processo tivesse caído logo após o commit.
    await publicar("hospedagem.PagamentoRegistrado", pag("p1"));
    expect(await lancs()).toHaveLength(0);
    const r = await processarPendentes(ctx); // "reinício"
    expect(r.processados).toBe(1);
    expect(await lancs()).toHaveLength(1);
    expect(await movs()).toHaveLength(1);
    await processarPendentes(ctx);
    await processarPendentes(ctx);
    expect(await lancs()).toHaveLength(1);
    expect(await movs()).toHaveLength(1);
    expect(await cursor()).toBeGreaterThan(0);
  });

  test("processa em ordem e avança o cursor junto com o efeito", async () => {
    await publicar("hospedagem.PagamentoRegistrado", pag("p1", "pix", 1000));
    await publicar("hospedagem.PagamentoRegistrado", pag("p2", "dinheiro", 2000));
    await processarPendentes(ctx);
    expect((await lancs()).map((l) => l.valor).sort()).toEqual([1000, 2000]);
    const max = await ctx.db.selectFrom("outbox").select((eb) => eb.fn.max("seq").as("m")).executeTakeFirstOrThrow();
    expect(await cursor()).toBe(Number(max.m));
  });

  test("falha não avança o cursor, bloqueia os seguintes, tenta de novo e alerta após repetidas falhas", async () => {
    // valor a receber inexistente: o consumidor lança erro
    await publicar("hospedagem.ValorAReceberCriado", { valorAReceberId: "v-falta", contaId: "c1", reservaId: "r1", valor: 9000 });
    await publicar("hospedagem.PagamentoRegistrado", pag("p9"));
    for (let i = 0; i < 3; i++) {
      const r = await processarPendentes(ctx);
      expect(r.falhou?.seq).toBeDefined();
    }
    expect(await cursor()).toBe(0);
    expect(await lancs()).toHaveLength(0); // ordem preservada: o seguinte espera
    const alertas = await ctx.db.selectFrom("alertas").selectAll().where("tipo", "=", "financeiro_evento_falhou").where("resolvido_em", "is", null).execute();
    expect(alertas).toHaveLength(1);

    // corrige a causa: o próximo ciclo conclui, resolve o alerta e segue
    await ctx.db.insertInto("valores_a_receber").values({
      id: "v-falta", conta_id: "c1", reserva_id: "r1", responsavel_nome: "Empresa X", responsavel_documento: "11222333000181", valor: 9000, criado_em: CRIADO, situacao: "aberto",
    }).execute();
    const ok = await processarPendentes(ctx);
    expect(ok.falhou).toBeUndefined();
    expect(await ctx.db.selectFrom("fin_faturamento").selectAll().execute()).toHaveLength(1);
    expect(await lancs()).toHaveLength(1);
    expect(await ctx.db.selectFrom("alertas").selectAll().where("tipo", "=", "financeiro_evento_falhou").where("resolvido_em", "is", null).execute()).toHaveLength(0);
  });

  test("antes de 3 falhas ainda não há alerta", async () => {
    await publicar("hospedagem.ValorAReceberCriado", { valorAReceberId: "v-falta", contaId: "c1", reservaId: "r1", valor: 9000 });
    await processarPendentes(ctx);
    await processarPendentes(ctx);
    expect(await ctx.db.selectFrom("alertas").selectAll().where("tipo", "=", "financeiro_evento_falhou").execute()).toHaveLength(0);
  });

  test("assinatura no barramento só dispara a fila: pagamento real da hospedagem chega sem chamada direta", async () => {
    ligarFilaFinanceiro(ctx);
    await abrirCaixa(ctx, "usuario-admin", 0);
    await registrarPagamento(ctx, { contaId: "c1", reservaId: "r1", formaCodigo: "pix", valor: 7000 }, { id: "usuario-admin", nome: "Admin", perfil: "admin", permissoes: [], trocarSenha: false, limiteDesconto: 0 });
    await new Promise((r) => setTimeout(r, 200));
    expect(await lancs()).toHaveLength(1);
    expect((await lancs())[0]).toMatchObject({ valor: 7000, forma_pagamento: "pix" });
  });

  test("posição inicial: banco já com eventos antes da migração não reprocessa o histórico", async () => {
    const { migracaoFinanceiroFila } = await import("../../src/financeiro/migracao.js");
    await publicar("hospedagem.PagamentoRegistrado", pag("antigo"));
    await ctx.db.deleteFrom("fin_cursor").execute();
    await migracaoFinanceiroFila.up(ctx.db);
    expect(await cursor()).toBeGreaterThan(0);
    await processarPendentes(ctx);
    expect(await lancs()).toHaveLength(0);
  });
});
