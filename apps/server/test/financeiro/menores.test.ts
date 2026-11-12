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
const SUP = { login: "admin", senha: "admin" };
const CRIADO = "2026-11-10T15:00:00.000Z";

const chamar = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) => {
  const r = await app.inject({ method, url: `/api/financeiro${url}`, headers: admin, payload: payload as any });
  return { status: r.statusCode, corpo: r.json() as any };
};

beforeEach(async () => {
  ctx = await criarContextoTeste();
  app = criarApp(ctx);
  admin = await entrarComo(ctx, "admin");
  local = (await chamar("POST", "/locais", { nome: "Pousada" })).corpo;
  caixa = (await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0];
});

describe("duplo envio em ações de dinheiro (chave de idempotência)", () => {
  test("mesma chave: a conta a pagar é criada uma vez e a resposta é repetida", async () => {
    const corpo = { chave: "k1", local_id: local.id, descricao: "Luz", categoria: "servico", valor: 5000, vencimento: "2026-12-01" };
    const [a, b] = await Promise.all([chamar("POST", "/contas-a-pagar", corpo), chamar("POST", "/contas-a-pagar", corpo)]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.corpo.id).toBe(a.corpo.id);
    expect((await chamar("GET", `/lancamentos?local_id=${local.id}&tipo=pagamento`)).corpo).toHaveLength(1);
    const c = await chamar("POST", "/contas-a-pagar", { ...corpo, chave: "k2" });
    expect(c.corpo.id).not.toBe(a.corpo.id);
  });

  test("mesma chave na transferência move o dinheiro uma vez", async () => {
    const banco = (await chamar("POST", "/contas", { chave: "c1", local_id: local.id, nome: "B", numero: "1", tipo: "corrente", saldo_inicial: 10000 })).corpo;
    const corpo = { chave: "t1", origem: banco.id, destino: caixa.id, valor: 3000 };
    await chamar("POST", "/caixa-banco/transferencia", corpo);
    await chamar("POST", "/caixa-banco/transferencia", corpo);
    const contas = (await chamar("GET", `/contas?local_id=${local.id}`)).corpo;
    expect(contas.find((c: any) => c.id === banco.id).saldo).toBe(7000);
    expect(contas.find((c: any) => c.id === caixa.id).saldo).toBe(3000);
  });

  test("falha não consome a chave: a nova tentativa com a mesma chave funciona", async () => {
    const ruim = { chave: "k9", local_id: local.id, descricao: "X", categoria: "servico", valor: 100, vencimento: "2026-12-01", fornecedor_id: "nao-existe" };
    expect((await chamar("POST", "/contas-a-pagar", ruim)).status).toBe(422);
    expect((await chamar("POST", "/contas-a-pagar", { ...ruim, fornecedor_id: undefined })).status).toBe(201);
  });

  test("recebimento parcial com a mesma chave recebe uma vez", async () => {
    await ctx.db.insertInto("fin_cliente").values({ id: "cli", local_id: local.id, nome: "E", cpf_cnpj: null, tipo: "pessoa_juridica", contato: null, criado_em: CRIADO }).execute();
    await ctx.db.insertInto("fin_faturamento").values({ id: "f", local_id: local.id, cliente_id: "cli", referencia_id: "r", valor_original: 10000, valor_liquido: 10000, data_vencimento: "2026-12-01T12:00:00Z", forma_cobranca: "boleto", numero_documento: null, status: "aberto", lançamentos_id: "[]", criado_em: CRIADO }).execute();
    await chamar("POST", "/faturamentos/f/fechar", { forma: "pix", data_vencimento: "2026-12-10" });
    const rec = (await ctx.db.selectFrom("fin_conta_receber").select("id").executeTakeFirstOrThrow()).id;
    const corpo = { chave: "r1", valor: 4000, conta_bancaria_id: caixa.id, novo_vencimento: "2026-12-30" };
    expect((await chamar("PUT", `/contas-receber/${rec}/confirmar-pagamento`, corpo)).status).toBe(200);
    expect((await chamar("PUT", `/contas-receber/${rec}/confirmar-pagamento`, corpo)).status).toBe(200);
    expect((await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0].saldo).toBe(4000);
  });
});

