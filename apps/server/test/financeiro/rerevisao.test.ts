import { beforeEach, describe, expect, test, vi } from "vitest";
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

const chamar = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown, headers = admin) => {
  const r = await app.inject({ method, url: `/api/financeiro${url}`, headers, payload: payload as any });
  return { status: r.statusCode, corpo: r.json() as any };
};
const saldoDe = async (id: string) => (await chamar("GET", `/contas?local_id=${local.id}`)).corpo.find((c: any) => c.id === id).saldo as number;
const saldo = () => saldoDe(caixa.id);
const publicar = (tipo: string, payload: object) => emTransacao(ctx, (tx) => registrarEvento(tx, tipo, payload));
const alertas = (tipo: string) => ctx.db.selectFrom("alertas").selectAll().where("tipo", "=", tipo).where("resolvido_em", "is", null).execute();
const pag = (pagamentoId: string, formaCodigo: string, valor = 5000) => ({ pagamentoId, contaId: "c1", reservaId: "r1", formaCodigo, valor });
const estorno = (pagamentoId: string, valor = 5000) => ({ pagamentoId, estornoId: `e-${pagamentoId}`, contaId: "c1", reservaId: "r1", valor: -valor });
const lancDoPagamento = async (pid: string) => (await ctx.db.selectFrom("fin_lancamento").selectAll().where("referencia_tipo", "=", "hospedagem_pagamento").where("referencia_id", "=", pid).executeTakeFirstOrThrow()) as any;

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  ctx = await criarContextoTeste();
  app = criarApp(ctx);
  admin = await entrarComo(ctx, "admin");
  local = (await chamar("POST", "/locais", { nome: "Pousada" })).corpo;
  caixa = (await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0];
  const cat = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 2, maxCriancas: 0, comodidades: [] }, "u1")).id;
  await salvarHospede(ctx, { id: "h1", nome: "Maria", documentoTipo: "cpf", documento: "52998224725", nascimento: "1990-01-01", nacionalidade: "BR" }, "u1");
  await ctx.db.insertInto("contas").values({ id: "c1", titular_id: "h1", situacao: "aberta" }).execute();
  await ctx.db.insertInto("reservas").values({ id: "r1", codigo: 1, estado: "hospedada", titular_id: "h1", categoria_id: cat, quarto_id: null, chegada: "2026-11-10", saida: "2026-11-12", adultos: 1, criancas: "[]", canal: "Balcao", conta_id: "c1", valor_sinal: 0, criada_em: CRIADO } as any).execute();
});

