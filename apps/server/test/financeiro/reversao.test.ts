import { beforeEach, describe, expect, test } from "vitest";
import { processarPendentes } from "../../src/financeiro/consumidores-eventos/fila.js";
import { criarApp } from "../../src/http/app.js";
import { registrarEvento } from "../../src/infra/outbox.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import { emTransacao } from "../../src/shared/contexto.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let app: ReturnType<typeof criarApp>;
let admin: { authorization: string };
let local: any;
let caixa: any;
const CRIADO = "2026-11-10T15:00:00.000Z";
const SUP = { login: "admin", senha: "admin" };

const chamar = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) => {
  const r = await app.inject({ method, url: `/api/financeiro${url}`, headers: admin, payload: payload as any });
  return { status: r.statusCode, corpo: r.json() as any };
};
const saldo = async () => (await chamar("GET", `/contas?local_id=${local.id}`)).corpo.find((c: any) => c.id === caixa.id).saldo as number;
const publicar = (tipo: string, payload: object) => emTransacao(ctx, (tx) => registrarEvento(tx, tipo, payload));
const alertas = (tipo: string) => ctx.db.selectFrom("alertas").selectAll().where("tipo", "=", tipo).where("resolvido_em", "is", null).execute();

beforeEach(async () => {
  ctx = await criarContextoTeste();
  app = criarApp(ctx);
  admin = await entrarComo(ctx, "admin");
  local = (await chamar("POST", "/locais", { nome: "Pousada" })).corpo;
  caixa = (await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0];
  const cat = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 2, maxCriancas: 0, comodidades: [] }, "u1")).id;
  await salvarHospede(ctx, { id: "h1", nome: "Maria", documentoTipo: "cpf", documento: "52998224725", nascimento: "1990-01-01", nacionalidade: "BR" }, "u1");
  await ctx.db.insertInto("contas").values({ id: "c1", titular_id: "h1", situacao: "aberta" }).execute();
  await ctx.db.insertInto("reservas").values({
    id: "r1", codigo: 1, estado: "hospedada", titular_id: "h1", categoria_id: cat, quarto_id: null, chegada: "2026-11-10", saida: "2026-11-12",
    adultos: 1, criancas: "[]", canal: "Balcao", conta_id: "c1", valor_sinal: 0, criada_em: CRIADO,
  } as any).execute();
});

async function fatura(valor = 90000) {
  await ctx.db.insertInto("fin_cliente").values({ id: "cli1", local_id: local.id, nome: "Empresa X", cpf_cnpj: null, tipo: "pessoa_juridica", contato: null, criado_em: CRIADO }).execute();
  await ctx.db.insertInto("fin_faturamento").values({
    id: "fat1", local_id: local.id, cliente_id: "cli1", referencia_id: "ref1", valor_original: valor, valor_liquido: valor,
    data_vencimento: "2026-12-01T12:00:00Z", forma_cobranca: "boleto", numero_documento: null, status: "aberto", lançamentos_id: "[]", criado_em: CRIADO,
  }).execute();
  expect((await chamar("POST", "/faturamentos/fat1/fechar", { forma: "pix", data_vencimento: "2026-12-10" })).status).toBe(200);
  return (await ctx.db.selectFrom("fin_conta_receber").selectAll().executeTakeFirstOrThrow()) as any;
}
const receber = (id: string, valor: number, novo?: string) => chamar("PUT", `/contas-receber/${id}/confirmar-pagamento`, { valor, conta_bancaria_id: caixa.id, novo_vencimento: novo });
const lancReceb = async () => (await ctx.db.selectFrom("fin_lancamento").selectAll().where("referencia_tipo", "=", "conta_receber").executeTakeFirstOrThrow()) as any;

