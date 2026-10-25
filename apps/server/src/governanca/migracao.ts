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

type Modelo = Record<"limpeza" | "enxoval" | "equipamento" | "controles", string[]>;

const MODELO_SAIDA: Modelo = {
  limpeza: [
    "Banheiro limpo",
    "Apartamento varrido e passado pano",
    "Roupa de cama trocada",
    "Piso do banheiro e toalhas trocados",
    "Sabonetes, papel higiênico e utensílios repostos",
    "Aromatizante aplicado",
  ],
  enxoval: ["Toalhas", "Pisos", "Lençóis de casal", "Lençóis de solteiro"],
  equipamento: ["TV", "Rádio", "Ar-condicionado", "Água quente"],
  controles: ["Controle da TV", "Controle do ar-condicionado"],
};

const MODELO_DIARIA: Modelo = {
  limpeza: ["Banheiro limpo", "Apartamento varrido", "Toalhas e piso trocados", "Amenidades repostas"],
  enxoval: ["Toalhas", "Pisos", "Lençóis de casal", "Lençóis de solteiro"],
  equipamento: [],
  controles: ["Controle da TV", "Controle do ar-condicionado"],
};

/** Modelos de checklist (Saída e Diária) e seus itens; itens são desativados, nunca apagados. */
export const migracaoGovernancaModelos: Migracao = {
  nome: "0510_governanca_modelos",
  async up(db) {
    await db.schema
      .createTable("checklist_modelos")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("tipo", "text", (c) => c.notNull().unique())
      .execute();
    await db.schema
      .createTable("checklist_itens")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("modelo_id", "text", (c) => c.notNull().references("checklist_modelos.id"))
      .addColumn("etapa", "text", (c) => c.notNull())
      .addColumn("texto", "text", (c) => c.notNull())
      .addColumn("ordem", "integer", (c) => c.notNull())
      .addColumn("ativo", "integer", (c) => c.notNull().defaultTo(1))
      .execute();
    for (const [tipo, modelo] of [["saida", MODELO_SAIDA], ["diaria", MODELO_DIARIA]] as const) {
      const modeloId = `modelo-${tipo}`;
      await db.insertInto("checklist_modelos").values({ id: modeloId, tipo }).execute();
      let ordem = 0;
      for (const etapa of ["limpeza", "enxoval", "equipamento", "controles"] as const) {
        for (const texto of modelo[etapa]) {
          ordem += 1;
          await db.insertInto("checklist_itens").values({ id: `item-${tipo}-${ordem}`, modelo_id: modeloId, etapa, texto, ordem, ativo: 1 }).execute();
        }
      }
    }
  },
};
