import { beforeEach, describe, expect, test, vi } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let app: ReturnType<typeof criarApp>;
let admin: { authorization: string };
let local: any;
let caixa: any;
let cliente: any;
let fornecedor: any;
const SUP = { login: "admin", senha: "admin" };

const chamar = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) => {
  const r = await app.inject({ method, url: `/api/financeiro${url}`, headers: admin, payload: payload as any });
  return { status: r.statusCode, corpo: r.json() as any };
};
const saldo = async () => (await chamar("GET", `/contas?local_id=${local.id}`)).corpo.find((c: any) => c.id === caixa.id).saldo as number;
const P = (v: string, valor: number) => ({ vencimento: v, valor });
const QUATRO = [P("2026-12-10", 25000), P("2027-01-10", 25000), P("2027-02-10", 25000), P("2027-03-10", 25000)];
const pagar = async (extra: object = {}) =>
  chamar("POST", "/titulos", { tipo: "pagar", local_id: local.id, documento: "NF 77", valor_total: 100000, intervalo: "mensal", categoria: "fornecedor", fornecedor_id: fornecedor.id, parcelas: QUATRO, ...extra });
const receber = async (extra: object = {}) =>
  chamar("POST", "/titulos", { tipo: "receber", local_id: local.id, documento: "EV-9", valor_total: 100000, intervalo: "mensal", categoria: "evento", cliente_id: cliente.id, parcelas: QUATRO, ...extra });
const lancs = async () => (await chamar("GET", `/lancamentos?local_id=${local.id}&tipo=pagamento`)).corpo as any[];
const baixar = (id: string, extra: object = {}) => chamar("PUT", `/contas-a-pagar/${id}/baixar`, { conta_id: caixa.id, ...extra });
const posicao = async () => (await chamar("GET", `/relatorios/contas-receber?local_id=${local.id}`)).corpo.itens as any[];
const receberParcela = (id: string, valor: number, novo?: string) => chamar("PUT", `/contas-receber/${id}/confirmar-pagamento`, { valor, conta_bancaria_id: caixa.id, novo_vencimento: novo });
const doTitulo = async (id: string) => (await lancs()).filter((x) => x.titulo_id === id).sort((a, b) => a.parcela_num - b.parcela_num || a.valor - b.valor);

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  ctx = await criarContextoTeste();
  app = criarApp(ctx);
  admin = await entrarComo(ctx, "admin");
  local = (await chamar("POST", "/locais", { nome: "Pousada" })).corpo;
  caixa = (await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0];
  cliente = (await chamar("POST", "/clientes", { local_id: local.id, nome: "Maria Eventos", cpf_cnpj: "52998224725" })).corpo;
  fornecedor = (await chamar("POST", "/fornecedores", { local_id: local.id, razao_social: "Padaria Ltda" })).corpo;
});