describe("estorno de recebimento (uma regra, uma rota, uma vez)", () => {
  test("estornar recebimento parcial devolve saldo, conta a receber e fatura; segunda vez e cancelar depois são recusados", async () => {
    const rec = await fatura();
    await receber(rec.id, 30000, "2026-12-30");
    expect(await saldo()).toBe(30000);
    const l = await lancReceb();

    const r = await chamar("POST", `/lancamentos/${l.id}/estornar`, { motivo: "Valor digitado errado", supervisor: SUP });
    expect(r.status).toBe(200);
    expect(await saldo()).toBe(0);
    const depois = (await ctx.db.selectFrom("fin_conta_receber").selectAll().where("id", "=", rec.id).executeTakeFirstOrThrow()) as any;
    expect(depois).toMatchObject({ valor_recebido: 0, status: "pendente" });
    expect(JSON.parse(depois.lançamentos_id)).toEqual([]);
    expect((await ctx.db.selectFrom("fin_faturamento").select("status").executeTakeFirstOrThrow()).status).toBe("aberto");

    expect((await chamar("POST", `/lancamentos/${l.id}/estornar`, { motivo: "de novo", supervisor: SUP })).status).toBe(422);
    expect((await chamar("DELETE", `/lancamentos/${l.id}`, { motivo: "de novo", supervisor: SUP })).status).toBe(422);
    expect(await saldo()).toBe(0);
    // pode receber de novo o valor correto
    expect((await receber(rec.id, 90000)).status).toBe(200);
    expect(await saldo()).toBe(90000);
  });

  test("cancelar recebimento quitado volta a fatura a aberto; estornar depois é recusado", async () => {
    const rec = await fatura();
    await receber(rec.id, 90000);
    expect((await ctx.db.selectFrom("fin_faturamento").select("status").executeTakeFirstOrThrow()).status).toBe("pago");
    const l = await lancReceb();
    expect((await chamar("DELETE", `/lancamentos/${l.id}`, { motivo: "Conta errada", supervisor: SUP })).status).toBe(200);
    expect(await saldo()).toBe(0);
    expect((await ctx.db.selectFrom("fin_conta_receber").selectAll().executeTakeFirstOrThrow() as any)).toMatchObject({ valor_recebido: 0, status: "pendente" });
    expect((await ctx.db.selectFrom("fin_faturamento").select("status").executeTakeFirstOrThrow()).status).toBe("aberto");
    expect((await chamar("POST", `/lancamentos/${l.id}/estornar`, { motivo: "x", supervisor: SUP })).status).toBe(422);
    expect(await saldo()).toBe(0);
  });

  test("com o estornar de um recebimento parcial entre dois, só o escolhido some", async () => {
    const rec = await fatura();
    await receber(rec.id, 30000, "2026-12-30");
    const filha = (await ctx.db.selectFrom("fin_conta_receber").selectAll().where("parcela_de", "=", rec.id).executeTakeFirstOrThrow()) as any;
    await receber(filha.id, 20000, "2027-01-30");
    const ls = (await ctx.db.selectFrom("fin_lancamento").selectAll().where("referencia_tipo", "=", "conta_receber").execute()) as any[];
    await chamar("POST", `/lancamentos/${ls.find((x) => x.valor === 20000).id}/estornar`, { motivo: "Engano", supervisor: SUP });
    expect(await saldo()).toBe(30000);
    expect((await ctx.db.selectFrom("fin_conta_receber").selectAll().where("id", "=", rec.id).executeTakeFirstOrThrow() as any)).toMatchObject({ valor_recebido: 30000, status: "recebido" });
    expect((await ctx.db.selectFrom("fin_conta_receber").selectAll().where("id", "=", filha.id).executeTakeFirstOrThrow() as any)).toMatchObject({ valor_original: 60000, valor_recebido: 0, status: "pendente" });
  });

  test("estornar cartão já baixado cancela o movimento e tira do liquidado", async () => {
    const m = (await chamar("POST", "/cartao/movimentos", { local_id: local.id, data: "2026-11-10", bandeira: "Visa", tipo: "credito", valor: 10000, prazo_dias: 30, informado: "bruto", taxa_percentual: 2 })).corpo;
    await chamar("PUT", `/cartao/movimentos/${m.id}/baixar`, { conta_id: caixa.id });
    expect(await saldo()).toBe(9800);
    const r = await chamar("POST", `/lancamentos/${m.lancamento_id}/estornar`, { motivo: "Venda desfeita", supervisor: SUP });
    expect(r.status).toBe(200);
    expect(await saldo()).toBe(0);
    expect((await chamar("GET", `/cartao/movimentos?local_id=${local.id}`)).corpo[0].status).toBe("cancelado");
    const rel = (await chamar("GET", `/relatorios/cartao?local_id=${local.id}`)).corpo;
    expect(rel.liquidado).toEqual({ quantidade: 0, valor: 0 });
  });

  test("senha de supervisor errada ou motivo vazio não estorna", async () => {
    const rec = await fatura();
    await receber(rec.id, 1000, "2026-12-30");
    const l = await lancReceb();
    expect((await chamar("POST", `/lancamentos/${l.id}/estornar`, { motivo: "x", supervisor: { login: "admin", senha: "errada" } })).status).toBe(422);
    expect((await chamar("POST", `/lancamentos/${l.id}/estornar`, { motivo: " ", supervisor: SUP })).status).toBeGreaterThanOrEqual(400);
    expect(await saldo()).toBe(1000);
  });
});

