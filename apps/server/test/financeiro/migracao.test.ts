import { expect, test } from "vitest";
import { sql } from "kysely";
import { abrirBanco, migrar } from "../../src/shared/banco.js";

test("financeiro: 16 tabelas criadas corretamente", async () => {
  const { todasMigracoes } = await import("../../src/shared/migracoes.js");
  const db = abrirBanco(":memory:");
  await migrar(db, todasMigracoes);

  // Verify all 10 tables exist
  const { rows: tables } = await sql`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name LIKE 'fin_%'
    ORDER BY name
  `.execute(db);

  const tableNames = tables.map((t: any) => t.name).sort();
  const expectedTables = [
    "fin_cartao_movimento",
    "fin_cliente",
    "fin_condicao_cartao",
    "fin_cursor",
    "fin_conta_bancaria",
    "fin_conta_receber",
    "fin_faturamento",
    "fin_lancamento",
    "fin_local",
    "fin_moeda",
    "fin_movimento",
    "fin_saldo",
    "fin_evento_ignorado",
    "fin_fornecedor",
    "fin_idempotencia",
    "fin_titulo",
  ].sort();

  expect(tableNames).toEqual(expectedTables);
  await db.destroy();
});

test("financeiro: indexes criados corretamente", async () => {
  const { todasMigracoes } = await import("../../src/shared/migracoes.js");
  const db = abrirBanco(":memory:");
  await migrar(db, todasMigracoes);

  // Verify indexes exist
  const { rows: indexes } = await sql`
    SELECT name, tbl_name FROM sqlite_master
    WHERE type='index' AND name LIKE 'fin_%'
    ORDER BY name
  `.execute(db);

  const indexNames = indexes.map((i: any) => i.name).sort();

  // Expected indexes: (local_id, data) on fin_lancamento and fin_movimento; (conta_id, data) on fin_saldo
  expect(indexNames).toContain("fin_lancamento_local_data");
  expect(indexNames).toContain("fin_movimento_conta_data");
  expect(indexNames).toContain("fin_saldo_conta_data");
  expect(indexNames).toContain("fin_cliente_cpf_cnpj_per_local");
  expect(indexNames).toContain("fin_fornecedor_cnpj_per_local");
  expect(indexNames).toContain("fin_conta_bancaria_numero_per_local");

  await db.destroy();
});

