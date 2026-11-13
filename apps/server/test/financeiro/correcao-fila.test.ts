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

const chamar = async (method: "GET" | "POST", url: string, payload?: unknown, headers = admin) => {
  const r = await app.inject({ method, url: `/api/financeiro${url}`, headers, payload: payload as any });
  return { status: r.statusCode, corpo: r.json() as any };
};
const saldo = async () => (await chamar("GET", `/contas?local_id=${local.id}`)).corpo.find((c: any) => c.id === caixa.id).saldo as number;
const publicar = (tipo: string, payload: object) => emTransacao(ctx, (tx) => registrarEvento(tx, tipo, payload));
const alertas = (tipo: string) => ctx.db.selectFrom("alertas").selectAll().where("tipo", "=", tipo).where("resolvido_em", "is", null).execute();
const pag = (pagamentoId: string, formaCodigo: string, valor = 5000) => ({ pagamentoId, contaId: "c1", reservaId: "r1", formaCodigo, valor });
const estorno = (pagamentoId: string, valor = 5000) => ({ pagamentoId, estornoId: `e-${pagamentoId}`, contaId: "c1", reservaId: "r1", valor: -valor });
const lanc = async (pid: string) => (await ctx.db.selectFrom("fin_lancamento").selectAll().where("referencia_tipo", "=", "hospedagem_pagamento").where("referencia_id", "=", pid).executeTakeFirstOrThrow()) as any;
/** Registra um evento como ignorado (o que a tela Ignorar evento faz com o evento bloqueado). */
const ignorado = (seq: number, tipo: string, payload: object) =>
  ctx.db.insertInto("fin_evento_ignorado").values({ seq, tipo, payload: JSON.stringify(payload), valor: Math.abs((payload as any).valor), erro: "falhou", motivo: "Dado inválido", ator: "admin", criado_em: CRIADO }).execute();
const corrigir = (seq: number, extra: object = {}, headers = admin) => chamar("POST", `/fila/ignorados/${seq}/aplicar-correcao`, { motivo: "Conferido com a recepção", supervisor: SUP, ...extra }, headers);

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

describe("Fila: Aplicar correção de um evento ignorado", () => {
  test("estorno ignorado: a correção desfaz o recebimento como o evento faria, uma única vez, ligada ao evento e auditada", async () => {
    await publicar("hospedagem.PagamentoRegistrado", pag("p1", "pix"));
    await processarPendentes(ctx);
    expect(await saldo()).toBe(5000);
    await ignorado(900, "hospedagem.PagamentoEstornado", estorno("p1"));
    const r = await corrigir(900);
    expect(r.status).toBe(200);
    expect(await saldo()).toBe(0);
    expect(await lanc("p1")).toMatchObject({ status: "cancelado" });
    const f = (await chamar("GET", "/fila")).corpo;
    expect(f.ignorados[0]).toMatchObject({ seq: 900, corrigido: true, correcao_motivo: "Conferido com a recepção" });
    const aud = (await ctx.db.selectFrom("auditoria").selectAll().where("acao", "=", "fin_fila.aplicar_correcao").executeTakeFirstOrThrow()) as any;
    expect(aud).toMatchObject({ alvo_id: "900", motivo: "Conferido com a recepção" });
    expect(aud.supervisor_id).toBeTruthy();
    const rev = (await ctx.db.selectFrom("auditoria").selectAll().where("alvo_id", "=", (await lanc("p1")).id).where("acao", "=", "fin_lancamento.cancelar").executeTakeFirstOrThrow()) as any;
    expect(rev.motivo).toMatch(/evento ignorado nº 900/);
    expect(rev.supervisor_id).toBeTruthy();
    // uma única vez
    const outra = await corrigir(900);
    expect(outra.status).toBe(422);
    expect(outra.corpo.mensagem).toMatch(/já foi aplicada/);
    expect(await saldo()).toBe(0);
  });

  test("exige config.gerenciar, supervisor e motivo; sem eles nada muda e a correção segue disponível", async () => {
    await publicar("hospedagem.PagamentoRegistrado", pag("p1", "pix"));
    await processarPendentes(ctx);
    await ignorado(900, "hospedagem.PagamentoEstornado", estorno("p1"));
    const rec = await entrarComo(ctx, "recepcao");
    expect((await corrigir(900, {}, rec)).status).toBe(403);
    expect((await corrigir(900, { supervisor: undefined })).status).toBe(422);
    expect((await corrigir(900, { motivo: " " })).status).toBeGreaterThanOrEqual(400);
    expect((await corrigir(900, { supervisor: { login: "admin", senha: "errada" } })).status).toBe(422);
    expect(await saldo()).toBe(5000);
    expect((await corrigir(900)).status).toBe(200);
  });

  test("sem nada a desfazer (já desfeito, ou lançamento inexistente): recusa com explicação e não marca como aplicada", async () => {
    await publicar("hospedagem.PagamentoRegistrado", pag("p1", "pix"));
    await publicar("hospedagem.PagamentoEstornado", estorno("p1"));
    await processarPendentes(ctx);
    await ignorado(900, "hospedagem.PagamentoEstornado", estorno("p1"));
    const r = await corrigir(900);
    expect(r.status).toBe(422);
    expect(r.corpo.mensagem).toMatch(/nada a desfazer|já estava desfeito/i);
    await ignorado(901, "hospedagem.PagamentoEstornado", estorno("nao-existe"));
    expect((await corrigir(901)).status).toBe(422);
    expect((await chamar("GET", "/fila")).corpo.ignorados.every((i: any) => !i.corrigido)).toBe(true);
    expect((await corrigir(999)).status).toBe(422); // evento que não foi ignorado
  });

  test("pagamento registrado e ignorado: a correção o registra como o evento faria (uma só vez)", async () => {
    await ignorado(800, "hospedagem.PagamentoRegistrado", pag("p7", "pix", 7000));
    expect((await corrigir(800)).status).toBe(200);
    expect(await saldo()).toBe(7000);
    expect((await corrigir(800)).status).toBe(422);
    expect(await saldo()).toBe(7000);
  });

  test("o alerta de evento ignorado não manda lançar à mão: aponta a correção da Fila", async () => {
    await publicar("hospedagem.ValorAReceberCriado", { valorAReceberId: "v-falta", contaId: "c1", reservaId: "r1", valor: 9000 });
    await processarPendentes(ctx);
    const seq = (await chamar("GET", "/fila")).corpo.bloqueado.seq;
    await chamar("POST", "/fila/ignorar", { seq, motivo: "Dado inválido", supervisor: SUP });
    const [a] = await alertas("financeiro_evento_ignorado");
    expect(a!.mensagem).not.toMatch(/à mão/);
    expect(a!.mensagem).toMatch(/Aplicar correção/);
  });
});

describe("estorno de um pagamento cujo registro foi ignorado", () => {
  test("não some em silêncio: abre alerta ligando o estorno ao evento ignorado", async () => {
    await ignorado(800, "hospedagem.PagamentoRegistrado", pag("p7", "pix", 7000));
    await publicar("hospedagem.PagamentoEstornado", estorno("p7", 7000));
    await processarPendentes(ctx);
    const [a] = await alertas("financeiro_estorno_de_ignorado");
    expect(a).toBeDefined();
    expect(a!.mensagem).toMatch(/nº 800/);
    expect(a!.mensagem).toMatch(/p7/);
    expect(await saldo()).toBe(0);
  });
});
