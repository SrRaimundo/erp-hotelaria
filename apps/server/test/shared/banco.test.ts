import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { sql } from "kysely";
import { abrirBanco, migrar } from "../../src/shared/banco.js";
import { novoId } from "../../src/shared/ids.js";
import { emTransacao } from "../../src/shared/contexto.js";
import { criarContextoTeste } from "../ajuda.js";

test("banco abre com WAL e foreign keys", async () => {
  const db = abrirBanco(join(tmpdir(), `t-${novoId()}.db`));
  const { rows } = await sql`PRAGMA journal_mode`.execute(db);
  expect((rows[0] as any).journal_mode).toBe("wal");
  const fk = await sql`PRAGMA foreign_keys`.execute(db);
  expect((fk.rows[0] as any).foreign_keys).toBe(1);
  await db.destroy();
});

test("migrar aplica migrações em ordem de nome e é idempotente", async () => {
  const db = abrirBanco(":memory:");
  const ordem: string[] = [];
  const migs = [
    { nome: "0200_b", up: async () => { ordem.push("b"); } },
    { nome: "0100_a", up: async (d: any) => { ordem.push("a"); await sql`create table t (id integer)`.execute(d); } },
  ];
  await migrar(db, migs);
  await migrar(db, migs);
  expect(ordem).toEqual(["a", "b"]);
  await db.destroy();
});

test("emTransacao despacha eventos só após o commit", async () => {
  const ctx = await criarContextoTeste();
  await sql`create table x (id integer)`.execute(ctx.db);
  const vistos: unknown[] = [];
  (ctx.barramento as any).publicar = (e: unknown) => vistos.push(e);
  await emTransacao(ctx, async (tx) => {
    await sql`insert into x values (1)`.execute(tx.db);
    tx.eventosPendentes.push({ tipo: "a" });
    expect(vistos).toEqual([]);
  });
  expect(vistos).toEqual([{ tipo: "a" }]);
});

test("emTransacao descarta eventos e desfaz em caso de erro", async () => {
  const ctx = await criarContextoTeste();
  await sql`create table x (id integer)`.execute(ctx.db);
  const vistos: unknown[] = [];
  (ctx.barramento as any).publicar = (e: unknown) => vistos.push(e);
  await expect(
    emTransacao(ctx, async (tx) => {
      await sql`insert into x values (1)`.execute(tx.db);
      tx.eventosPendentes.push({ tipo: "a" });
      throw new Error("falhou");
    }),
  ).rejects.toThrow("falhou");
  expect(vistos).toEqual([]);
  const { rows } = await sql`select * from x`.execute(ctx.db);
  expect(rows).toEqual([]);
});

test("assinante que lança não derruba emTransacao nem os demais eventos", async () => {
  const ctx = await criarContextoTeste();
  const vistos: unknown[] = [];
  (ctx.barramento as any).publicar = (e: any) => {
    if (e.tipo === "ruim") throw new Error("assinante falhou");
    vistos.push(e);
  };
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  const r = await emTransacao(ctx, async (tx) => {
    tx.eventosPendentes.push({ tipo: "ruim" }, { tipo: "bom" });
    return 42;
  });
  expect(r).toBe(42);
  expect(vistos).toEqual([{ tipo: "bom" }]);
  expect(erro).toHaveBeenCalledTimes(1);
  erro.mockRestore();
});

test("0440: pagamentos aceita turno nulo e preserva dados, estornos e índices", async () => {
  const { todasMigracoes } = await import("../../src/shared/migracoes.js");
  const db = abrirBanco(":memory:");
  await migrar(db, todasMigracoes.filter((m) => m.nome < "0440"));
  await db.insertInto("hospedes").values({ id: "h1", nome: "T", nome_busca: "t", documento_tipo: "cpf", documento: "1", nacionalidade: "BR" }).execute();
  await db.insertInto("contas").values({ id: "c1", titular_id: "h1", situacao: "aberta" }).execute();
  await db.insertInto("turnos_caixa").values({ id: "t1", usuario_id: "usuario-admin", aberto_em: "2026-01-01T00:00:00Z", valor_inicial: 0 }).execute();
  const base = { conta_id: "c1", reserva_id: null, forma_codigo: "pix", turno_id: "t1", instante: "2026-01-01T00:00:00Z", usuario: "u" };
  await db.insertInto("pagamentos").values({ ...base, id: "p1", valor: 100, estorna_id: null }).execute();
  await db.insertInto("pagamentos").values({ ...base, id: "p2", valor: -100, estorna_id: "p1" }).execute();

  await migrar(db, todasMigracoes);
  expect(await db.selectFrom("pagamentos").select(["id", "estorna_id", "turno_id"]).orderBy("id").execute()).toEqual([
    { id: "p1", estorna_id: null, turno_id: "t1" },
    { id: "p2", estorna_id: "p1", turno_id: "t1" },
  ]);
  await db.insertInto("pagamentos").values({ ...base, id: "p3", forma_codigo: "faturado", valor: 50, estorna_id: null, turno_id: null }).execute();
  expect((await sql`PRAGMA foreign_key_check`.execute(db)).rows).toEqual([]);
  await expect(db.insertInto("pagamentos").values({ ...base, id: "p4", valor: -100, estorna_id: "p1" }).execute()).rejects.toThrow(/UNIQUE/);
  await expect(db.insertInto("pagamentos").values({ ...base, id: "p5", valor: 1, estorna_id: "nao-existe" }).execute()).rejects.toThrow(/FOREIGN KEY/);
  await db.destroy();
});