describe("C1: o que nasce na hospedagem só se desfaz na hospedagem", () => {
  test("estornar ou cancelar pelo Financeiro é recusado com mensagem clara; o extrato não oferece Estornar", async () => {
    await publicar("hospedagem.PagamentoRegistrado", pag("p1", "pix"));
    await processarPendentes(ctx);
    const l = await lancDoPagamento("p1");
    const a = await chamar("POST", `/lancamentos/${l.id}/estornar`, { motivo: "x", supervisor: SUP });
    expect(a.status).toBe(422);
    expect(a.corpo.mensagem).toMatch(/hospedagem/);
    expect((await chamar("DELETE", `/lancamentos/${l.id}`, { motivo: "x", supervisor: SUP })).status).toBe(422);
    expect(await saldo()).toBe(5000);
    const hoje = ctx.relogio.agora().toISOString().slice(0, 10);
    const ex = (await chamar("GET", `/relatorios/movimento?conta_id=${caixa.id}&data_inicio=${hoje}&data_fim=${hoje}`)).corpo;
    expect(ex.movimentos[0].estornavel).toBe(false);
  });

  test("o estorno vindo da hospedagem funciona, e um segundo estorno do mesmo pagamento vira aviso, nunca falha permanente", async () => {
    await publicar("hospedagem.PagamentoRegistrado", pag("p1", "pix"));
    await publicar("hospedagem.PagamentoEstornado", estorno("p1"));
    await publicar("hospedagem.PagamentoEstornado", estorno("p1"));
    await publicar("hospedagem.PagamentoRegistrado", pag("p2", "pix", 3000));
    const r = await processarPendentes(ctx);
    expect(r.falhou).toBeUndefined();
    expect(await saldo()).toBe(3000); // p2 chegou: a fila não parou
    expect(await alertas("financeiro_estorno_duplicado")).toHaveLength(1);
  });

  test("estado já estornado no Financeiro (legado) também é aviso, não falha", async () => {
    await publicar("hospedagem.PagamentoRegistrado", pag("p1", "pix"));
    await processarPendentes(ctx);
    const l = await lancDoPagamento("p1");
    // simula um estorno antigo feito no Financeiro: lançamento oposto referenciando o original
    await ctx.db.insertInto("fin_lancamento").values({ id: "est", local_id: local.id, data: CRIADO, tipo: "pagamento", origem: "hospedagem", valor: 5000, forma_pagamento: "pix", status: "confirmado", referencia_id: l.id, referencia_tipo: "estorno", criado_por: "x", criado_em: CRIADO }).execute();
    await publicar("hospedagem.PagamentoEstornado", estorno("p1"));
    await publicar("hospedagem.PagamentoRegistrado", pag("p2", "pix", 1000));
    const r = await processarPendentes(ctx);
    expect(r.falhou).toBeUndefined();
    expect(await alertas("financeiro_estorno_duplicado")).toHaveLength(1);
    expect((await ctx.db.selectFrom("fin_lancamento").select("id").where("referencia_id", "=", "p2").execute())).toHaveLength(1);
  });

  test("cartão que veio da hospedagem não pode ser cancelado pelo Financeiro e a lista avisa a origem", async () => {
    await publicar("hospedagem.PagamentoRegistrado", pag("pc", "credito"));
    await processarPendentes(ctx);
    const m = (await chamar("GET", `/cartao/movimentos?local_id=${local.id}`)).corpo[0];
    expect(m.origem_hospedagem).toBe(true);
    const r = await chamar("DELETE", `/lancamentos/${m.lancamento_id}`, { motivo: "x", supervisor: SUP });
    expect(r.status).toBe(422);
    expect(r.corpo.mensagem).toMatch(/hospedagem/);
    const manual = (await chamar("POST", "/cartao/movimentos", { local_id: local.id, data: "2026-11-10", bandeira: "V", tipo: "credito", prazo_dias: 30, taxa_percentual: 0, valor: 1000, informado: "bruto" })).corpo;
    expect(manual.origem_hospedagem).toBeFalsy();
    expect((await chamar("DELETE", `/lancamentos/${manual.lancamento_id}`, { motivo: "dup", supervisor: SUP })).status).toBe(200);
  });
});

