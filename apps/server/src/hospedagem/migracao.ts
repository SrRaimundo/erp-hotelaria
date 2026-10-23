import type { Migracao } from "../shared/banco.js";

export const migracaoHospedagem: Migracao = {
  nome: "0400_hospedagem",
  async up(db) {
    await db.schema
      .createTable("contas")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("titular_id", "text", (c) => c.notNull().references("hospedes.id"))
      .addColumn("situacao", "text", (c) => c.notNull()) // "aberta" | "fechada"
      .execute();
    await db.schema
      .createTable("grupos")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("titular_id", "text", (c) => c.notNull().references("hospedes.id"))
      .addColumn("cobranca", "text", (c) => c.notNull()) // "unica" | "separada"
      .execute();
    await db.schema
      .createTable("reservas")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("codigo", "integer", (c) => c.notNull().unique())
      .addColumn("estado", "text", (c) => c.notNull())
      .addColumn("titular_id", "text", (c) => c.notNull().references("hospedes.id"))
      .addColumn("categoria_id", "text", (c) => c.notNull().references("categorias.id"))
      .addColumn("quarto_id", "text", (c) => c.references("quartos.id"))
      .addColumn("chegada", "text", (c) => c.notNull())
      .addColumn("saida", "text", (c) => c.notNull())
      .addColumn("adultos", "integer", (c) => c.notNull())
      .addColumn("criancas", "text", (c) => c.notNull().defaultTo("[]")) // JSON: nascimentos
      .addColumn("canal", "text", (c) => c.notNull())
      .addColumn("observacoes", "text")
      .addColumn("grupo_id", "text", (c) => c.references("grupos.id"))
      .addColumn("conta_id", "text", (c) => c.notNull().references("contas.id"))
      .addColumn("valor_sinal", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("prazo_sinal", "text")
      .addColumn("aviso_sinal_em", "text")
      .addColumn("criada_em", "text", (c) => c.notNull())
      .execute();
    await db.schema.createIndex("reservas_categoria_periodo").on("reservas").columns(["categoria_id", "chegada", "saida"]).execute();
    await db.schema
      .createTable("reserva_noites")
      .addColumn("reserva_id", "text", (c) => c.notNull().references("reservas.id"))
      .addColumn("data", "text", (c) => c.notNull())
      .addColumn("valor", "integer", (c) => c.notNull())
      .addColumn("passos", "text", (c) => c.notNull()) // JSON
      .addPrimaryKeyConstraint("reserva_noites_pk", ["reserva_id", "data"])
      .execute();
    await db.schema
      .createTable("acompanhantes")
      .addColumn("reserva_id", "text", (c) => c.notNull().references("reservas.id"))
      .addColumn("hospede_id", "text", (c) => c.notNull().references("hospedes.id"))
      .addPrimaryKeyConstraint("acompanhantes_pk", ["reserva_id", "hospede_id"])
      .execute();
  },
};
