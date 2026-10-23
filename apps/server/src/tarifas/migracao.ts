import type { Migracao } from "../shared/banco.js";

export const migracaoTarifas: Migracao = {
  nome: "0300_tarifas",
  async up(db) {
    await db.schema
      .createTable("tabelas_base")
      .addColumn("categoria_id", "text", (c) => c.primaryKey().references("categorias.id"))
      .addColumn("por_adultos", "text", (c) => c.notNull())
      .addColumn("adulto_extra", "integer", (c) => c.notNull())
      .addColumn("piso", "integer")
      .addColumn("teto", "integer")
      .execute();

    await db.schema
      .createTable("temporadas")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("nome", "text", (c) => c.notNull())
      .addColumn("inicio", "text", (c) => c.notNull())
      .addColumn("fim", "text", (c) => c.notNull())
      .addColumn("prioridade", "integer", (c) => c.notNull())
      .addColumn("percentual", "real")
      .execute();
    await db.schema
      .createTable("temporada_tabelas")
      .addColumn("temporada_id", "text", (c) => c.notNull().references("temporadas.id"))
      .addColumn("categoria_id", "text", (c) => c.notNull().references("categorias.id"))
      .addColumn("por_adultos", "text", (c) => c.notNull())
      .addColumn("adulto_extra", "integer", (c) => c.notNull())
      .addPrimaryKeyConstraint("temporada_tabelas_pk", ["temporada_id", "categoria_id"])
      .execute();

    await db.schema
      .createTable("percentuais_dia_semana")
      .addColumn("dia", "integer", (c) => c.primaryKey())
      .addColumn("percentual", "real", (c) => c.notNull())
      .execute();

    await db.schema
      .createTable("canais")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("nome", "text", (c) => c.notNull().unique())
      .addColumn("percentual", "real", (c) => c.notNull())
      .addColumn("exige_sinal", "integer", (c) => c.notNull())
      .execute();
    await db.insertInto("canais").values({ id: "canal-balcao", nome: "Balcão", percentual: 0, exige_sinal: 1 }).execute();

    await db.schema
      .createTable("faixas_ocupacao")
      .addColumn("acima_de", "real", (c) => c.primaryKey())
      .addColumn("percentual", "real", (c) => c.notNull())
      .execute();

    await db.schema
      .createTable("faixas_crianca")
      .addColumn("idade_min", "integer", (c) => c.primaryKey())
      .addColumn("idade_max", "integer", (c) => c.notNull())
      .addColumn("tipo", "text", (c) => c.notNull())
      .addColumn("valor", "real", (c) => c.notNull())
      .execute();
    await db
      .insertInto("faixas_crianca")
      .values([
        { idade_min: 0, idade_max: 5, tipo: "gratis", valor: 0 },
        { idade_min: 6, idade_max: 11, tipo: "percentual_adicional", valor: 50 },
      ])
      .execute();

    await db.schema
      .createTable("pacotes")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("nome", "text", (c) => c.notNull())
      .addColumn("categoria_id", "text", (c) => c.notNull().references("categorias.id"))
      .addColumn("inicio", "text", (c) => c.notNull())
      .addColumn("fim", "text", (c) => c.notNull())
      .addColumn("min_noites", "integer", (c) => c.notNull())
      .addColumn("valor_noite", "text", (c) => c.notNull())
      .addColumn("ativo", "integer", (c) => c.notNull())
      .execute();

    await db.schema
      .createTable("restricoes")
      .addColumn("categoria_id", "text", (c) => c.notNull().references("categorias.id"))
      .addColumn("data", "text", (c) => c.notNull())
      .addColumn("min_noites", "integer")
      .addColumn("fechado_chegada", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("fechado_saida", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("fechado_venda", "integer", (c) => c.notNull().defaultTo(0))
      .addPrimaryKeyConstraint("restricoes_pk", ["categoria_id", "data"])
      .execute();
  },
};