describe("Fila do Financeiro: saída para evento que não passa", () => {
  const envenenar = () => publicar("hospedagem.ValorAReceberCriado", { valorAReceberId: "v-falta", contaId: "c1", reservaId: "r1", valor: 9000 });

  test("só config.gerenciar vê a fila; mostra o evento bloqueado e o erro", async () => {
    await envenenar();
    await processarPendentes(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    expect((await chamar("GET", "/fila", undefined, rec)).status).toBe(403);
    const f = (await chamar("GET", "/fila")).corpo;
    expect(f.bloqueado).toMatchObject({ tipo: "hospedagem.ValorAReceberCriado", valor: 9000 });
    expect(f.bloqueado.erro).toMatch(/v-falta/);
    expect(f.bloqueado.falhas).toBeGreaterThanOrEqual(1);
  });

  test("Tentar de novo reprocessa; corrigida a causa, a fila segue", async () => {
    await envenenar();
    await processarPendentes(ctx);
    expect((await chamar("POST", "/fila/tentar-novamente", {})).corpo.falhou).toBeDefined();
    await ctx.db.insertInto("valores_a_receber").values({ id: "v-falta", conta_id: "c1", reserva_id: "r1", responsavel_nome: "Emp", responsavel_documento: "11222333000181", valor: 9000, criado_em: CRIADO, situacao: "aberto" }).execute();
    const ok = await chamar("POST", "/fila/tentar-novamente", {});
    expect(ok.corpo.falhou).toBeUndefined();
    expect((await chamar("GET", "/fila")).corpo.bloqueado).toBeNull();
  });

  test("Ignorar evento exige motivo e supervisor, é auditado, deixa registro e alerta com o valor, e destrava a fila", async () => {
    await envenenar();
    await publicar("hospedagem.PagamentoRegistrado", pag("p9", "pix", 7000));
    await processarPendentes(ctx);
    const seq = (await chamar("GET", "/fila")).corpo.bloqueado.seq;
    expect((await chamar("POST", "/fila/ignorar", { seq, motivo: " ", supervisor: SUP })).status).toBeGreaterThanOrEqual(400);
    expect((await chamar("POST", "/fila/ignorar", { seq, motivo: "Dado inválido", supervisor: { login: "admin", senha: "errada" } })).status).toBe(422);
    expect((await chamar("POST", "/fila/ignorar", { seq: seq + 99, motivo: "x", supervisor: SUP })).status).toBe(422); // não é o bloqueado
    const r = await chamar("POST", "/fila/ignorar", { seq, motivo: "Dado inválido da hospedagem", supervisor: SUP });
    expect(r.status).toBe(200);
    expect(await saldo()).toBe(7000); // o evento seguinte passou
    const f = (await chamar("GET", "/fila")).corpo;
    expect(f.bloqueado).toBeNull();
    expect(f.ignorados).toHaveLength(1);
    expect(f.ignorados[0]).toMatchObject({ seq, tipo: "hospedagem.ValorAReceberCriado", valor: 9000, motivo: "Dado inválido da hospedagem" });
    const al = await alertas("financeiro_evento_ignorado");
    expect(al).toHaveLength(1);
    expect(al[0]!.mensagem).toMatch(/90,00/);
    const aud = (await ctx.db.selectFrom("auditoria").selectAll().where("acao", "=", "fin_fila.ignorar").executeTakeFirstOrThrow()) as any;
    expect(aud.motivo).toBe("Dado inválido da hospedagem");
    expect(aud.supervisor_id).toBeTruthy();
  });

  test("sem evento bloqueado não há o que ignorar", async () => {
    expect((await chamar("POST", "/fila/ignorar", { seq: 1, motivo: "x", supervisor: SUP })).status).toBe(422);
  });

  test("falha ao ler a fila (ex.: banco) nunca lança: o Financeiro não impede a pousada de subir", async () => {
    await ctx.db.schema.dropTable("fin_cursor").execute();
    const r = await processarPendentes(ctx);
    expect(r.falhou).toBeDefined();
  });
});

describe("I1: estornar pagamento de conta a pagar devolve a conta a pendente com o valor cheio", () => {
  const novaConta = async (valor = 100000) => (await chamar("POST", "/contas-a-pagar", { local_id: local.id, descricao: "Fornecedor", categoria: "servico", valor, vencimento: "2026-11-20" })).corpo;
  const lanc = async (id: string) => (await ctx.db.selectFrom("fin_lancamento").selectAll().where("id", "=", id).executeTakeFirstOrThrow()) as any;

  test("pagamento total estornado volta a pendente (e uma segunda vez é recusada)", async () => {
    const c = await novaConta(5000);
    await chamar("PUT", `/contas-a-pagar/${c.id}/baixar`, { conta_id: caixa.id });
    expect(await saldo()).toBe(-5000);
    expect((await chamar("POST", `/lancamentos/${c.id}/estornar`, { motivo: "Conta errada", supervisor: SUP })).status).toBe(200);
    expect(await saldo()).toBe(0);
    expect(await lanc(c.id)).toMatchObject({ status: "pendente", valor: 5000, valor_total: null });
    expect((await chamar("POST", `/lancamentos/${c.id}/estornar`, { motivo: "de novo", supervisor: SUP })).status).toBe(422);
    expect(await saldo()).toBe(0);
    // pode pagar de novo
    expect((await chamar("PUT", `/contas-a-pagar/${c.id}/baixar`, { conta_id: caixa.id })).status).toBe(200);
    expect(await saldo()).toBe(-5000);
  });

  test("pagamento parcial: a parcela do saldo intocada é removida e o valor volta inteiro para o original", async () => {
    const c = await novaConta();
    await chamar("PUT", `/contas-a-pagar/${c.id}/baixar`, { conta_id: caixa.id, valor: 40000, novo_vencimento: "2026-12-15" });
    expect((await chamar("POST", `/lancamentos/${c.id}/estornar`, { motivo: "Engano", supervisor: SUP })).status).toBe(200);
    expect(await saldo()).toBe(0);
    expect(await lanc(c.id)).toMatchObject({ status: "pendente", valor: 100000, valor_total: null });
    const filhas = (await ctx.db.selectFrom("fin_lancamento").selectAll().where("parcela_de", "=", c.id).execute()) as any[];
    expect(filhas.every((f) => f.status === "cancelado")).toBe(true);
    // o total devido volta a ser R$ 1.000,00 (só o original pendente)
    const pend = ((await chamar("GET", `/lancamentos?local_id=${local.id}&tipo=pagamento`)).corpo as any[]).filter((l) => l.status === "pendente");
    expect(pend.reduce((s, l) => s + l.valor, 0)).toBe(100000);
  });

  test("parcela do saldo já mexida: recusa e nada muda", async () => {
    const c = await novaConta();
    await chamar("PUT", `/contas-a-pagar/${c.id}/baixar`, { conta_id: caixa.id, valor: 40000, novo_vencimento: "2026-12-15" });
    const resto = ((await chamar("GET", `/lancamentos?local_id=${local.id}&tipo=pagamento`)).corpo as any[]).find((l) => l.parcela_de === c.id);
    await chamar("PUT", `/contas-a-pagar/${resto.id}/baixar`, { conta_id: caixa.id, valor: 10000, novo_vencimento: "2026-12-30" });
    const r = await chamar("POST", `/lancamentos/${c.id}/estornar`, { motivo: "Engano", supervisor: SUP });
    expect(r.status).toBe(422);
    expect(r.corpo.mensagem).toMatch(/parcela do saldo/);
    expect(await lanc(c.id)).toMatchObject({ status: "confirmado", valor: 40000, valor_total: 100000 });
    expect(await saldo()).toBe(-50000);
  });

  test("Cancelar numa conta paga também desfaz o pagamento; só a conta pendente é cancelada de verdade", async () => {
    const c = await novaConta(5000);
    await chamar("PUT", `/contas-a-pagar/${c.id}/baixar`, { conta_id: caixa.id });
    expect((await chamar("DELETE", `/lancamentos/${c.id}`, { motivo: "Engano", supervisor: SUP })).status).toBe(200);
    expect(await lanc(c.id)).toMatchObject({ status: "pendente", valor: 5000 });
    expect(await saldo()).toBe(0);
    expect((await chamar("DELETE", `/lancamentos/${c.id}`, { motivo: "Não é mais devida", supervisor: SUP })).status).toBe(200);
    expect((await lanc(c.id)).status).toBe("cancelado");
  });

  test("estornar conta ainda não paga é recusado (nada a reverter)", async () => {
    const c = await novaConta(5000);
    expect((await chamar("POST", `/lancamentos/${c.id}/estornar`, { motivo: "x", supervisor: SUP })).status).toBe(422);
  });

  test("o extrato só oferece Estornar enquanto o pagamento está de pé", async () => {
    const c = await novaConta(5000);
    await chamar("PUT", `/contas-a-pagar/${c.id}/baixar`, { conta_id: caixa.id });
    const hoje = ctx.relogio.agora().toISOString().slice(0, 10);
    const ex = async () => (await chamar("GET", `/relatorios/movimento?conta_id=${caixa.id}&data_inicio=${hoje}&data_fim=${hoje}`)).corpo.movimentos as any[];
    expect((await ex()).every((m) => m.estornavel === (m.tipo === "debito" && m.lancamento_id === c.id))).toBe(true);
    await chamar("POST", `/lancamentos/${c.id}/estornar`, { motivo: "Engano", supervisor: SUP });
    expect((await ex()).some((m) => m.estornavel)).toBe(false);
  });
});

describe("I2: estornar a baixa do cartão volta o recebível a 'a receber'", () => {
  const manual = async () => {
    const m = (await chamar("POST", "/cartao/movimentos", { local_id: local.id, data: "2026-11-10", bandeira: "Visa", tipo: "credito", prazo_dias: 30, taxa_percentual: 2, valor: 10000, informado: "bruto" })).corpo;
    await chamar("PUT", `/cartao/movimentos/${m.id}/baixar`, { conta_id: caixa.id });
    return m;
  };
  const taxas = async () => ((await chamar("GET", `/lancamentos?local_id=${local.id}&tipo=pagamento`)).corpo as any[]).filter((l) => l.categoria === "taxa_cartao" && l.status !== "cancelado");

  test("baixa na conta errada: estornar a baixa devolve a a_receber, remove a taxa e permite baixar de novo em outra conta", async () => {
    const banco = (await chamar("POST", "/contas", { local_id: local.id, nome: "B", numero: "9", tipo: "corrente", saldo_inicial: 0 })).corpo;
    const m = await manual();
    expect(await saldo()).toBe(9800);
    const r = await chamar("POST", `/cartao/movimentos/${m.id}/estornar-baixa`, { motivo: "Conta errada", supervisor: SUP });
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ status: "a_receber", conta_destino_id: null, baixado_em: null });
    expect(await saldo()).toBe(0);
    expect(await taxas()).toHaveLength(0);
    expect((await ctx.db.selectFrom("fin_lancamento").select("status").where("id", "=", m.lancamento_id).executeTakeFirstOrThrow()).status).toBe("confirmado");
    expect((await chamar("POST", `/cartao/movimentos/${m.id}/estornar-baixa`, { motivo: "x", supervisor: SUP })).status).toBe(422);
    expect((await chamar("PUT", `/cartao/movimentos/${m.id}/baixar`, { conta_id: banco.id })).status).toBe(200);
    expect(await saldoDe(banco.id)).toBe(9800);
    expect(await taxas()).toHaveLength(1);
  });

  test("cartão da hospedagem: a baixa estornada mantém o vínculo com o pagamento e um estorno posterior da hospedagem o cancela", async () => {
    await chamar("POST", "/cobranca/condicoes", { local_id: local.id, adquirente: "Cielo", bandeira: "Visa", tipo: "credito", prazo_dias: 30, taxa_percentual: 2 });
    await publicar("hospedagem.PagamentoRegistrado", pag("pc", "credito", 10000));
    await processarPendentes(ctx);
    const m = (await chamar("GET", `/cartao/movimentos?local_id=${local.id}`)).corpo[0];
    await chamar("PUT", `/cartao/movimentos/${m.id}/baixar`, { conta_id: caixa.id });
    expect((await chamar("POST", `/cartao/movimentos/${m.id}/estornar-baixa`, { motivo: "Conta errada", supervisor: SUP })).status).toBe(200);
    const l = await lancDoPagamento("pc");
    expect(l.status).toBe("confirmado");
    await publicar("hospedagem.PagamentoEstornado", estorno("pc", 10000));
    expect((await processarPendentes(ctx)).falhou).toBeUndefined();
    expect((await chamar("GET", `/cartao/movimentos?local_id=${local.id}`)).corpo[0].status).toBe("cancelado");
    expect(await saldo()).toBe(0);
  });

  test("estorno da hospedagem chegou com o cartão baixado (alerta): estornar a baixa cancela o cartão e resolve o alerta", async () => {
    await chamar("POST", "/cobranca/condicoes", { local_id: local.id, adquirente: "Cielo", bandeira: "Visa", tipo: "credito", prazo_dias: 30, taxa_percentual: 0 });
    await publicar("hospedagem.PagamentoRegistrado", pag("pc", "credito", 10000));
    await processarPendentes(ctx);
    const m = (await chamar("GET", `/cartao/movimentos?local_id=${local.id}`)).corpo[0];
    await chamar("PUT", `/cartao/movimentos/${m.id}/baixar`, { conta_id: caixa.id });
    await publicar("hospedagem.PagamentoEstornado", estorno("pc", 10000));
    await processarPendentes(ctx);
    expect(await alertas("financeiro_estorno_conciliado")).toHaveLength(1);
    expect((await chamar("POST", `/cartao/movimentos/${m.id}/estornar-baixa`, { motivo: "Estorno da hospedagem", supervisor: SUP })).status).toBe(200);
    expect((await chamar("GET", `/cartao/movimentos?local_id=${local.id}`)).corpo[0].status).toBe("cancelado");
    expect(await saldo()).toBe(0);
    expect(await alertas("financeiro_estorno_conciliado")).toHaveLength(0);
  });

  test("a rota genérica de estorno não vale para cartão baixado e aponta o caminho certo", async () => {
    const m = await manual();
    const r = await chamar("POST", `/lancamentos/${m.lancamento_id}/estornar`, { motivo: "x", supervisor: SUP });
    expect(r.status).toBe(422);
    expect(r.corpo.mensagem).toMatch(/Estornar baixa/);
  });

  test("baixa de movimento a revisar exige a condição: só a taxa não basta", async () => {
    await publicar("hospedagem.PagamentoRegistrado", pag("pc", "credito", 10000));
    await processarPendentes(ctx);
    const m = (await chamar("GET", `/cartao/movimentos?local_id=${local.id}`)).corpo[0];
    expect(m.revisar).toBe(1);
    expect((await chamar("PUT", `/cartao/movimentos/${m.id}/baixar`, { conta_id: caixa.id, taxa_percentual: 2 })).status).toBe(422);
  });
});

