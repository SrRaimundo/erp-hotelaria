import { describe, expect, test } from "vitest";
import { criarApp } from "../../../src/http/app.js";
import { calcularCartao } from "../../../src/financeiro/servicos/cartao.js";
import { criarContextoTeste, entrarComo } from "../../ajuda.js";

async function cenario() {
  const ctx = await criarContextoTeste();
  const app = criarApp(ctx);
  const admin = await entrarComo(ctx, "admin");
  const chamar = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) => {
    const r = await app.inject({ method, url: `/api/financeiro${url}`, headers: admin, payload: payload as any });
    return { status: r.statusCode, corpo: r.json() as any };
  };
  const local = (await chamar("POST", "/locais", { nome: "Pousada" })).corpo;
  const caixa = (await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0];
  return { ctx, app, admin, chamar, local, caixa };
}

describe("Local e cadastros", () => {
  test("cria, lista, renomeia, desativa e marca o padrão da hospedagem", async () => {
    const { chamar, local, ctx } = await cenario();
    expect(local).toMatchObject({ nome: "Pousada", ativo: true });
    const outro = (await chamar("POST", "/locais", { nome: "Sorveteria" })).corpo;
    expect((await chamar("GET", "/locais")).corpo.map((l: any) => l.nome)).toEqual(["Pousada", "Sorveteria"]);

    const marcado = await chamar("PUT", `/locais/${outro.id}`, { nome: "Sorveteria Centro", hospedagem_padrao: true });
    expect(marcado.corpo).toMatchObject({ nome: "Sorveteria Centro", hospedagem_padrao: true });
    expect((await chamar("GET", "/locais")).corpo.find((l: any) => l.id === local.id).hospedagem_padrao).toBe(false);

    const nascePadrao = (await chamar("POST", "/locais", { nome: "Bar", hospedagem_padrao: true })).corpo;
    expect(nascePadrao.hospedagem_padrao).toBe(true);
    await chamar("PUT", `/locais/${outro.id}`, { hospedagem_padrao: true });
    expect((await chamar("GET", "/locais")).corpo.find((l: any) => l.id === nascePadrao.id).hospedagem_padrao).toBe(false);
    expect((await chamar("PUT", `/locais/${outro.id}`, { ativo: false })).corpo).toMatchObject({ ativo: false, hospedagem_padrao: true });
    expect((await chamar("PUT", `/locais/${local.id}`, { ativo: false, hospedagem_padrao: true })).status).toBe(422);
    expect((await chamar("POST", "/locais", { nome: "  " })).status).toBe(400);
    expect(await ctx.db.selectFrom("auditoria").select("acao").where("acao", "like", "fin_local.%").execute()).not.toHaveLength(0);
  });

  test("contas por local com saldo, fornecedores e clientes; número de conta único", async () => {
    const { chamar, local } = await cenario();
    const nova = await chamar("POST", "/contas", { local_id: local.id, nome: "Banco X", banco: "Banco X", agencia: "1", numero: "123-4", tipo: "corrente", saldo_inicial: 50000 });
    expect(nova.status).toBe(201);
    expect(nova.corpo).toMatchObject({ nome: "Banco X", saldo: 50000 });
    expect((await chamar("POST", "/contas", { local_id: local.id, nome: "Outra", numero: "123-4", tipo: "corrente" })).status).toBe(422);
    expect((await chamar("GET", `/contas?local_id=${local.id}`)).corpo.map((c: any) => c.nome)).toEqual(["Caixa", "Banco X"]);

    const f = await chamar("POST", "/fornecedores", { local_id: local.id, razao_social: "Padaria Ltda", cnpj: "11222333000181" });
    expect(f.status).toBe(201);
    expect((await chamar("POST", "/fornecedores", { local_id: local.id, razao_social: "Outra", cnpj: "11222333000181" })).status).toBe(422);
    expect((await chamar("GET", `/fornecedores?local_id=${local.id}`)).corpo).toHaveLength(1);
    expect((await chamar("GET", `/clientes?local_id=${local.id}`)).corpo).toEqual([]);
  });
});

