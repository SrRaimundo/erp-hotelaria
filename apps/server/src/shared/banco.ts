import Database from "better-sqlite3";
import { Kysely, Migrator, SqliteDialect, type MigrationProvider } from "kysely";

export type Migracao = { nome: string; up(db: Kysely<any>): Promise<void> };

export function abrirBanco(caminho: string): Kysely<any> {
  const sqlite = new Database(caminho);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return new Kysely<any>({ dialect: new SqliteDialect({ database: sqlite }) });
}

/** Aplica as migrações pendentes, ordenadas pelo nome (prefixo numérico por módulo). */
export async function migrar(db: Kysely<any>, migracoes: Migracao[]): Promise<void> {
  const provider: MigrationProvider = {
    async getMigrations() {
      return Object.fromEntries(migracoes.map((m) => [m.nome, { up: m.up }]));
    },
  };
  const { error } = await new Migrator({ db, provider }).migrateToLatest();
  if (error) throw error;
}
