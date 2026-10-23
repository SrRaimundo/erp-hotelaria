import { expect, test, vi } from "vitest";
import { emTransacao } from "../../src/shared/contexto.js";
import { registrarEvento } from "../../src/infra/outbox.js";
import { Barramento } from "../../src/infra/barramento.js";
import { ATOR_SISTEMA, auditar } from "../../src/infra/auditoria.js";
import { alertasAbertos, criarAlerta, resolverAlerta } from "../../src/infra/alertas.js";
import { criarContextoTeste } from "../ajuda.js";

test("eventos recebem seq crescente e ids únicos", async () => {
  const ctx = await criarContextoTeste();
  const a = await emTransacao(ctx, (tx) => registrarEvento(tx, "x.A", {}));
  const b = await emTransacao(ctx, (tx) => registrarEvento(tx, "x.B", {}));
  expect(b.seq).toBeGreaterThan(a.seq);
  expect(b.id).not.toBe(a.id);
});

test("evento de transação revertida não fica no outbox nem é publicado", async () => {
  const ctx = await criarContextoTeste();
  const recebidos: string[] = [];
  ctx.barramento.assinar("x.A", (e) => { recebidos.push(e.tipo); });
  await expect(
    emTransacao(ctx, async (tx) => {
      await registrarEvento(tx, "x.A", {});
      throw new Error("falhou");
    }),
  ).rejects.toThrow();
  expect(await ctx.db.selectFrom("outbox").selectAll().execute()).toHaveLength(0);
  expect(recebidos).toEqual([]);
});

test("evento é publicado após o commit, com payload e instante", async () => {
  const ctx = await criarContextoTeste();
  const recebidos: any[] = [];
  ctx.barramento.assinar("x.A", (e) => { recebidos.push(e); });
  const r = await emTransacao(ctx, async (tx) => {
    const r = await registrarEvento(tx, "x.A", { n: 1 });
    expect(recebidos).toEqual([]); // ainda dentro da transação
    return r;
  });
  expect(recebidos).toHaveLength(1);
  expect(recebidos[0]).toMatchObject({ id: r.id, seq: r.seq, tipo: "x.A", payload: { n: 1 }, criadoEm: "2026-11-10T15:00:00.000Z" });
});

test("assinante que falha (síncrono ou assíncrono) não afeta os demais", async () => {
  const ctx = await criarContextoTeste();
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  const recebidos: string[] = [];
  ctx.barramento.assinar("x.A", () => { throw new Error("sync"); });
  ctx.barramento.assinar("x.A", async () => { throw new Error("async"); });
  ctx.barramento.assinar("x.A", (e) => { recebidos.push(e.tipo); });
  await emTransacao(ctx, (tx) => registrarEvento(tx, "x.A", {}));
  await new Promise((r) => setTimeout(r, 5));
  expect(recebidos).toEqual(["x.A"]);
  expect(erro).toHaveBeenCalledTimes(2);
  erro.mockRestore();
});

test("barramento entrega só aos assinantes do tipo", () => {
  const b = new Barramento();
  const r: string[] = [];
  b.assinar("a", (e) => { r.push("a:" + e.tipo); });
  b.publicar({ id: "1", seq: 1, tipo: "b", payload: {}, criadoEm: "x" });
  expect(r).toEqual([]);
});

test("auditoria registra ator Sistema", async () => {
  const ctx = await criarContextoTeste();
  await emTransacao(ctx, (tx) =>
    auditar(tx, { ator: ATOR_SISTEMA, acao: "reserva.expirada", alvoTipo: "reserva", alvoId: "r1", dados: { a: 1 } }),
  );
  const linhas = await ctx.db.selectFrom("auditoria").selectAll().execute();
  expect(linhas).toHaveLength(1);
  expect(linhas[0]).toMatchObject({ ator: "Sistema", acao: "reserva.expirada", alvo_id: "r1", motivo: null, supervisor_id: null, instante: "2026-11-10T15:00:00.000Z" });
  expect(JSON.parse(linhas[0].dados)).toEqual({ a: 1 });
});

test("alerta aberto não duplica; resolvido permite novo", async () => {
  const ctx = await criarContextoTeste();
  const a = { tipo: "sinal_vencido", alvoTipo: "reserva", alvoId: "r1", mensagem: "m" };
  const id1 = await emTransacao(ctx, (tx) => criarAlerta(tx, a));
  const id2 = await emTransacao(ctx, (tx) => criarAlerta(tx, a));
  expect(id2).toBe(id1);
  expect(await alertasAbertos(ctx)).toHaveLength(1);
  await emTransacao(ctx, (tx) => resolverAlerta(tx, id1, "u1"));
  expect(await alertasAbertos(ctx)).toHaveLength(0);
  const row = await ctx.db.selectFrom("alertas").selectAll().executeTakeFirstOrThrow();
  expect(row).toMatchObject({ resolvido_por: "u1", resolvido_em: "2026-11-10T15:00:00.000Z" });
  await emTransacao(ctx, (tx) => criarAlerta(tx, a));
  expect(await alertasAbertos(ctx)).toHaveLength(1);
});