describe("Contas a Pagar", () => {
  test("nasce pendente, baixa debita a conta e cancelar a baixa devolve o saldo", async () => {
    const { chamar, local, caixa, ctx } = await cenario();
    const forn = (await chamar("POST", "/fornecedores", { local_id: local.id, razao_social: "Padaria Ltda" })).corpo;
    const criado = await chamar("POST", "/contas-a-pagar", {
      local_id: local.id, descricao: "Pães de julho", categoria: "fornecedor", valor: 12000, vencimento: "2026-11-20", fornecedor_id: forn.id,
    });
    expect(criado.status).toBe(201);
    expect(criado.corpo).toMatchObject({ tipo: "pagamento", status: "pendente", categoria: "fornecedor", valor: 12000 });
    expect(await ctx.db.selectFrom("fin_movimento").selectAll().execute()).toHaveLength(0);

    const lista = (await chamar("GET", `/lancamentos?local_id=${local.id}&tipo=pagamento`)).corpo;
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ descricao: "Pães de julho", fornecedor_nome: "Padaria Ltda", vencimento: expect.stringContaining("2026-11-20") });

    const baixa = await chamar("PUT", `/contas-a-pagar/${criado.corpo.id}/baixar`, { conta_id: caixa.id, forma_pagamento: "dinheiro" });
    expect(baixa.status).toBe(200);
    expect(baixa.corpo).toMatchObject({ status: "confirmado", forma_pagamento: "dinheiro" });
    expect((await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0].saldo).toBe(-12000);
    expect((await chamar("PUT", `/contas-a-pagar/${criado.corpo.id}/baixar`, { conta_id: caixa.id })).status).toBe(422);

    const cancelar = await chamar("DELETE", `/lancamentos/${criado.corpo.id}`, { motivo: "Pago em duplicidade", supervisor: { login: "admin", senha: "admin" } });
    expect(cancelar.status).toBe(200);
    expect((await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0].saldo).toBe(0);
  });

  test("valida categoria, valor e fornecedor de outro local", async () => {
    const { chamar, local } = await cenario();
    const base = { local_id: local.id, descricao: "Luz", categoria: "servico", valor: 5000, vencimento: "2026-11-20" };
    expect((await chamar("POST", "/contas-a-pagar", { ...base, categoria: "outra" })).status).toBe(400);
    expect((await chamar("POST", "/contas-a-pagar", { ...base, valor: 0 })).status).toBe(400);
    expect((await chamar("POST", "/contas-a-pagar", { ...base, descricao: " " })).status).toBe(400);
    expect((await chamar("POST", "/contas-a-pagar", { ...base, fornecedor_id: "nao-existe" })).status).toBe(422);
  });
});