describe("PagamentoEstornado da hospedagem (C1)", () => {
  const pag = (pagamentoId: string, formaCodigo: string, valor = 5000) => ({ pagamentoId, contaId: "c1", reservaId: "r1", formaCodigo, valor });
  const estorno = (pagamentoId: string, valor = 5000) => ({ pagamentoId, estornoId: `e-${pagamentoId}`, contaId: "c1", reservaId: "r1", valor: -valor });

  test("pagamento em dinheiro/pix estornado: lançamento cancelado, saldo volta, só uma vez", async () => {
    await publicar("hospedagem.PagamentoRegistrado", pag("p1", "pix"));
    await processarPendentes(ctx);
    expect(await saldo()).toBe(5000);
    await publicar("hospedagem.PagamentoEstornado", estorno("p1"));
    await processarPendentes(ctx);
    expect(await saldo()).toBe(0);
    expect((await ctx.db.selectFrom("fin_lancamento").select("status").executeTakeFirstOrThrow()).status).toBe("cancelado");
    // o mesmo estorno chegando de novo não mexe de novo
    await publicar("hospedagem.PagamentoEstornado", estorno("p1"));
    await processarPendentes(ctx);
    expect(await saldo()).toBe(0);
    expect(await ctx.db.selectFrom("fin_movimento").selectAll().execute()).toHaveLength(2);
  });

  test("cartão ainda a receber: o movimento é cancelado", async () => {
    await publicar("hospedagem.PagamentoRegistrado", pag("p2", "credito"));
    await publicar("hospedagem.PagamentoEstornado", estorno("p2"));
    await processarPendentes(ctx);
    expect((await ctx.db.selectFrom("fin_cartao_movimento").select("status").executeTakeFirstOrThrow()).status).toBe("cancelado");
    expect((await chamar("GET", `/relatorios/cartao?local_id=${local.id}`)).corpo.aberto.quantidade).toBe(0);
  });

  test("cartão já baixado: nada muda sozinho e abre alerta para decisão manual", async () => {
    await chamar("POST", "/cobranca/condicoes", { local_id: local.id, adquirente: "Cielo", bandeira: "Visa", tipo: "credito", prazo_dias: 30, taxa_percentual: 0 });
    await publicar("hospedagem.PagamentoRegistrado", pag("p3", "credito"));
    await processarPendentes(ctx);
    const m = (await chamar("GET", `/cartao/movimentos?local_id=${local.id}`)).corpo[0];
    await chamar("PUT", `/cartao/movimentos/${m.id}/baixar`, { conta_id: caixa.id });
    await publicar("hospedagem.PagamentoEstornado", estorno("p3"));
    const r = await processarPendentes(ctx);
    expect(r.falhou).toBeUndefined();
    expect(await saldo()).toBe(5000);
    expect((await chamar("GET", `/cartao/movimentos?local_id=${local.id}`)).corpo[0].status).toBe("baixado");
    const a = await alertas("financeiro_estorno_conciliado");
    expect(a).toHaveLength(1);
    expect(a[0]!.mensagem).toMatch(/baixado/i);
  });

  test("faturado ainda aberto em Faturamento: é cancelado; já fechado: alerta", async () => {
    for (const [pid, vid, val] of [["pf1", "v1", 7000], ["pf2", "v2", 8000]] as const) {
      await ctx.db.insertInto("pagamentos").values({ id: pid, conta_id: "c1", reserva_id: "r1", forma_codigo: "faturado", valor: val, estorna_id: null, turno_id: null, instante: CRIADO, usuario: "usuario-admin" } as any).execute();
      await ctx.db.insertInto("valores_a_receber").values({ id: vid, conta_id: "c1", reserva_id: "r1", responsavel_nome: `Emp ${vid}`, responsavel_documento: `1122233300018${vid.slice(1)}`, valor: val, criado_em: CRIADO, situacao: "aberto" }).execute();
      await publicar("hospedagem.ValorAReceberCriado", { valorAReceberId: vid, contaId: "c1", reservaId: "r1", valor: val });
    }
    await processarPendentes(ctx);
    const fats = (await ctx.db.selectFrom("fin_faturamento").selectAll().orderBy("referencia_id").execute()) as any[];
    expect(fats).toHaveLength(2);
    expect((await chamar("POST", `/faturamentos/${fats[1].id}/fechar`, { forma: "pix", data_vencimento: "2026-12-10" })).status).toBe(200);
    await publicar("hospedagem.PagamentoEstornado", { ...estorno("pf1", 7000), pagamentoId: "pf1" });
    await publicar("hospedagem.PagamentoEstornado", { ...estorno("pf2", 8000), pagamentoId: "pf2" });
    await processarPendentes(ctx);
    const depois = (await ctx.db.selectFrom("fin_faturamento").selectAll().orderBy("referencia_id").execute()) as any[];
    expect(depois[0].status).toBe("cancelado");
    expect(depois[1].status).not.toBe("cancelado");
    expect(await alertas("financeiro_estorno_conciliado")).toHaveLength(1);
  });

  test("estorno de pagamento sem lançamento (forma ignorada) é consumido sem erro", async () => {
    await publicar("hospedagem.PagamentoEstornado", estorno("desconhecido"));
    const r = await processarPendentes(ctx);
    expect(r.falhou).toBeUndefined();
    expect(r.processados).toBe(1);
  });
});