test("financeiro: constraints UNIQUE aplicados corretamente", async () => {
  const { todasMigracoes } = await import("../../src/shared/migracoes.js");
  const db = abrirBanco(":memory:");
  await migrar(db, todasMigracoes);

  // Insert test data
  await db
    .insertInto("fin_local")
    .values([
      { id: "local-1", pousada_id: "pousada-1", nome: "Local 1", ativo: 1, criado_em: "2026-01-01T00:00:00Z" },
      { id: "local-2", pousada_id: "pousada-2", nome: "Local 2", ativo: 1, criado_em: "2026-01-01T00:00:00Z" },
    ])
    .execute();

  await db
    .insertInto("fin_moeda")
    .values([{ id: "moeda-1", codigo: "BRL", nome: "Real Brasileiro", taxa_cambio: "1.0" }])
    .execute();

  // Test: UNIQUE pousada_id (fin_local)
  await expect(
    db
      .insertInto("fin_local")
      .values({ id: "local-3", pousada_id: "pousada-1", nome: "Duplicate", ativo: 1, criado_em: "2026-01-01T00:00:00Z" })
      .execute()
  ).rejects.toThrow(/UNIQUE/);

  // Test: UNIQUE codigo (fin_moeda)
  await expect(
    db.insertInto("fin_moeda").values({ id: "moeda-2", codigo: "BRL", nome: "Duplicate", taxa_cambio: "2.0" }).execute()
  ).rejects.toThrow(/UNIQUE/);

  // Test: UNIQUE per local for cpf_cnpj (fin_cliente)
  await db
    .insertInto("fin_cliente")
    .values([
      { id: "cli-1", local_id: "local-1", nome: "Cliente 1", cpf_cnpj: "123456789", tipo: "pessoa_fisica", criado_em: "2026-01-01T00:00:00Z" },
    ])
    .execute();

  await expect(
    db
      .insertInto("fin_cliente")
      .values({
        id: "cli-2",
        local_id: "local-1",
        nome: "Cliente 2",
        cpf_cnpj: "123456789",
        tipo: "pessoa_fisica",
        criado_em: "2026-01-01T00:00:00Z",
      })
      .execute()
  ).rejects.toThrow(/UNIQUE/);

  // Same CPF in different local should work
  await db
    .insertInto("fin_cliente")
    .values({
      id: "cli-3",
      local_id: "local-2",
      nome: "Cliente 3",
      cpf_cnpj: "123456789",
      tipo: "pessoa_fisica",
      criado_em: "2026-01-01T00:00:00Z",
    })
    .execute();

  // Test: UNIQUE per local for cnpj (fin_fornecedor)
  await db
    .insertInto("fin_fornecedor")
    .values([
      { id: "forn-1", local_id: "local-1", razao_social: "Fornecedor 1", cnpj: "987654321", criado_em: "2026-01-01T00:00:00Z" },
    ])
    .execute();

  await expect(
    db
      .insertInto("fin_fornecedor")
      .values({
        id: "forn-2",
        local_id: "local-1",
        razao_social: "Fornecedor 2",
        cnpj: "987654321",
        criado_em: "2026-01-01T00:00:00Z",
      })
      .execute()
  ).rejects.toThrow(/UNIQUE/);

  // Test: UNIQUE per local for numero (fin_conta_bancaria)
  await db
    .insertInto("fin_conta_bancaria")
    .values([
      {
        id: "conta-1",
        local_id: "local-1",
        nome: "Conta 1",
        banco: "Banco do Brasil",
        agencia: "0001",
        numero: "12345678",
        tipo: "corrente",
        saldo_inicial: 0,
        criado_em: "2026-01-01T00:00:00Z",
      },
    ])
    .execute();

  await expect(
    db
      .insertInto("fin_conta_bancaria")
      .values({
        id: "conta-2",
        local_id: "local-1",
        nome: "Conta 2",
        banco: "Caixa",
        agencia: "0002",
        numero: "12345678",
        tipo: "poupanca",
        saldo_inicial: 0,
        criado_em: "2026-01-01T00:00:00Z",
      })
      .execute()
  ).rejects.toThrow(/UNIQUE/);

  // Same numero in different local should work
  await db
    .insertInto("fin_conta_bancaria")
    .values({
      id: "conta-3",
      local_id: "local-2",
      nome: "Conta 3",
      banco: "Bradesco",
      agencia: "0003",
      numero: "12345678",
      tipo: "corrente",
      saldo_inicial: 0,
      criado_em: "2026-01-01T00:00:00Z",
    })
    .execute();

  await db.destroy();
});

test("financeiro: foreign keys sem circular dependencies", async () => {
  const { todasMigracoes } = await import("../../src/shared/migracoes.js");
  const db = abrirBanco(":memory:");
  await migrar(db, todasMigracoes);

  // Check for FK violations
  const { rows: fkCheck } = await sql`PRAGMA foreign_key_check`.execute(db);
  expect(fkCheck).toEqual([]);

  await db.destroy();
});

test("financeiro: todos os índices estão presentes nas colunas corretas", async () => {
  const { todasMigracoes } = await import("../../src/shared/migracoes.js");
  const db = abrirBanco(":memory:");
  await migrar(db, todasMigracoes);

  // Check fin_lancamento index
  const { rows: lancIndexes } = await sql`PRAGMA index_info(fin_lancamento_local_data)`.execute(db);
  expect(lancIndexes.map((r: any) => r.name)).toEqual(["local_id", "data"]);

  // Check fin_movimento index
  const { rows: movIndexes } = await sql`PRAGMA index_info(fin_movimento_conta_data)`.execute(db);
  expect(movIndexes.map((r: any) => r.name)).toEqual(["conta_id", "data"]);

  // Check fin_saldo index
  const { rows: saldoIndexes } = await sql`PRAGMA index_info(fin_saldo_conta_data)`.execute(db);
  expect(saldoIndexes.map((r: any) => r.name)).toEqual(["conta_id", "data"]);

  await db.destroy();
});