describe("I3: chave de envio presa à rota, ao registro e ao conteúdo", () => {
  test("mesma chave com conteúdo diferente: 409 com mensagem clara, sem executar", async () => {
    const base = { chave: "k1", local_id: local.id, descricao: "Luz", categoria: "servico", vencimento: "2026-12-01" };
    expect((await chamar("POST", "/contas-a-pagar", { ...base, valor: 5000 })).status).toBe(201);
    const r = await chamar("POST", "/contas-a-pagar", { ...base, valor: 9000 });
    expect(r.status).toBe(409);
    expect(r.corpo.mensagem).toMatch(/chave/i);
    expect((await chamar("GET", `/lancamentos?local_id=${local.id}&tipo=pagamento`)).corpo).toHaveLength(1);
    // mesmo conteúdo continua repetindo a resposta
    expect((await chamar("POST", "/contas-a-pagar", { ...base, valor: 5000 })).status).toBe(201);
  });

  test("mesma chave em outro registro (outra conta a receber) executa de verdade", async () => {
    for (const [n, valor] of [[1, 10000], [2, 20000]] as const) {
      await ctx.db.insertInto("fin_cliente").values({ id: `cli${n}`, local_id: local.id, nome: `C${n}`, cpf_cnpj: null, tipo: "pessoa_juridica", contato: null, criado_em: CRIADO }).execute();
      await ctx.db.insertInto("fin_faturamento").values({ id: `f${n}`, local_id: local.id, cliente_id: `cli${n}`, referencia_id: `r${n}`, valor_original: valor, valor_liquido: valor, data_vencimento: "2026-12-01T12:00:00Z", forma_cobranca: "boleto", numero_documento: null, status: "aberto", lançamentos_id: "[]", criado_em: CRIADO }).execute();
      await chamar("POST", "/faturamentos/fechar-grupo", { ids: [`f${n}`], forma: "pix", data_vencimento: "2026-12-10" });
    }
    const recs = (await ctx.db.selectFrom("fin_conta_receber").select(["id", "valor_original"]).orderBy("valor_original").execute()) as any[];
    for (const r of recs) {
      const res = await chamar("PUT", `/contas-receber/${r.id}/confirmar-pagamento`, { chave: "mesma", valor: r.valor_original, conta_bancaria_id: caixa.id });
      expect(res.status).toBe(200);
    }
    expect(await saldo()).toBe(30000);
  });
});

