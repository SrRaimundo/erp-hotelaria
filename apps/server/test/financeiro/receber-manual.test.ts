import { beforeEach, describe, expect, test, vi } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let app: ReturnType<typeof criarApp>;
let admin: { authorization: string };
let local: any;
let caixa: any;
let cliente: any;
const SUP = { login: "admin", senha: "admin" };
const CRIADO = "2026-11-10T15:00:00.000Z";

const chamar = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) => {
  const r = await app.inject({ method, url: `/api/financeiro${url}`, headers: admin, payload: payload as any });
  return { status: r.statusCode, corpo: r.json() as any };
};
const saldo = async () => (await chamar("GET", `/contas?local_id=${local.id}`)).corpo.find((c: any) => c.id === caixa.id).saldo as number;
const itens = async () => (await chamar("GET", `/relatorios/contas-receber?local_id=${local.id}`)).corpo.itens as any[];
const nova = async (extra: object = {}, numero = "DOC-1") =>
  (await chamar("POST", "/contas-receber", { local_id: local.id, cliente_id: cliente.id, numero_documento: numero, valor: 100000, vencimento: "2026-12-20", categoria: "aluguel", observacao: "Salão", ...extra })).corpo;
const receber = (id: string, valor: number, novo?: string) => chamar("PUT", `/contas-receber/${id}/confirmar-pagamento`, { valor, conta_bancaria_id: caixa.id, novo_vencimento: novo });

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  ctx = await criarContextoTeste();
  app = criarApp(ctx);
  admin = await entrarComo(ctx, "admin");
  local = (await chamar("POST", "/locais", { nome: "Pousada" })).corpo;
  caixa = (await chamar("GET", `/contas?local_id=${local.id}`)).corpo[0];
  cliente = (await chamar("POST", "/clientes", { local_id: local.id, nome: "Maria Eventos", cpf_cnpj: "52998224725" })).corpo;
});

describe("cliente: seleção e criação rápida", () => {
  test("cria cliente na hora (documento único por local) e ele aparece na lista", async () => {
    expect(cliente).toMatchObject({ nome: "Maria Eventos", cpf_cnpj: "52998224725" });
    expect((await chamar("POST", "/clientes", { local_id: local.id, nome: "Outra", cpf_cnpj: "52998224725" })).status).toBe(422);
    expect((await chamar("POST", "/clientes", { local_id: local.id, nome: " " })).status).toBe(400);
    expect((await chamar("GET", `/clientes?local_id=${local.id}`)).corpo.map((c: any) => c.nome)).toEqual(["Maria Eventos"]);
  });
});