describe("taxa do cartão como despesa só de registro", () => {
  const baixado = async () => {
    const m = (await chamar("POST", "/cartao/movimentos", { local_id: local.id, data: "2026-11-10", bandeira: "Visa", tipo: "credito", valor: 10000, prazo_dias: 30, informado: "bruto", taxa_percentual: 2.5 })).corpo;
    await chamar("PUT", `/cartao/movimentos/${m.id}/baixar`, { conta_id: caixa.id });
    return m;
  };
  const taxasNaLista = async () =>
    (await chamar("GET", `/lancamentos?local_id=${local.id}&tipo=pagamento`)).corpo.filter((l: any) => l.categoria === "taxa_cartao");

  test("a conta recebe só o líquido; a taxa aparece uma vez em Contas a Pagar, já quitada, sem movimento", async () => {
    await baixado();
    expect(await saldo()).toBe(9750);
    expect(await ctx.db.selectFrom("fin_movimento").selectAll().execute()).toHaveLength(1);
    const taxas = await taxasNaLista();
    expect(taxas).toHaveLength(1);
    expect(taxas[0]).toMatchObject({ valor: 250, status: "liquidado", referencia_tipo: "taxa_cartao" });
    expect(taxas[0].descricao).toMatch(/Visa/);
  });

  test("não pode ser paga, cancelada nem estornada sozinha", async () => {
    await baixado();
    const [t] = await taxasNaLista();
    expect((await chamar("PUT", `/contas-a-pagar/${t.id}/baixar`, { conta_id: caixa.id })).status).toBe(422);
    expect((await chamar("DELETE", `/lancamentos/${t.id}`, { motivo: "x", supervisor: SUP })).status).toBe(422);
    expect((await chamar("POST", `/lancamentos/${t.id}/estornar`, { motivo: "x", supervisor: SUP })).status).toBe(422);
    expect(await saldo()).toBe(9750);
  });

  test("entra nos relatórios como despesa sem mexer no saldo (sem dupla contagem com o banco)", async () => {
    await baixado();
    const hoje = ctx.relogio.agora().toISOString().slice(0, 10);
    const fluxo = (await chamar("GET", `/relatorios/fluxo-caixa?local_id=${local.id}&data=${hoje}`)).corpo;
    expect(fluxo).toMatchObject({ entradas: 9750, saidas: 0, taxas_cartao: 250, saldo_final: 9750 });
    const cons = (await chamar("GET", `/relatorios/consolidado?data_inicio=${hoje}&data_fim=${hoje}`)).corpo;
    expect(cons.locais[0]).toMatchObject({ recebimentos: 9750, pagamentos: 0, taxas_cartao: 250, saldo_final: 9750 });
    expect(cons.total.taxas_cartao).toBe(250);
  });

  test("estornar a baixa remove a taxa, o saldo e o relatório", async () => {
    const m = await baixado();
    await chamar("POST", `/lancamentos/${m.lancamento_id}/estornar`, { motivo: "Venda desfeita", supervisor: SUP });
    expect(await saldo()).toBe(0);
    expect((await taxasNaLista()).filter((t: any) => t.status !== "cancelado")).toHaveLength(0);
    const hoje = ctx.relogio.agora().toISOString().slice(0, 10);
    expect((await chamar("GET", `/relatorios/fluxo-caixa?local_id=${local.id}&data=${hoje}`)).corpo.taxas_cartao).toBe(0);
  });
});
