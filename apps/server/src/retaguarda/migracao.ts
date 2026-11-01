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

/** Usuários: desativar em vez de apagar e registro do último acesso. */
export const migracaoRetaguardaUsuarios: Migracao = {
  nome: "0610_retaguarda_usuarios",
  async up(db) {
    await sql.raw("ALTER TABLE usuarios ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1").execute(db);
    await sql.raw("ALTER TABLE usuarios ADD COLUMN ultimo_acesso TEXT").execute(db);
  },
};

/** Perfis personalizados: nome de exibição (`rotulo`) e marca dos três perfis padrão. */
export const migracaoRetaguardaPerfis: Migracao = {
  nome: "0620_retaguarda_perfis",
  async up(db) {
    await sql.raw("ALTER TABLE perfis ADD COLUMN rotulo TEXT NOT NULL DEFAULT ''").execute(db);
    await sql.raw("ALTER TABLE perfis ADD COLUMN padrao INTEGER NOT NULL DEFAULT 0").execute(db);
    const rotulos: Record<string, string> = { admin: "Administrador", recepcao: "Recepção", governanca: "Governança" };
    for (const [nome, rotulo] of Object.entries(rotulos)) {
      await db.updateTable("perfis").set({ rotulo, padrao: 1 }).where("nome", "=", nome).execute();
    }
    await sql.raw("UPDATE perfis SET rotulo = nome WHERE rotulo = ''").execute(db);
  },
};