describe("Cartão de Crédito", () => {
  test("calcula líquido a partir do bruto e bruto a partir do líquido", () => {
    expect(calcularCartao(10000, "bruto", 2.5)).toEqual({ bruto: 10000, taxa: 250, liquido: 9750 });
    expect(calcularCartao(9750, "liquido", 2.5)).toEqual({ bruto: 10000, taxa: 250, liquido: 9750 });
    expect(() => calcularCartao(100, "bruto", 100)).toThrow();
  });

  test("movimento a receber é baixado pelo líquido na conta escolhida", async () => {
    const { chamar, local, caixa, ctx } = await cenario();
    const criado = await chamar("POST", "/cartao/movimentos", {
      local_id: local.id, data: "2026-11-10", bandeira: "Visa", tipo: "credito", valor: 9750, informado: "liquido", taxa_percentual: 2.5,
    });
    expect(criado.status).toBe(201);
    expect(criado.corpo).toMatchObject({ valor_bruto: 10000, valor_taxa: 250, valor_liquido: 9750, status: "a_receber", previsao: "2026-12-10" });
    expect((await chamar("GET", `/cartao/movimentos?local_id=${local.id}`)).corpo).toHaveLength(1);
    expect((await chamar("GET", `/relatorios/cartao?local_id=${local.id}`)).corpo.aberto).toEqual({ quantidade: 1, valor: 9750 });

    const baixa = await chamar("PUT", `/cartao/movimentos/${criado.corpo.id}/baixar`, { conta_id: caixa.id, taxa_percentual: 3 });
    expect(baixa.status).toBe(200);
    expect(baixa.corpo).toMatchObject({ status: "baixado", valor_taxa: 300, valor_liquido: 9700, conta_destino_id: caixa.id });
    expect((await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0].saldo).toBe(9700);
    expect((await ctx.db.selectFrom("fin_lancamento").select("status").where("id", "=", criado.corpo.lancamento_id).executeTakeFirstOrThrow()).status).toBe("liquidado");
    expect((await chamar("PUT", `/cartao/movimentos/${criado.corpo.id}/baixar`, { conta_id: caixa.id })).status).toBe(422);
  });

  test("valida bandeira, tipo e taxa", async () => {
    const { chamar, local } = await cenario();
    const base = { local_id: local.id, data: "2026-11-10", bandeira: "Visa", tipo: "credito", valor: 1000, informado: "bruto", taxa_percentual: 2 };
    expect((await chamar("POST", "/cartao/movimentos", { ...base, bandeira: "" })).status).toBe(400);
    expect((await chamar("POST", "/cartao/movimentos", { ...base, tipo: "cheque" })).status).toBe(400);
    expect((await chamar("POST", "/cartao/movimentos", { ...base, taxa_percentual: 120 })).status).toBe(400);
  });
});

describe("Faturamento", () => {
  test("lista abertos com cliente e fecha a fatura para Contas a Receber; política e contato salvos", async () => {
    const { chamar, local, ctx } = await cenario();
    await ctx.db.insertInto("fin_cliente").values({ id: "cli1", local_id: local.id, nome: "Empresa X", cpf_cnpj: "11222333000181", tipo: "pessoa_juridica", contato: null, criado_em: "2026-11-01T00:00:00Z" }).execute();
    await ctx.db.insertInto("fin_faturamento").values({
      id: "fat1", local_id: local.id, cliente_id: "cli1", referencia_id: "ref1", valor_original: 80000, valor_liquido: 80000,
      data_vencimento: "2026-12-01T00:00:00Z", forma_cobranca: "boleto", numero_documento: null, status: "aberto", lançamentos_id: "[]", criado_em: "2026-11-02T00:00:00Z",
    }).execute();
    const antes = (await chamar("GET", `/faturamentos?local_id=${local.id}`)).corpo;
    expect(antes).toHaveLength(1);
    expect(antes[0]).toMatchObject({ cliente_nome: "Empresa X", cliente_documento: "11222333000181", fechada: false, valor_liquido: 80000 });

    const cli = await chamar("PUT", "/clientes/cli1", { contato: { email: "fin@x.com", telefone: "1199", endereco: "Rua A, 1" }, politica: { prazo_dias: 15, forma_cobranca: "pix" } });
    expect(cli.status).toBe(200);
    expect((await chamar("GET", `/clientes?local_id=${local.id}`)).corpo[0]).toMatchObject({ contato: { email: "fin@x.com" }, politica: { prazo_dias: 15, forma_cobranca: "pix" } });

    const fechada = await chamar("POST", "/faturamentos/fat1/fechar", { forma: "pix", data_vencimento: "2026-11-30" });
    expect(fechada.status).toBe(200);
    expect(fechada.corpo.numero_documento).toMatch(/^FAT-/);
    const depois = (await chamar("GET", `/faturamentos?local_id=${local.id}`)).corpo[0];
    expect(depois).toMatchObject({ fechada: true, forma_cobranca: "pix", cliente_contato: { email: "fin@x.com" } });
    const receber = (await chamar("GET", `/relatorios/contas-receber?local_id=${local.id}`)).corpo.itens;
    expect(receber).toHaveLength(1);
    expect(receber[0]).toMatchObject({ cliente_nome: "Empresa X", valor_original: 80000, numero_documento: fechada.corpo.numero_documento });
    expect((await chamar("POST", "/faturamentos/fat1/fechar", { forma: "pix", data_vencimento: "2026-11-30" })).status).toBe(422);
    expect((await chamar("POST", "/faturamentos/nao/fechar", { forma: "pix", data_vencimento: "2026-11-30" })).status).toBe(422);
  });
});