describe("conta a receber lançada à mão", () => {
  test("cria com cliente, documento, vencimento, valor, categoria e observação; aparece na lista como manual e editável", async () => {
    const c = await nova();
    expect(c).toMatchObject({ numero_documento: "DOC-1", valor_original: 100000, categoria: "aluguel", observacao: "Salão", origem: "manual", status: "pendente" });
    const [i] = await itens();
    expect(i).toMatchObject({ cliente_nome: "Maria Eventos", origem: "manual", categoria: "aluguel", observacao: "Salão", editavel: true, valor_pendente: 100000 });
    expect(i.data_vencimento).toContain("2026-12-20");
  });

  test("valida: valor, documento repetido no local, categoria, data e cliente de outro local", async () => {
    await nova();
    const base = { local_id: local.id, cliente_id: cliente.id, numero_documento: "DOC-2", valor: 5000, vencimento: "2026-12-20", categoria: "servico" };
    expect((await chamar("POST", "/contas-receber", { ...base, valor: 0 })).status).toBe(400);
    expect((await chamar("POST", "/contas-receber", { ...base, categoria: "xyz" })).status).toBe(400);
    expect((await chamar("POST", "/contas-receber", { ...base, vencimento: "2026-02-30" })).status).toBe(400);
    expect((await chamar("POST", "/contas-receber", { ...base, numero_documento: "DOC-1" })).status).toBe(422);
    const outro = (await chamar("POST", "/locais", { nome: "Sorveteria" })).corpo;
    const estranho = (await chamar("POST", "/clientes", { local_id: outro.id, nome: "Cliente de lá" })).corpo;
    expect((await chamar("POST", "/contas-receber", { ...base, cliente_id: estranho.id })).status).toBe(422);
  });

  test("criar duas vezes com a mesma chave cria uma só", async () => {
    const corpo = { chave: "k", local_id: local.id, cliente_id: cliente.id, numero_documento: "DOC-K", valor: 1000, vencimento: "2026-12-20", categoria: "servico" };
    const [a, b] = await Promise.all([chamar("POST", "/contas-receber", corpo), chamar("POST", "/contas-receber", corpo)]);
    expect(b.corpo.id).toBe(a.corpo.id);
    expect(await itens()).toHaveLength(1);
  });

  test("edita enquanto pendente; depois de receber, não", async () => {
    const c = await nova();
    const e = await chamar("PUT", `/contas-receber/${c.id}`, { valor: 120000, vencimento: "2026-12-25", categoria: "evento", observacao: "Salão + som", numero_documento: "DOC-1B" });
    expect(e.status).toBe(200);
    expect((await itens())[0]).toMatchObject({ valor_original: 120000, categoria: "evento", observacao: "Salão + som", numero_documento: "DOC-1B" });
    await receber(c.id, 1000, "2027-01-10");
    const r = await chamar("PUT", `/contas-receber/${c.id}`, { valor: 1 });
    expect(r.status).toBe(422);
    expect(r.corpo.mensagem).toMatch(/pendente/);
  });

  test("cancela a pendente (motivo e supervisor); a recebida não", async () => {
    const c = await nova();
    expect((await chamar("POST", `/contas-receber/${c.id}/cancelar`, { motivo: " ", supervisor: SUP })).status).toBeGreaterThanOrEqual(400);
    expect((await chamar("POST", `/contas-receber/${c.id}/cancelar`, { motivo: "Evento cancelado", supervisor: SUP })).status).toBe(200);
    expect(await itens()).toHaveLength(0);
    const d = await nova({}, "DOC-3");
    await receber(d.id, 100000);
    expect((await chamar("POST", `/contas-receber/${d.id}/cancelar`, { motivo: "x", supervisor: SUP })).status).toBe(422);
  });

  test("recebe por inteiro: saldo sobe e a conta fica recebida", async () => {
    const c = await nova();
    expect((await receber(c.id, 100000)).status).toBe(200);
    expect(await saldo()).toBe(100000);
    expect((await itens())[0]).toMatchObject({ situacao: "recebido", editavel: false });
  });

  test("recebe parcial com novo vencimento: nova parcela manual vinculada, soma igual ao original", async () => {
    const c = await nova();
    expect((await receber(c.id, 30000)).status).toBe(422);
    expect((await receber(c.id, 30000, "2027-01-15")).status).toBe(200);
    const todas = (await ctx.db.selectFrom("fin_conta_receber").selectAll().execute()) as any[];
    const filha = todas.find((x) => x.parcela_de === c.id);
    expect(filha).toMatchObject({ valor_original: 70000, origem: "manual", categoria: "aluguel", status: "pendente" });
    expect(todas.find((x) => x.id === c.id)).toMatchObject({ valor_original: 30000, valor_total: 100000, status: "recebido" });
    // a parcela do saldo, pendente e intocada, ainda se edita e se cancela
    expect((await chamar("PUT", `/contas-receber/${filha.id}`, { vencimento: "2027-02-01" })).status).toBe(200);
  });

  test("estornar o recebimento parcial: conta volta a pendente com o valor cheio e a parcela do saldo some", async () => {
    const c = await nova();
    await receber(c.id, 30000, "2027-01-15");
    const l = (await ctx.db.selectFrom("fin_lancamento").select("id").where("referencia_id", "=", c.id).where("referencia_tipo", "=", "conta_receber").executeTakeFirstOrThrow()).id;
    expect((await chamar("POST", `/lancamentos/${l}/estornar`, { motivo: "Engano", supervisor: SUP })).status).toBe(200);
    expect(await saldo()).toBe(0);
    const [i] = await itens();
    expect(i).toMatchObject({ valor_original: 100000, valor_recebido: 0, situacao: "aberto", editavel: true });
    expect(await itens()).toHaveLength(1);
    // segunda vez recusada
    expect((await chamar("POST", `/lancamentos/${l}/estornar`, { motivo: "de novo", supervisor: SUP })).status).toBe(422);
  });

  test("estornar com a parcela do saldo já mexida: recusa com mensagem clara", async () => {
    const c = await nova();
    await receber(c.id, 30000, "2027-01-15");
    const filha = (await ctx.db.selectFrom("fin_conta_receber").select("id").where("parcela_de", "=", c.id).executeTakeFirstOrThrow()).id;
    await receber(filha, 10000, "2027-02-15");
    const l = (await ctx.db.selectFrom("fin_lancamento").select("id").where("referencia_id", "=", c.id).where("referencia_tipo", "=", "conta_receber").executeTakeFirstOrThrow()).id;
    const r = await chamar("POST", `/lancamentos/${l}/estornar`, { motivo: "Engano", supervisor: SUP });
    expect(r.status).toBe(422);
    expect(r.corpo.mensagem).toMatch(/parcela do saldo/);
    expect(await saldo()).toBe(40000);
  });

  test("a lista oferece o último recebimento para estornar", async () => {
    const c = await nova();
    await receber(c.id, 100000);
    const [i] = await itens();
    expect(i.lancamento_id).toBeTruthy();
  });
});