describe("título a pagar", () => {
  test("cria uma conta por parcela, cada uma com a sua data, e o título guarda o total", async () => {
    const r = await pagar();
    expect(r.status).toBe(201);
    expect(r.corpo).toMatchObject({ tipo: "pagar", documento: "NF 77", valor_total: 100000, num_parcelas: 4, status: "ativo", pago: 0, restante: 100000 });
    const l = await doTitulo(r.corpo.id);
    expect(l.map((x) => [x.parcela_num, x.parcela_total, x.valor, x.vencimento_dia, x.status, x.descricao])).toEqual([
      [1, 4, 25000, "2026-12-10", "pendente", "NF 77"], [2, 4, 25000, "2027-01-10", "pendente", "NF 77"],
      [3, 4, 25000, "2027-02-10", "pendente", "NF 77"], [4, 4, 25000, "2027-03-10", "pendente", "NF 77"],
    ]);
    expect(r.corpo.parcelas.map((p: any) => p.rotulo)).toEqual(["NF 77 – parcela 1/4", "NF 77 – parcela 2/4", "NF 77 – parcela 3/4", "NF 77 – parcela 4/4"]);
  });

  test("exige soma exata, datas crescentes, de 2 a 60 parcelas; nada é gravado quando recusa", async () => {
    const msg = async (extra: object) => { const r = await pagar(extra); expect(r.status).toBe(422); return r.corpo.mensagem as string; };
    expect(await msg({ parcelas: [P("2026-12-10", 60000), P("2027-01-10", 39999)] })).toMatch(/soma/);
    expect(await msg({ parcelas: [P("2027-01-10", 50000), P("2026-12-10", 50000)] })).toMatch(/ordem crescente/);
    expect(await msg({ parcelas: [P("2026-12-10", 50000), P("2026-12-10", 50000)] })).toMatch(/ordem crescente/);
    expect(await msg({ parcelas: [P("2026-12-10", 100000)] })).toMatch(/pelo menos 2/);
    expect(await msg({ fornecedor_id: "naoexiste" })).toMatch(/Fornecedor/);
    const muitas = Array.from({ length: 61 }, (_, i) => P(`${2027 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-05`, i === 0 ? 40 : 1));
    expect(await msg({ valor_total: 100, parcelas: muitas })).toMatch(/no máximo 60/);
    expect((await pagar({ parcelas: [P("2026-02-30", 50000), P("2026-12-10", 50000)] })).status).toBe(400);
    expect(await lancs()).toHaveLength(0);
    expect((await ctx.db.selectFrom("fin_titulo").selectAll().execute()).length).toBe(0);
  });

  test("a mesma chave de envio cria um só título", async () => {
    const [a, b] = await Promise.all([pagar({ chave: "t1" }), pagar({ chave: "t1" })]);
    expect(b.corpo.id).toBe(a.corpo.id);
    expect(await lancs()).toHaveLength(4);
    expect((await pagar({ chave: "t1", documento: "OUTRA" })).status).toBe(409);
  });

  test("cada parcela se paga sozinha; pagamento parcial dentro da parcela gera o saldo rotulado e o título soma tudo", async () => {
    const t = (await pagar()).corpo;
    const [p1, p2] = await doTitulo(t.id);
    expect((await baixar(p1.id)).status).toBe(200);
    expect(await saldo()).toBe(-25000);
    expect((await baixar(p2.id, { valor: 10000 })).status).toBe(422); // parcial exige novo vencimento
    expect((await baixar(p2.id, { valor: 10000, novo_vencimento: "2027-01-25" })).status).toBe(200);
    expect(await saldo()).toBe(-35000);
    const saldoP2 = (await doTitulo(t.id)).find((x) => x.parcela_de === p2.id);
    expect(saldoP2).toMatchObject({ valor: 15000, parcela_num: 2, parcela_total: 4, status: "pendente", vencimento_dia: "2027-01-25" });
    const d = (await chamar("GET", `/titulos/${t.id}`)).corpo;
    expect(d).toMatchObject({ valor_total: 100000, pago: 35000, restante: 65000, status: "ativo" });
    expect(d.parcelas.map((p: any) => p.rotulo)).toContain("NF 77 – parcela 2/4 – saldo");
    expect(d.parcelas.find((p: any) => p.id === p2.id)).toMatchObject({ pago: 10000, restante: 0, situacao: "pago" });
    expect(d.historico.map((h: any) => h.acao)).toEqual(expect.arrayContaining(["fin_titulo.criar", "fin_conta_pagar.baixar"]));
  });

  test("cancelar o título cancela só as pendentes; pagas e parcialmente pagas ficam", async () => {
    const t = (await pagar()).corpo;
    const [p1, p2] = await doTitulo(t.id);
    await baixar(p1.id);
    await baixar(p2.id, { valor: 10000, novo_vencimento: "2027-01-25" });
    expect((await chamar("POST", `/titulos/${t.id}/cancelar`, { motivo: " ", supervisor: SUP })).status).toBeGreaterThanOrEqual(400);
    const r = await chamar("POST", `/titulos/${t.id}/cancelar`, { motivo: "Compra desfeita", supervisor: SUP });
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ status: "cancelado", pago: 35000, restante: 0 });
    expect((await doTitulo(t.id)).map((x) => [x.parcela_num, x.status])).toEqual([[1, "confirmado"], [2, "confirmado"], [2, "cancelado"], [3, "cancelado"], [4, "cancelado"]]);
    expect(await saldo()).toBe(-35000);
    expect((await chamar("POST", `/titulos/${t.id}/cancelar`, { motivo: "de novo", supervisor: SUP })).status).toBe(422);
  });

  test("a regra de reversão continua valendo por parcela: estornar a paga devolve só ela", async () => {
    const t = (await pagar()).corpo;
    const [p1] = await doTitulo(t.id);
    await baixar(p1.id);
    expect((await chamar("POST", `/lancamentos/${p1.id}/estornar`, { motivo: "Engano", supervisor: SUP })).status).toBe(200);
    expect(await saldo()).toBe(0);
    expect((await chamar("GET", `/titulos/${t.id}`)).corpo).toMatchObject({ pago: 0, restante: 100000 });
  });

  test("título inexistente: recusa com mensagem", async () => {
    expect((await chamar("GET", "/titulos/naoexiste")).status).toBe(422);
  });
});