test("financeiro: todas as colunas estão presentes e com tipos corretos", async () => {
  const { todasMigracoes } = await import("../../src/shared/migracoes.js");
  const db = abrirBanco(":memory:");
  await migrar(db, todasMigracoes);

  // Check fin_local columns
  const { rows: localCols } = await sql`PRAGMA table_info(fin_local)`.execute(db);
  const localColNames = localCols.map((c: any) => c.name);
  expect(localColNames).toEqual(["id", "pousada_id", "nome", "ativo", "parametros", "criado_em"]);

  // Check fin_lancamento columns
  const { rows: lancCols } = await sql`PRAGMA table_info(fin_lancamento)`.execute(db);
  const lancColNames = lancCols.map((c: any) => c.name);
  expect(lancColNames).toEqual([
    "id",
    "local_id",
    "data",
    "tipo",
    "origem",
    "valor",
    "forma_pagamento",
    "status",
    "referencia_id",
    "referencia_tipo",
    "criado_por",
    "criado_em",
    "dispositivo",
    "motivo_cancelamento",
    "atualizado_por",
    "atualizado_em",
    "descricao",
    "categoria",
    "vencimento",
    "fornecedor_id",
    "parcela_de",
    "valor_total",
    "titulo_id",
    "parcela_num",
    "parcela_total",
    "saldo_desfeito",
  ]);

  // Check fin_movimento columns
  const { rows: movCols } = await sql`PRAGMA table_info(fin_movimento)`.execute(db);
  const movColNames = movCols.map((c: any) => c.name);
  expect(movColNames).toEqual([
    "id",
    "local_id",
    "conta_id",
    "lancamento_id",
    "tipo",
    "valor",
    "saldo_anterior",
    "saldo_posterior",
    "data",
    "criado_em",
    "reversao",
  ]);

  // Check fin_saldo columns
  const { rows: saldoCols } = await sql`PRAGMA table_info(fin_saldo)`.execute(db);
  const saldoColNames = saldoCols.map((c: any) => c.name);
  expect(saldoColNames).toEqual(["id", "conta_id", "data", "saldo", "criado_em"]);

  await db.destroy();
});

test("financeiro: banco já migrado até a conta a receber manual recebe a migração de títulos sem perder dados", async () => {
  const { todasMigracoes } = await import("../../src/shared/migracoes.js");
  const db = abrirBanco(":memory:");
  const anteriores = todasMigracoes.filter((m) => m.nome < "0790");
  await migrar(db, anteriores);
  await sql`INSERT INTO fin_local (id, pousada_id, nome, ativo, parametros, criado_em) VALUES ('l1', 'p', 'Local', 1, '{}', '2026-01-01T00:00:00Z')`.execute(db);
  await sql`INSERT INTO fin_lancamento (id, local_id, data, tipo, origem, valor, forma_pagamento, status, criado_por, criado_em) VALUES ('x1', 'l1', '2026-01-01T00:00:00Z', 'pagamento', 'manual', 500, 'pix', 'pendente', 'u', '2026-01-01T00:00:00Z')`.execute(db);
  await migrar(db, todasMigracoes);
  const { rows } = await sql`SELECT valor, titulo_id, parcela_num, parcela_total FROM fin_lancamento WHERE id = 'x1'`.execute(db);
  expect(rows).toEqual([{ valor: 500, titulo_id: null, parcela_num: null, parcela_total: null }]);
  await db.destroy();
});
