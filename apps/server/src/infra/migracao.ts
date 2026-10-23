import type { Migracao } from "../shared/banco.js";

export const migracaoInfra: Migracao = {
  nome: "0100_infra",
  async up(db) {
    await db.schema
      .createTable("outbox")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("seq", "integer", (c) => c.notNull().unique())
      .addColumn("tipo", "text", (c) => c.notNull())
      .addColumn("payload", "text", (c) => c.notNull())
      .addColumn("criado_em", "text", (c) => c.notNull())
      .addColumn("enviado_em", "text")
      .execute();
    await db.schema
      .createTable("auditoria")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("instante", "text", (c) => c.notNull())
      .addColumn("ator", "text", (c) => c.notNull())
      .addColumn("acao", "text", (c) => c.notNull())
      .addColumn("alvo_tipo", "text", (c) => c.notNull())
      .addColumn("alvo_id", "text", (c) => c.notNull())
      .addColumn("motivo", "text")
      .addColumn("supervisor_id", "text")
      .addColumn("dados", "text", (c) => c.notNull().defaultTo("{}"))
      .execute();
    await db.schema
      .createTable("alertas")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("tipo", "text", (c) => c.notNull())
      .addColumn("alvo_tipo", "text", (c) => c.notNull())
      .addColumn("alvo_id", "text", (c) => c.notNull())
      .addColumn("mensagem", "text", (c) => c.notNull())
      .addColumn("criado_em", "text", (c) => c.notNull())
      .addColumn("resolvido_em", "text")
      .addColumn("resolvido_por", "text")
      .execute();
    await db.schema.createIndex("alertas_abertos").on("alertas").columns(["tipo", "alvo_id"]).execute();
  },
};