describe("Menores: reversão de transferência não vira receita", () => {
  test("cancelar uma transferência não registra recebimento nem pagamento: os relatórios mostram o líquido das transferências", async () => {
    const banco = (await chamar("POST", "/contas", { local_id: local.id, nome: "B", numero: "9", tipo: "corrente", saldo_inicial: 10000 })).corpo;
    await chamar("POST", "/caixa-banco/transferencia", { origem: banco.id, destino: caixa.id, valor: 3000 });
    const t = (await ctx.db.selectFrom("fin_lancamento").select("id").where("tipo", "=", "transferencia").executeTakeFirstOrThrow()).id;
    expect((await chamar("DELETE", `/lancamentos/${t}`, { motivo: "Engano", supervisor: SUP })).status).toBe(200);
    expect(await saldoDe(banco.id)).toBe(10000);
    expect(await saldo()).toBe(0);
    const hoje = ctx.relogio.agora().toISOString().slice(0, 10);
    const f = (await chamar("GET", `/relatorios/fluxo-caixa?local_id=${local.id}&data=${hoje}`)).corpo;
    expect(f).toMatchObject({ entradas: 0, saidas: 0, transferencias_entrada: 0, transferencias_saida: 0 });
    const c = (await chamar("GET", `/relatorios/consolidado?data_inicio=${hoje}&data_fim=${hoje}`)).corpo;
    expect(c.locais[0]).toMatchObject({ recebimentos: 0, pagamentos: 0 });
  });
});
