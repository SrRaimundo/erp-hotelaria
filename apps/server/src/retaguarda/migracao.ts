import { sql } from "kysely";
import type { Migracao } from "../shared/banco.js";

/** Desativar em vez de apagar: categorias, quartos e produtos ganham `ativo`. */
export const migracaoRetaguardaAtivos: Migracao = {
  nome: "0600_retaguarda_ativos",
  async up(db) {
    for (const tabela of ["categorias", "quartos", "produtos"]) {
      await sql.raw(`ALTER TABLE ${tabela} ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1`).execute(db);
    }
  },
};
