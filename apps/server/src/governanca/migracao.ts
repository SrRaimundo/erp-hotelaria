import { sql } from "kysely";
import type { Migracao } from "../shared/banco.js";

/** Setor do lançamento (nasce com ele e nunca muda) e setores em que cada produto é vendido. */
export const migracaoGovernancaSetores: Migracao = {
  nome: "0500_governanca_setores",
  async up(db) {
    await sql`ALTER TABLE lancamentos ADD COLUMN setor TEXT NOT NULL DEFAULT 'recepcao'`.execute(db);
    await sql`UPDATE lancamentos SET setor = 'hospedagem'
      WHERE tipo = 'diaria'
         OR produto_id IN (SELECT id FROM produtos WHERE codigo IN ('EARLY_CHECKIN', 'LATE_CHECKOUT'))`.execute(db);
    await sql`UPDATE lancamentos SET setor = (SELECT o.setor FROM lancamentos o WHERE o.id = lancamentos.estorna_id)
      WHERE estorna_id IS NOT NULL`.execute(db);

    await db.schema
      .createTable("produto_setores")
      .addColumn("produto_id", "text", (c) => c.notNull().references("produtos.id"))
      .addColumn("setor", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("produto_setores_pk", ["produto_id", "setor"])
      .execute();
    await sql`INSERT INTO produto_setores (produto_id, setor)
      SELECT id, CASE WHEN codigo IN ('EARLY_CHECKIN', 'LATE_CHECKOUT') THEN 'hospedagem' ELSE 'recepcao' END FROM produtos`.execute(db);
  },
};
