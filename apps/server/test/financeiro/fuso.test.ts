import { describe, expect, test } from "vitest";
import { processarPagamentoRegistrado } from "../../src/financeiro/consumidores-eventos/hospedagem-pagamento.js";
import { criarApp } from "../../src/http/app.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

// 2026-11-03T01:30Z = 2026-11-02 22:30 em São Paulo (UTC-3): o dia da pousada ainda é 02/11.
async function cenario(agora = "2026-11-03T01:30:00Z") {
  const ctx = await criarContextoTeste(agora);
  const app = criarApp(ctx);
  const admin = await entrarComo(ctx, "admin");
  const chamar = async (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => {
    const r = await app.inject({ method, url: `/api/financeiro${url}`, headers: admin, payload: payload as any });
    return { status: r.statusCode, corpo: r.json() as any };
  };
  const local = (await chamar("POST", "/locais", { nome: "Pousada" })).corpo;
  const caixa = (await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0];
  return { ctx, chamar, local, caixa };
}

describe("dias de calendário no fuso da pousada", () => {
  test("conta a receber que vence hoje (22h30 locais) não aparece como vencida", async () => {
    const { ctx, chamar, local } = await cenario();
    await ctx.db.insertInto("fin_cliente").values({ id: "cli", local_id: local.id, nome: "Emp", cpf_cnpj: null, tipo: "pessoa_juridica", contato: null, criado_em: "2026-11-01T00:00:00Z" }).execute();
    await ctx.db.insertInto("fin_faturamento").values({ id: "f", local_id: local.id, cliente_id: "cli", referencia_id: "r", valor_original: 100, valor_liquido: 100, data_vencimento: "2026-11-02T12:00:00Z", forma_cobranca: "boleto", numero_documento: "FAT-1", status: "aberto", lançamentos_id: "[]", criado_em: "2026-11-01T00:00:00Z" }).execute();
    await ctx.db.insertInto("fin_conta_receber").values({ id: "cr", local_id: local.id, cliente_id: "cli", numero_documento: "FAT-1", valor_original: 100, valor_recebido: 0, data_vencimento: "2026-11-02T12:00:00.000Z", forma_pagamento: "pix", status: "pendente", criado_em: "2026-11-01T00:00:00Z" }).execute();
    const r = (await chamar("GET", `/relatorios/contas-receber?local_id=${local.id}`)).corpo;
    expect(r.itens[0].situacao).toBe("aberto");
  });

  test("relatório de cartão: previsão de amanhã (local) ainda é aberto; a de hoje já é pronta para baixar", async () => {
    const { chamar, local } = await cenario();
    await chamar("POST", "/cartao/movimentos", { local_id: local.id, data: "2026-11-02", bandeira: "Visa", tipo: "credito", valor: 1000, informado: "bruto", taxa_percentual: 0, previsao: "2026-11-03" });
    await chamar("POST", "/cartao/movimentos", { local_id: local.id, data: "2026-11-01", bandeira: "Elo", tipo: "debito", valor: 2000, informado: "bruto", taxa_percentual: 0, previsao: "2026-11-02" });
    const r = (await chamar("GET", `/relatorios/cartao?local_id=${local.id}`)).corpo;
    expect(r.aberto).toEqual({ quantidade: 1, valor: 1000 });
    expect(r.fechado).toEqual({ quantidade: 1, valor: 2000 });
  });

  test("pagamento de cartão da hospedagem às 22h30: data da venda e previsão no dia local", async () => {
    const { ctx, local } = await cenario();
    const cat = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 2, maxCriancas: 0, comodidades: [] }, "u1")).id;
    await salvarHospede(ctx, { id: "h1", nome: "Maria", documentoTipo: "cpf", documento: "52998224725", nascimento: "1990-01-01", nacionalidade: "BR" }, "u1");
    await ctx.db.insertInto("contas").values({ id: "c1", titular_id: "h1", situacao: "aberta" }).execute();
    await ctx.db.insertInto("reservas").values({ id: "r1", codigo: 1, estado: "hospedada", titular_id: "h1", categoria_id: cat, quarto_id: null, chegada: "2026-11-02", saida: "2026-11-04", adultos: 1, criancas: "[]", canal: "Balcao", conta_id: "c1", valor_sinal: 0, criada_em: "2026-11-02T12:00:00Z" } as any).execute();
    await processarPagamentoRegistrado(ctx, { criadoEm: "2026-11-03T01:30:00.000Z", payload: { pagamentoId: "p1", contaId: "c1", reservaId: "r1", formaCodigo: "debito", valor: 5000 } });
    const m = (await ctx.db.selectFrom("fin_cartao_movimento").selectAll().where("local_id", "=", local.id).executeTakeFirstOrThrow()) as any;
    expect(m.data).toBe("2026-11-02");
  });

  test("número da fatura usa o ano da pousada na virada do ano", async () => {
    const { ctx, chamar, local } = await cenario("2027-01-01T01:00:00Z"); // 31/12/2026 22h local
    await ctx.db.insertInto("fin_cliente").values({ id: "cli", local_id: local.id, nome: "Emp", cpf_cnpj: null, tipo: "pessoa_juridica", contato: null, criado_em: "2026-12-01T00:00:00Z" }).execute();
    await ctx.db.insertInto("fin_faturamento").values({ id: "f", local_id: local.id, cliente_id: "cli", referencia_id: "r", valor_original: 100, valor_liquido: 100, data_vencimento: "2027-01-10T12:00:00Z", forma_cobranca: "boleto", numero_documento: null, status: "aberto", lançamentos_id: "[]", criado_em: "2026-12-01T00:00:00Z" }).execute();
    const f = await chamar("POST", "/faturamentos/f/fechar", { forma: "pix", data_vencimento: "2027-01-10" });
    expect(f.corpo.numero_documento).toMatch(/^FAT-2026-/);
  });

  test("listas devolvem o dia local dos instantes (lançamentos e extrato)", async () => {
    const { ctx, chamar, local, caixa } = await cenario();
    const { LançamentoService } = await import("../../src/financeiro/servicos/lançamentos.js");
    const { CaixaBancoService } = await import("../../src/financeiro/servicos/caixa-banco.js");
    const { Dinheiro } = await import("../../src/shared/dinheiro.js");
    const l = await new LançamentoService(ctx).criar({ local_id: local.id, data: new Date("2026-11-03T01:30:00Z"), tipo: "recebimento", origem: "manual", valor: Dinheiro.de(100), forma_pagamento: "pix", usuario: { email: "a@b.c" } });
    await new CaixaBancoService(ctx).criarMovimento(l, caixa.id, { email: "a@b.c" });
    expect((await chamar("GET", `/lancamentos?local_id=${local.id}`)).corpo[0].dia).toBe("2026-11-02");
    const ex = (await chamar("GET", `/relatorios/movimento?conta_id=${caixa.id}&data_inicio=2026-11-02&data_fim=2026-11-02`)).corpo;
    expect(ex.movimentos[0].dia).toBe("2026-11-02");
  });
});