describe("outras correções", () => {
  test("estorno no mesmo dia não infla Entradas nem Saídas (o relatório mostra o líquido)", async () => {
    const m = (await chamar("POST", "/cartao/movimentos", { local_id: local.id, data: "2026-11-10", bandeira: "V", tipo: "credito", valor: 10000, prazo_dias: 30, informado: "bruto", taxa_percentual: 0 })).corpo;
    await chamar("PUT", `/cartao/movimentos/${m.id}/baixar`, { conta_id: caixa.id });
    await chamar("POST", `/lancamentos/${m.lancamento_id}/estornar`, { motivo: "Engano", supervisor: SUP });
    const hoje = ctx.relogio.agora().toISOString().slice(0, 10);
    const f = (await chamar("GET", `/relatorios/fluxo-caixa?local_id=${local.id}&data=${hoje}`)).corpo;
    expect(f).toMatchObject({ entradas: 0, saidas: 0, saldo_final: 0 });
    const c = (await chamar("GET", `/relatorios/consolidado?data_inicio=${hoje}&data_fim=${hoje}`)).corpo;
    expect(c.locais[0]).toMatchObject({ recebimentos: 0, pagamentos: 0, saldo_final: 0 });
  });

  test("a hospedagem usa a conta do tipo caixa, mesmo que exista outra conta chamada Caixa", async () => {
    await chamar("POST", "/contas", { local_id: local.id, nome: "Caixa", numero: "77", tipo: "corrente", saldo_inicial: 0 });
    const cat = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 2, maxCriancas: 0, comodidades: [] }, "u1")).id;
    await salvarHospede(ctx, { id: "h1", nome: "Maria", documentoTipo: "cpf", documento: "52998224725", nascimento: "1990-01-01", nacionalidade: "BR" }, "u1");
    await ctx.db.insertInto("contas").values({ id: "c1", titular_id: "h1", situacao: "aberta" }).execute();
    await ctx.db.insertInto("reservas").values({ id: "r1", codigo: 1, estado: "hospedada", titular_id: "h1", categoria_id: cat, quarto_id: null, chegada: "2026-11-10", saida: "2026-11-12", adultos: 1, criancas: "[]", canal: "Balcao", conta_id: "c1", valor_sinal: 0, criada_em: CRIADO } as any).execute();
    await processarPagamentoRegistrado(ctx, { criadoEm: CRIADO, payload: { pagamentoId: "p1", contaId: "c1", reservaId: "r1", formaCodigo: "pix", valor: 3000 } });
    const mov = await ctx.db.selectFrom("fin_movimento").selectAll().executeTakeFirstOrThrow();
    expect(mov.conta_id).toBe(caixa.id);
  });

  test("a mesma baixa de pagamento da hospedagem não vira dois lançamentos nem por corrida (índice único)", async () => {
    const { sql } = await import("kysely");
    const ins = (id: string) => sql`INSERT INTO fin_lancamento (id, local_id, data, tipo, origem, valor, forma_pagamento, status, referencia_id, referencia_tipo, criado_por, criado_em) VALUES (${id}, ${local.id}, 'd', 'recebimento', 'hospedagem', 1, 'pix', 'confirmado', 'p1', 'hospedagem_pagamento', 'x', 'd')`.execute(ctx.db);
    await ins("a");
    await expect(ins("b")).rejects.toThrow();
  });

  test("filtros de data dos relatórios recusam dia que não existe", async () => {
    const r = await chamar("GET", `/relatorios/fluxo-caixa?local_id=${local.id}&data=2026-02-30`);
    expect(r.status).toBe(400);
    expect((await chamar("GET", "/relatorios/consolidado?data_inicio=2026-02-30&data_fim=2026-03-02")).status).toBe(400);
  });

  test("não se desativa o local que recebe a hospedagem", async () => {
    await chamar("PUT", `/locais/${local.id}`, { hospedagem_padrao: true });
    const r = await chamar("PUT", `/locais/${local.id}`, { ativo: false });
    expect(r.status).toBe(422);
    expect(r.corpo.mensagem).toMatch(/hospedagem/i);
    const outro = (await chamar("POST", "/locais", { nome: "Outro" })).corpo;
    expect((await chamar("PUT", `/locais/${outro.id}`, { ativo: false })).status).toBe(200);
  });

  test("cancelar e estornar gravam motivo e supervisor na auditoria", async () => {
    const c = (await chamar("POST", "/contas-a-pagar", { local_id: local.id, descricao: "Luz", categoria: "servico", valor: 5000, vencimento: "2026-12-01" })).corpo;
    await chamar("DELETE", `/lancamentos/${c.id}`, { motivo: "Duplicada", supervisor: SUP });
    const a = (await ctx.db.selectFrom("auditoria").selectAll().where("acao", "=", "fin_lancamento.cancelar").executeTakeFirstOrThrow()) as any;
    expect(a.motivo).toBe("Duplicada");
    expect(a.supervisor_id).toBeTruthy();
  });
});
