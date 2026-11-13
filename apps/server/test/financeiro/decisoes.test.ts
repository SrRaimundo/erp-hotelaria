import { beforeEach, describe, expect, test } from "vitest";
import { processarPagamentoRegistrado } from "../../src/financeiro/consumidores-eventos/hospedagem-pagamento.js";
import { criarApp } from "../../src/http/app.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let app: ReturnType<typeof criarApp>;
let admin: { authorization: string };
let local: any;
let caixa: any;
let cat: string;
const CRIADO = "2026-11-10T15:00:00.000Z";
const SUP = { login: "admin", senha: "admin" };

const chamar = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) => {
  const r = await app.inject({ method, url: `/api/financeiro${url}`, headers: admin, payload: payload as any });
  return { status: r.statusCode, corpo: r.json() as any };
};
const saldo = async () => (await chamar("GET", `/contas?local_id=${local.id}`)).corpo.find((c: any) => c.id === caixa.id).saldo as number;

beforeEach(async () => {
  ctx = await criarContextoTeste();
  app = criarApp(ctx);
  admin = await entrarComo(ctx, "admin");
  local = (await chamar("POST", "/locais", { nome: "Pousada" })).corpo;
  caixa = (await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0];
  cat = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 2, maxCriancas: 0, comodidades: [] }, "u1")).id;
});

/** Hóspede + conta + reserva + valor a receber + faturamento aberto, tudo ligado como o checkout faturado deixa. */
async function checkoutFaturado(n: number, clienteId: string, valor: number, nome = `Hóspede ${n}`) {
  await salvarHospede(ctx, { id: `h${n}`, nome, documentoTipo: "cpf", documento: null, nascimento: "1990-01-01", nacionalidade: "BR" }, "u1");
  await ctx.db.insertInto("contas").values({ id: `c${n}`, titular_id: `h${n}`, situacao: "fechada" }).execute();
  await ctx.db.insertInto("reservas").values({ id: `r${n}`, codigo: 100 + n, estado: "finalizada", titular_id: `h${n}`, categoria_id: cat, quarto_id: null, chegada: `2026-11-0${n}`, saida: `2026-11-0${n + 2}`, adultos: 1, criancas: "[]", canal: "Balcao", conta_id: `c${n}`, valor_sinal: 0, criada_em: CRIADO } as any).execute();
  await ctx.db.insertInto("valores_a_receber").values({ id: `v${n}`, conta_id: `c${n}`, reserva_id: `r${n}`, responsavel_nome: "Empresa", responsavel_documento: "1", valor, criado_em: CRIADO, situacao: "aberto" }).execute();
  if (!(await ctx.db.selectFrom("fin_cliente").select("id").where("id", "=", clienteId).executeTakeFirst())) {
    await ctx.db.insertInto("fin_cliente").values({ id: clienteId, local_id: local.id, nome: `Cliente ${clienteId}`, cpf_cnpj: null, tipo: "pessoa_juridica", contato: null, criado_em: CRIADO }).execute();
  }
  await ctx.db.insertInto("fin_faturamento").values({ id: `f${n}`, local_id: local.id, cliente_id: clienteId, referencia_id: `v${n}`, valor_original: valor, valor_liquido: valor, data_vencimento: "2026-12-01T12:00:00Z", forma_cobranca: "boleto", numero_documento: null, status: "aberto", lançamentos_id: "[]", criado_em: CRIADO }).execute();
}

