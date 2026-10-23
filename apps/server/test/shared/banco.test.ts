import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
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