describe("título a receber (espelho)", () => {
  test("cria uma conta a receber por parcela; o relatório vê cada uma na sua data", async () => {
    const r = await receber();
    expect(r.status).toBe(201);
    expect(r.corpo).toMatchObject({ tipo: "receber", documento: "EV-9", num_parcelas: 4, pago: 0, restante: 100000 });
    const it = (await posicao()).sort((a, b) => a.parcela_num - b.parcela_num);
    expect(it.map((i) => [i.rotulo, i.data_vencimento.slice(0, 10), i.valor_original, i.titulo_id])).toEqual(
      QUATRO.map((p, k) => [`EV-9 – parcela ${k + 1}/4`, p.vencimento, 25000, r.corpo.id]),
    );
    expect(it[0]).toMatchObject({ origem: "manual", parcela_total: 4 });
  });

  test("valida como a pagar e recusa documento já usado no local", async () => {
    expect((await receber({ parcelas: [P("2026-12-10", 1), P("2027-01-10", 1)] })).status).toBe(422);
    expect((await receber()).status).toBe(201);
    expect((await receber()).status).toBe(422);
  });

  test("recebe a 2ª parcela parcialmente: saldo rotulado; cancelar o título preserva o recebido", async () => {
    const t = (await receber()).corpo;
    const [, p2] = (await posicao()).sort((a, b) => a.parcela_num - b.parcela_num);
    expect((await receberParcela(p2.id, 10000, "2027-01-25")).status).toBe(200);
    expect(await saldo()).toBe(10000);
    const it = await posicao();
    expect(it.find((i) => i.parcela_de === p2.id)).toMatchObject({ rotulo: "EV-9 – parcela 2/4 – saldo", valor_original: 15000, parcela_num: 2 });
    const r = await chamar("POST", `/titulos/${t.id}/cancelar`, { motivo: "Evento desfeito", supervisor: SUP });
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ status: "cancelado", pago: 10000, restante: 0 });
    const depois = await posicao();
    expect(depois).toHaveLength(1);
    expect(depois[0]).toMatchObject({ id: p2.id, situacao: "recebido", valor_recebido: 10000 });
    expect(await saldo()).toBe(10000);
  });

  test("parcela de título não se edita (cancele o título e refaça)", async () => {
    await receber();
    const [p1] = await posicao();
    expect(p1.editavel).toBe(false);
    const r = await chamar("PUT", `/contas-receber/${p1.id}`, { valor: 1 });
    expect(r.status).toBe(422);
    expect(r.corpo.mensagem).toMatch(/título/);
  });

  test("estornar o recebimento da parcela devolve só ela", async () => {
    const t = (await receber()).corpo;
    const [p1] = (await posicao()).sort((a, b) => a.parcela_num - b.parcela_num);
    await receberParcela(p1.id, 25000);
    const l = (await ctx.db.selectFrom("fin_lancamento").select("id").where("referencia_id", "=", p1.id).executeTakeFirstOrThrow()).id;
    expect((await chamar("POST", `/lancamentos/${l}/estornar`, { motivo: "Engano", supervisor: SUP })).status).toBe(200);
    expect(await saldo()).toBe(0);
    expect((await chamar("GET", `/titulos/${t.id}`)).corpo).toMatchObject({ pago: 0, restante: 100000 });
  });
});