describe("Faturamento: várias fechamentos do mesmo cliente numa fatura", () => {
  test("uma fatura, um documento, uma conta a receber pela soma; extrato lista cada fechamento", async () => {
    await checkoutFaturado(1, "A", 30000, "Ana Silva");
    await checkoutFaturado(2, "A", 45000, "Bruno Costa");
    const r = await chamar("POST", "/faturamentos/fechar-grupo", { ids: ["f1", "f2"], forma: "pix", data_vencimento: "2026-12-20" });
    expect(r.status).toBe(200);
    const numero = r.corpo.numero_documento as string;
    expect(numero).toMatch(/^FAT-/);
    const recs = (await ctx.db.selectFrom("fin_conta_receber").selectAll().execute()) as any[];
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ valor_original: 75000, numero_documento: numero });
    const fats = (await ctx.db.selectFrom("fin_faturamento").select("numero_documento").execute()) as any[];
    expect(fats.every((f) => f.numero_documento === numero)).toBe(true);

    const ex = (await chamar("GET", `/faturamentos/extrato?local_id=${local.id}&numero=${numero}`)).corpo;
    expect(ex).toMatchObject({ numero_documento: numero, total: 75000, cliente: { nome: "Cliente A" } });
    expect(ex.itens).toHaveLength(2);
    expect(ex.itens[0]).toMatchObject({ reserva_codigo: 101, hospede: "Ana Silva", chegada: "2026-11-01", saida: "2026-11-03", valor: 30000 });
    expect(ex.itens[1]).toMatchObject({ reserva_codigo: 102, hospede: "Bruno Costa", valor: 45000 });

    await chamar("PUT", `/contas-receber/${recs[0].id}/confirmar-pagamento`, { valor: 75000, conta_bancaria_id: caixa.id });
    const depois = (await ctx.db.selectFrom("fin_faturamento").select("status").execute()) as any[];
    expect(depois.map((f) => f.status)).toEqual(["pago", "pago"]);
    expect(await saldo()).toBe(75000);
  });

  test("clientes diferentes, fechamento já fechado ou lista vazia são recusados e nada muda", async () => {
    await checkoutFaturado(1, "A", 1000);
    await checkoutFaturado(2, "B", 2000);
    await checkoutFaturado(3, "A", 3000);
    const corpo = (ids: string[]) => ({ ids, forma: "pix", data_vencimento: "2026-12-20" });
    expect((await chamar("POST", "/faturamentos/fechar-grupo", corpo(["f1", "f2"]))).status).toBe(422);
    expect((await chamar("POST", "/faturamentos/fechar-grupo", corpo([]))).status).toBe(400);
    expect((await chamar("POST", "/faturamentos/fechar-grupo", corpo(["f1", "f1"]))).status).toBe(422);
    expect((await ctx.db.selectFrom("fin_conta_receber").selectAll().execute())).toHaveLength(0);
    expect((await chamar("POST", "/faturamentos/fechar-grupo", corpo(["f1"]))).status).toBe(200);
    expect((await chamar("POST", "/faturamentos/fechar-grupo", corpo(["f1", "f3"]))).status).toBe(422);
    expect((await ctx.db.selectFrom("fin_conta_receber").selectAll().execute())).toHaveLength(1);
  });

  test("estornar o recebimento da fatura agrupada volta todos os fechamentos a aberto", async () => {
    await checkoutFaturado(1, "A", 1000);
    await checkoutFaturado(2, "A", 2000);
    await chamar("POST", "/faturamentos/fechar-grupo", { ids: ["f1", "f2"], forma: "pix", data_vencimento: "2026-12-20" });
    const rec = (await ctx.db.selectFrom("fin_conta_receber").select("id").executeTakeFirstOrThrow()).id;
    await chamar("PUT", `/contas-receber/${rec}/confirmar-pagamento`, { valor: 3000, conta_bancaria_id: caixa.id });
    const l = (await ctx.db.selectFrom("fin_lancamento").select("id").where("referencia_tipo", "=", "conta_receber").executeTakeFirstOrThrow()).id;
    await chamar("POST", `/lancamentos/${l}/estornar`, { motivo: "Engano", supervisor: SUP });
    const st = ((await ctx.db.selectFrom("fin_faturamento").select("status").execute()) as any[]).map((f) => f.status);
    expect(st).toEqual(["aberto", "aberto"]);
  });
});