describe("conta a receber que veio da hospedagem (faturamento)", () => {
  async function daHospedagem() {
    await ctx.db.insertInto("fin_faturamento").values({ id: "f1", local_id: local.id, cliente_id: cliente.id, referencia_id: "ref1", valor_original: 50000, valor_liquido: 50000, data_vencimento: "2026-12-01T12:00:00Z", forma_cobranca: "boleto", numero_documento: null, status: "aberto", lançamentos_id: "[]", criado_em: CRIADO }).execute();
    await chamar("POST", "/faturamentos/fechar-grupo", { ids: ["f1"], forma: "pix", data_vencimento: "2026-12-10" });
    return (await ctx.db.selectFrom("fin_conta_receber").selectAll().where("origem", "=", "faturamento").executeTakeFirstOrThrow()) as any;
  }

  test("não se edita nem se cancela no Financeiro: a mensagem manda para a hospedagem", async () => {
    const r = await daHospedagem();
    expect((await itens())[0]).toMatchObject({ origem: "faturamento", editavel: false });
    const e = await chamar("PUT", `/contas-receber/${r.id}`, { valor: 1 });
    expect(e.status).toBe(422);
    expect(e.corpo.mensagem).toMatch(/hospedagem/);
    const c = await chamar("POST", `/contas-receber/${r.id}/cancelar`, { motivo: "x", supervisor: SUP });
    expect(c.status).toBe(422);
    expect(c.corpo.mensagem).toMatch(/hospedagem/);
  });

  test("receber e estornar o recebimento continuam valendo (é dinheiro lançado no Financeiro)", async () => {
    const r = await daHospedagem();
    await receber(r.id, 50000);
    expect(await saldo()).toBe(50000);
    const l = (await ctx.db.selectFrom("fin_lancamento").select("id").where("referencia_id", "=", r.id).where("referencia_tipo", "=", "conta_receber").executeTakeFirstOrThrow()).id;
    expect((await chamar("POST", `/lancamentos/${l}/estornar`, { motivo: "Engano", supervisor: SUP })).status).toBe(200);
    expect(await saldo()).toBe(0);
  });
});
