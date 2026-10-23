import { sql } from "kysely";
import type { Migracao } from "../shared/banco.js";

export const migracaoNucleo: Migracao = {
  nome: "0200_nucleo",
  async up(db) {
    await db.schema
      .createTable("config_pousada")
      .addColumn("id", "integer", (c) => c.primaryKey().check(sql`id = 1`))
      .addColumn("dados", "text", (c) => c.notNull())
      .execute();
    await db.schema
      .createTable("categorias")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("nome", "text", (c) => c.notNull())
      .addColumn("max_adultos", "integer", (c) => c.notNull())
      .addColumn("max_criancas", "integer", (c) => c.notNull())
      .addColumn("comodidades", "text", (c) => c.notNull().defaultTo("[]"))
      .execute();
    await db.schema
      .createTable("quartos")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("numero", "text", (c) => c.notNull().unique())
      .addColumn("categoria_id", "text", (c) => c.notNull().references("categorias.id"))
      .addColumn("bloco", "text")
      .addColumn("situacao", "text", (c) => c.notNull().defaultTo("livre"))
      .execute();
  },
};