describe("Cobrança: condições do cartão por adquirente", () => {
  const cond = (extra: object = {}) => ({ local_id: local.id, adquirente: "Cielo", bandeira: "Visa", tipo: "credito", prazo_dias: 31, taxa_percentual: 3.2, ...extra });

  test("cadastro: cria, lista, edita, desativa; prazo D+N qualquer e taxa validados", async () => {
    const c = await chamar("POST", "/cobranca/condicoes", cond());
    expect(c.status).toBe(201);
    expect(c.corpo).toMatchObject({ adquirente: "Cielo", bandeira: "Visa", tipo: "credito", prazo_dias: 31, taxa_percentual: 3.2, ativo: true });
    expect((await chamar("POST", "/cobranca/condicoes", cond({ prazo_dias: 45, bandeira: "Elo" }))).status).toBe(201);
    expect((await chamar("POST", "/cobranca/condicoes", cond({ prazo_dias: -1 }))).status).toBe(400);
    expect((await chamar("POST", "/cobranca/condicoes", cond({ taxa_percentual: 100 }))).status).toBe(400);
    expect((await chamar("POST", "/cobranca/condicoes", cond({ tipo: "cheque" }))).status).toBe(400);
    expect((await chamar("GET", `/cobranca/condicoes?local_id=${local.id}`)).corpo).toHaveLength(2);
    const e = await chamar("PUT", `/cobranca/condicoes/${c.corpo.id}`, { taxa_percentual: 2.9, ativo: false });
    expect(e.corpo).toMatchObject({ taxa_percentual: 2.9, ativo: false });
  });

  test("movimento guarda uma cópia do prazo e da taxa: mudar o cadastro depois não altera o histórico", async () => {
    const c = (await chamar("POST", "/cobranca/condicoes", cond())).corpo;
    const m = await chamar("POST", "/cartao/movimentos", { local_id: local.id, data: "2026-11-10", tipo: "credito", valor: 10000, informado: "bruto", condicao_id: c.id });
    expect(m.status).toBe(201);
    expect(m.corpo).toMatchObject({ adquirente: "Cielo", bandeira: "Visa", prazo_dias: 31, taxa_percentual: 3.2, valor_taxa: 320, valor_liquido: 9680, previsao: "2026-12-11", revisar: 0 });
    await chamar("PUT", `/cobranca/condicoes/${c.id}`, { taxa_percentual: 9, prazo_dias: 5 });
    const depois = (await chamar("GET", `/cartao/movimentos?local_id=${local.id}`)).corpo[0];
    expect(depois).toMatchObject({ taxa_percentual: 3.2, prazo_dias: 31, previsao: "2026-12-11" });
  });

  test("sem condição nem taxa e prazo informados, o movimento manual é recusado (sem padrão escondido)", async () => {
    const r = await chamar("POST", "/cartao/movimentos", { local_id: local.id, data: "2026-11-10", bandeira: "Visa", tipo: "credito", valor: 1000, informado: "bruto" });
    expect(r.status).toBe(400);
  });

  async function pagamentoCartao(forma: string, id: string) {
    await salvarHospede(ctx, { id: "hh", nome: "Maria", documentoTipo: "cpf", documento: "52998224725", nascimento: "1990-01-01", nacionalidade: "BR" }, "u1").catch(() => undefined);
    if (!(await ctx.db.selectFrom("contas").select("id").where("id", "=", "cx").executeTakeFirst())) {
      await ctx.db.insertInto("contas").values({ id: "cx", titular_id: "hh", situacao: "aberta" }).execute();
      await ctx.db.insertInto("reservas").values({ id: "rx", codigo: 9, estado: "hospedada", titular_id: "hh", categoria_id: cat, quarto_id: null, chegada: "2026-11-10", saida: "2026-11-12", adultos: 1, criancas: "[]", canal: "Balcao", conta_id: "cx", valor_sinal: 0, criada_em: CRIADO } as any).execute();
    }
    await processarPagamentoRegistrado(ctx, { criadoEm: CRIADO, payload: { pagamentoId: id, contaId: "cx", reservaId: "rx", formaCodigo: forma, valor: 10000 } });
    return (await chamar("GET", `/cartao/movimentos?local_id=${local.id}`)).corpo.find((m: any) => m.lancamento_id && m.valor_bruto === 10000 && m.id);
  }

  test("pagamento de cartão da hospedagem com uma única condição do tipo usa essa condição", async () => {
    await chamar("POST", "/cobranca/condicoes", cond({ tipo: "debito", prazo_dias: 1, taxa_percentual: 1.5 }));
    const m = await pagamentoCartao("debito", "p1");
    expect(m).toMatchObject({ adquirente: "Cielo", prazo_dias: 1, taxa_percentual: 1.5, valor_taxa: 150, valor_liquido: 9850, previsao: "2026-11-11", revisar: 0 });
  });

  test("sem condição (ou ambígua): entra sinalizado para revisão, sem taxa nem prazo inventados; a baixa exige informar a condição", async () => {
    const m = await pagamentoCartao("credito", "p2");
    expect(m).toMatchObject({ revisar: 1, taxa_percentual: 0, bandeira: "Não informada" });
    const sem = await chamar("PUT", `/cartao/movimentos/${m.id}/baixar`, { conta_id: caixa.id });
    expect(sem.status).toBe(422);
    expect(sem.corpo.mensagem).toMatch(/condição/i);
    const c = (await chamar("POST", "/cobranca/condicoes", cond())).corpo;
    const ok = await chamar("PUT", `/cartao/movimentos/${m.id}/baixar`, { conta_id: caixa.id, condicao_id: c.id });
    expect(ok.status).toBe(200);
    expect(ok.corpo).toMatchObject({ revisar: 0, taxa_percentual: 3.2, valor_taxa: 320, valor_liquido: 9680, status: "baixado" });
    expect(await saldo()).toBe(9680);
  });

  test("duas condições do mesmo tipo: ambíguo, vai para revisão", async () => {
    await chamar("POST", "/cobranca/condicoes", cond());
    await chamar("POST", "/cobranca/condicoes", cond({ adquirente: "Stone", bandeira: "Master" }));
    const m = await pagamentoCartao("credito", "p3");
    expect(m.revisar).toBe(1);
  });
});