describe("reversão depois de cancelar (o que foi cancelado não volta)", () => {
  const lancDoPagamento = async (id: string) => (await ctx.db.selectFrom("fin_lancamento").selectAll().where("id", "=", id).executeTakeFirstOrThrow()) as any;

  test("a pagar: estornar o pagamento de parcela de título cancelado devolve o dinheiro e a parcela fica cancelada", async () => {
    const t = (await pagar()).corpo;
    const [, p2] = await doTitulo(t.id);
    await baixar(p2.id, { valor: 10000, novo_vencimento: "2027-01-25" });
    expect((await chamar("POST", `/titulos/${t.id}/cancelar`, { motivo: "Desfeito", supervisor: SUP })).status).toBe(200);
    expect((await chamar("POST", `/lancamentos/${p2.id}/estornar`, { motivo: "Engano", supervisor: SUP })).status).toBe(200);
    expect(await saldo()).toBe(0);
    expect(await lancDoPagamento(p2.id)).toMatchObject({ status: "cancelado", valor: 25000 });
    expect((await chamar("GET", `/titulos/${t.id}`)).corpo).toMatchObject({ status: "cancelado", pago: 0, restante: 0 });
    expect((await lancs()).filter((x) => x.status === "pendente")).toHaveLength(0);
  });

  test("a pagar: saldo cancelado sozinho não volta quando o pagamento original é estornado", async () => {
    const t = (await pagar()).corpo;
    const [, p2] = await doTitulo(t.id);
    await baixar(p2.id, { valor: 10000, novo_vencimento: "2027-01-25" });
    const saldoP2 = (await doTitulo(t.id)).find((x) => x.parcela_de === p2.id);
    expect((await chamar("DELETE", `/lancamentos/${saldoP2.id}`, { motivo: "Perdoado", supervisor: SUP })).status).toBe(200);
    expect((await chamar("POST", `/lancamentos/${p2.id}/estornar`, { motivo: "Engano", supervisor: SUP })).status).toBe(200);
    expect(await saldo()).toBe(0);
    expect(await lancDoPagamento(p2.id)).toMatchObject({ status: "pendente", valor: 10000 });
  });

  test("a pagar: pagar parcial, estornar e pagar parcial de novo ainda devolve o valor cheio (saldo desfeito não é perdão)", async () => {
    const t = (await pagar()).corpo;
    const [, p2] = await doTitulo(t.id);
    await baixar(p2.id, { valor: 10000, novo_vencimento: "2027-01-25" });
    await chamar("POST", `/lancamentos/${p2.id}/estornar`, { motivo: "Engano", supervisor: SUP });
    await baixar(p2.id, { valor: 5000, novo_vencimento: "2027-01-26" });
    await chamar("POST", `/lancamentos/${p2.id}/estornar`, { motivo: "Engano 2", supervisor: SUP });
    expect(await lancDoPagamento(p2.id)).toMatchObject({ status: "pendente", valor: 25000 });
  });

  test("a receber: estornar o recebimento de parcela de título cancelado devolve o dinheiro e a parcela fica cancelada", async () => {
    const t = (await receber()).corpo;
    const [, p2] = (await posicao()).sort((a, b) => a.parcela_num - b.parcela_num);
    await receberParcela(p2.id, 10000, "2027-01-25");
    expect((await chamar("POST", `/titulos/${t.id}/cancelar`, { motivo: "Desfeito", supervisor: SUP })).status).toBe(200);
    const l = (await ctx.db.selectFrom("fin_lancamento").select("id").where("referencia_id", "=", p2.id).executeTakeFirstOrThrow()).id;
    expect((await chamar("POST", `/lancamentos/${l}/estornar`, { motivo: "Engano", supervisor: SUP })).status).toBe(200);
    expect(await saldo()).toBe(0);
    expect(await posicao()).toHaveLength(0);
    expect((await ctx.db.selectFrom("fin_conta_receber").selectAll().where("id", "=", p2.id).executeTakeFirstOrThrow()) as any).toMatchObject({ status: "cancelado", valor_original: 25000, valor_recebido: 0 });
    expect((await chamar("GET", `/titulos/${t.id}`)).corpo).toMatchObject({ status: "cancelado", pago: 0, restante: 0 });
  });

  test("a receber: saldo cancelado sozinho não volta quando o recebimento original é estornado", async () => {
    await receber();
    const [, p2] = (await posicao()).sort((a, b) => a.parcela_num - b.parcela_num);
    await receberParcela(p2.id, 10000, "2027-01-25");
    const filha = (await posicao()).find((i) => i.parcela_de === p2.id);
    expect((await chamar("POST", `/contas-receber/${filha.id}/cancelar`, { motivo: "Perdoado", supervisor: SUP })).status).toBe(200);
    const l = (await ctx.db.selectFrom("fin_lancamento").select("id").where("referencia_id", "=", p2.id).executeTakeFirstOrThrow()).id;
    expect((await chamar("POST", `/lancamentos/${l}/estornar`, { motivo: "Engano", supervisor: SUP })).status).toBe(200);
    expect((await posicao()).find((i) => i.id === p2.id)).toMatchObject({ valor_original: 10000, valor_recebido: 0, situacao: "aberto" });
  });

  test("a receber: recebimento parcial estornado e refeito volta ao valor cheio", async () => {
    await receber();
    const [, p2] = (await posicao()).sort((a, b) => a.parcela_num - b.parcela_num);
    await receberParcela(p2.id, 10000, "2027-01-25");
    const l = (await ctx.db.selectFrom("fin_lancamento").select("id").where("referencia_id", "=", p2.id).executeTakeFirstOrThrow()).id;
    await chamar("POST", `/lancamentos/${l}/estornar`, { motivo: "Engano", supervisor: SUP });
    expect((await posicao()).find((i) => i.id === p2.id)).toMatchObject({ valor_original: 25000, valor_recebido: 0, situacao: "aberto" });
  });

  test("forma de cobrança que a conta a receber não sabe receber é recusada ao criar o título", async () => {
    expect((await receber({ forma_pagamento: "cheque" })).status).toBe(400);
    expect((await receber({ forma_pagamento: "pix", documento: "EV-PIX" })).status).toBe(201);
  });

  test("recebimento de conta manual aparece como manual no lançamento", async () => {
    await receber();
    const [p1] = (await posicao()).sort((a, b) => a.parcela_num - b.parcela_num);
    await receberParcela(p1.id, 25000);
    expect((await ctx.db.selectFrom("fin_lancamento").select("origem").where("referencia_id", "=", p1.id).executeTakeFirstOrThrow()).origem).toBe("manual");
  });
});