describe("Cancelar e estornar com Caixa/Banco", () => {
  test("estorno de recebimento em dinheiro devolve o saldo da conta", async () => {
    const { chamar, local, caixa, ctx } = await cenario();
    const { LançamentoService } = await import("../../../src/financeiro/servicos/lançamentos.js");
    const { CaixaBancoService } = await import("../../../src/financeiro/servicos/caixa-banco.js");
    const { Dinheiro } = await import("../../../src/shared/dinheiro.js");
    const u = { email: "a@b.c" };
    const l = await new LançamentoService(ctx).criar({ local_id: local.id, data: new Date("2026-11-10T12:00:00Z"), tipo: "recebimento", origem: "manual", valor: Dinheiro.de(7000), forma_pagamento: "pix", usuario: u });
    await new CaixaBancoService(ctx).criarMovimento(l, caixa.id, u);
    expect((await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0].saldo).toBe(7000);
    await new LançamentoService(ctx).estornar(l.id, "Cobrança indevida", "admin", u);
    expect((await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0].saldo).toBe(0);
  });
});

describe("Dia do relatório no fuso da pousada", () => {
  test("movimento às 22h locais (01h UTC do dia seguinte) entra no fluxo do dia local", async () => {
    const { chamar, local, caixa, ctx } = await cenario();
    const { LançamentoService } = await import("../../../src/financeiro/servicos/lançamentos.js");
    const { CaixaBancoService } = await import("../../../src/financeiro/servicos/caixa-banco.js");
    const { Dinheiro } = await import("../../../src/shared/dinheiro.js");
    const u = { email: "a@b.c" };
    // 2026-11-02 22:00 em São Paulo (UTC-3) = 2026-11-03 01:00 UTC
    const l = await new LançamentoService(ctx).criar({ local_id: local.id, data: new Date("2026-11-03T01:00:00Z"), tipo: "recebimento", origem: "manual", valor: Dinheiro.de(4000), forma_pagamento: "pix", usuario: u });
    await new CaixaBancoService(ctx).criarMovimento(l, caixa.id, u);
    const dia2 = (await chamar("GET", `/relatorios/fluxo-caixa?local_id=${local.id}&data=2026-11-02`)).corpo;
    expect(dia2).toMatchObject({ entradas: 4000, saldo_final: 4000 });
    const dia3 = (await chamar("GET", `/relatorios/fluxo-caixa?local_id=${local.id}&data=2026-11-03`)).corpo;
    expect(dia3).toMatchObject({ entradas: 0, saldo_inicial: 4000 });
    const extrato = (await chamar("GET", `/relatorios/movimento?conta_id=${caixa.id}&data_inicio=2026-11-02&data_fim=2026-11-02`)).corpo;
    expect(extrato.movimentos).toHaveLength(1);
    const lista = (await chamar("GET", `/lancamentos?local_id=${local.id}&data_inicio=2026-11-02&data_fim=2026-11-02`)).corpo;
    expect(lista).toHaveLength(1);
    expect((await chamar("GET", `/lancamentos?local_id=${local.id}&data_inicio=2026-11-03&data_fim=2026-11-03`)).corpo).toHaveLength(0);
  });
});