describe("Pagamento parcial com saldo reprogramado", () => {
  test("contas a pagar: paga parte, o restante vira nova parcela vinculada; soma = original", async () => {
    const c = (await chamar("POST", "/contas-a-pagar", { local_id: local.id, descricao: "Fornecedor X", categoria: "fornecedor", valor: 100000, vencimento: "2026-11-20" })).corpo;
    expect((await chamar("PUT", `/contas-a-pagar/${c.id}/baixar`, { conta_id: caixa.id, valor: 40000 })).status).toBe(422); // sem nova data
    const r = await chamar("PUT", `/contas-a-pagar/${c.id}/baixar`, { conta_id: caixa.id, valor: 40000, novo_vencimento: "2026-12-15" });
    expect(r.status).toBe(200);
    expect(await saldo()).toBe(-40000);
    const lista = (await chamar("GET", `/lancamentos?local_id=${local.id}&tipo=pagamento`)).corpo;
    const pago = lista.find((l: any) => l.id === c.id);
    const resto = lista.find((l: any) => l.parcela_de === c.id);
    expect(pago).toMatchObject({ status: "confirmado", valor: 40000, valor_total: 100000 });
    expect(resto).toMatchObject({ status: "pendente", valor: 60000, vencimento_dia: "2026-12-15", descricao: "Fornecedor X" });
    expect(pago.valor + resto.valor).toBe(100000);
    // parcela do saldo pode ser paga por inteiro, sem nova parcela
    expect((await chamar("PUT", `/contas-a-pagar/${resto.id}/baixar`, { conta_id: caixa.id })).status).toBe(200);
    expect(await saldo()).toBe(-100000);
  });

  test("valor maior que o devido ou zero é recusado; valor igual ao total quita sem nova parcela", async () => {
    const c = (await chamar("POST", "/contas-a-pagar", { local_id: local.id, descricao: "Y", categoria: "servico", valor: 5000, vencimento: "2026-11-20" })).corpo;
    expect((await chamar("PUT", `/contas-a-pagar/${c.id}/baixar`, { conta_id: caixa.id, valor: 6000, novo_vencimento: "2026-12-01" })).status).toBe(422);
    expect((await chamar("PUT", `/contas-a-pagar/${c.id}/baixar`, { conta_id: caixa.id, valor: 0 })).status).toBe(400);
    expect((await chamar("PUT", `/contas-a-pagar/${c.id}/baixar`, { conta_id: caixa.id, valor: 5000 })).status).toBe(200);
    expect((await chamar("GET", `/lancamentos?local_id=${local.id}&tipo=pagamento`)).corpo).toHaveLength(1);
  });

  test("estornar o pagamento parcial remove a parcela do saldo se intocada; se já mexeram, recusa com clareza", async () => {
    const c = (await chamar("POST", "/contas-a-pagar", { local_id: local.id, descricao: "Z", categoria: "servico", valor: 100000, vencimento: "2026-11-20" })).corpo;
    await chamar("PUT", `/contas-a-pagar/${c.id}/baixar`, { conta_id: caixa.id, valor: 40000, novo_vencimento: "2026-12-15" });
    const resto = (await chamar("GET", `/lancamentos?local_id=${local.id}&tipo=pagamento`)).corpo.find((l: any) => l.parcela_de === c.id);
    // mexeram na parcela: pagaram parte dela
    await chamar("PUT", `/contas-a-pagar/${resto.id}/baixar`, { conta_id: caixa.id, valor: 10000, novo_vencimento: "2026-12-30" });
    const recusa = await chamar("POST", `/lancamentos/${c.id}/estornar`, { motivo: "Engano", supervisor: SUP });
    expect(recusa.status).toBe(422);
    expect(recusa.corpo.mensagem).toMatch(/parcela|saldo/i);
    expect(await saldo()).toBe(-50000);
  });

  test("estornar com a parcela do saldo intocada remove a parcela e devolve o saldo", async () => {
    const c = (await chamar("POST", "/contas-a-pagar", { local_id: local.id, descricao: "Z", categoria: "servico", valor: 100000, vencimento: "2026-11-20" })).corpo;
    await chamar("PUT", `/contas-a-pagar/${c.id}/baixar`, { conta_id: caixa.id, valor: 40000, novo_vencimento: "2026-12-15" });
    const r = await chamar("POST", `/lancamentos/${c.id}/estornar`, { motivo: "Engano", supervisor: SUP });
    expect(r.status).toBe(200);
    expect(await saldo()).toBe(0);
    const lista = (await chamar("GET", `/lancamentos?local_id=${local.id}&tipo=pagamento`)).corpo;
    expect(lista.find((l: any) => l.parcela_de === c.id).status).toBe("cancelado");
  });

  async function receber100() {
    await checkoutFaturado(1, "A", 100000);
    await chamar("POST", "/faturamentos/fechar-grupo", { ids: ["f1"], forma: "pix", data_vencimento: "2026-12-10" });
    return (await ctx.db.selectFrom("fin_conta_receber").selectAll().executeTakeFirstOrThrow()) as any;
  }
  const receberParcial = (id: string, valor: number, novo?: string) =>
    chamar("PUT", `/contas-receber/${id}/confirmar-pagamento`, { valor, conta_bancaria_id: caixa.id, novo_vencimento: novo });

  test("contas a receber: parcial exige nova data; quita a parte e cria parcela do saldo vinculada", async () => {
    const rec = await receber100();
    expect((await receberParcial(rec.id, 30000)).status).toBe(422);
    const r = await receberParcial(rec.id, 30000, "2026-12-30");
    expect(r.status).toBe(200);
    expect(await saldo()).toBe(30000);
    const todas = (await ctx.db.selectFrom("fin_conta_receber").selectAll().orderBy("criado_em").execute()) as any[];
    expect(todas).toHaveLength(2);
    const pai = todas.find((x) => x.id === rec.id);
    const filha = todas.find((x) => x.parcela_de === rec.id);
    expect(pai).toMatchObject({ valor_original: 30000, valor_recebido: 30000, status: "recebido", valor_total: 100000 });
    expect(filha).toMatchObject({ valor_original: 70000, valor_recebido: 0, status: "pendente" });
    expect(filha.data_vencimento).toContain("2026-12-30");
    expect(pai.valor_original + filha.valor_original).toBe(100000);
    // a fatura só fica paga quando a última parcela é quitada
    expect((await ctx.db.selectFrom("fin_faturamento").select("status").executeTakeFirstOrThrow()).status).toBe("parcialmente_pago");
    await receberParcial(filha.id, 70000);
    expect((await ctx.db.selectFrom("fin_faturamento").select("status").executeTakeFirstOrThrow()).status).toBe("pago");
    expect(await saldo()).toBe(100000);
  });

  test("estornar o recebimento parcial remove a parcela do saldo intocada e restaura o original; mexida: recusa", async () => {
    const rec = await receber100();
    await receberParcial(rec.id, 30000, "2026-12-30");
    const l = (await ctx.db.selectFrom("fin_lancamento").select("id").where("referencia_id", "=", rec.id).where("referencia_tipo", "=", "conta_receber").executeTakeFirstOrThrow()).id;
    const r = await chamar("POST", `/lancamentos/${l}/estornar`, { motivo: "Engano", supervisor: SUP });
    expect(r.status).toBe(200);
    expect(await saldo()).toBe(0);
    const todas = (await ctx.db.selectFrom("fin_conta_receber").selectAll().execute()) as any[];
    expect(todas.find((x) => x.id === rec.id)).toMatchObject({ valor_original: 100000, valor_recebido: 0, status: "pendente" });
    expect(todas.find((x) => x.parcela_de === rec.id).status).toBe("cancelado");
    expect((await ctx.db.selectFrom("fin_faturamento").select("status").executeTakeFirstOrThrow()).status).toBe("aberto");

    // nova rodada: agora a filha é tocada
    await receberParcial(rec.id, 20000, "2026-12-31");
    const filha = ((await ctx.db.selectFrom("fin_conta_receber").selectAll().where("parcela_de", "=", rec.id).where("status", "!=", "cancelado").execute()) as any[])[0];
    await receberParcial(filha.id, 10000, "2027-01-15");
    const l2 = ((await ctx.db.selectFrom("fin_lancamento").select("id").where("referencia_id", "=", rec.id).where("referencia_tipo", "=", "conta_receber").where("valor", "=", 20000).execute()) as any[])[0].id;
    const recusa = await chamar("POST", `/lancamentos/${l2}/estornar`, { motivo: "Engano", supervisor: SUP });
    expect(recusa.status).toBe(422);
    expect(recusa.corpo.mensagem).toMatch(/parcela|saldo/i);
  });
});
