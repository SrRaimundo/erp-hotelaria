import { sql } from "kysely";
import type { Migracao } from "../shared/banco.js";
import { PERFIS_PADRAO } from "./permissoes.js";
import { hashSenhaSync } from "./usuarios.js";

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

export const migracaoNucleoCadastros: Migracao = {
  nome: "0210_nucleo_cadastros",
  async up(db) {
    await db.schema
      .createTable("hospedes")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("nome", "text", (c) => c.notNull())
      .addColumn("nome_busca", "text", (c) => c.notNull())
      .addColumn("documento_tipo", "text", (c) => c.notNull())
      .addColumn("documento", "text")
      .addColumn("nascimento", "text")
      .addColumn("nacionalidade", "text", (c) => c.notNull())
      .addColumn("telefone", "text")
      .addColumn("email", "text")
      .addColumn("endereco", "text")
      .addColumn("observacoes", "text")
      .execute();
    await db.schema
      .createIndex("hospedes_documento_unico")
      .on("hospedes")
      .columns(["documento_tipo", "documento"])
      .unique()
      .execute();
    await db.schema.createIndex("hospedes_nome_busca").on("hospedes").column("nome_busca").execute();

    await db.schema
      .createTable("produtos")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("codigo", "text", (c) => c.notNull().unique())
      .addColumn("nome", "text", (c) => c.notNull())
      .addColumn("preco_centavos", "integer", (c) => c.notNull())
      .addColumn("unidade", "text", (c) => c.notNull())
      .addColumn("grupo", "text", (c) => c.notNull())
      .addColumn("tipo", "text", (c) => c.notNull())
      .execute();
    const seeds = [
      { id: "prod-early-checkin", codigo: "EARLY_CHECKIN", nome: "Early check-in" },
      { id: "prod-late-checkout", codigo: "LATE_CHECKOUT", nome: "Late check-out" },
      { id: "prod-cama-extra", codigo: "CAMA_EXTRA", nome: "Cama extra" },
    ];
    for (const s of seeds) {
      await db
        .insertInto("produtos")
        .values({ ...s, preco_centavos: 0, unidade: "un", grupo: "servicos", tipo: "servico" })
        .execute();
    }

    await db.schema
      .createTable("formas_pagamento")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("codigo", "text", (c) => c.notNull().unique())
      .addColumn("nome", "text", (c) => c.notNull())
      .addColumn("ativa", "integer", (c) => c.notNull().defaultTo(1))
      .addColumn("ordem", "integer", (c) => c.notNull())
      .execute();
    const formas = [
      ["dinheiro", "Dinheiro"],
      ["pix", "Pix"],
      ["debito", "Cartão de débito"],
      ["credito", "Cartão de crédito"],
      ["faturado", "Faturado"],
    ];
    for (const [i, [codigo, nome]] of formas.entries()) {
      await db.insertInto("formas_pagamento").values({ id: `forma-${codigo}`, codigo, nome, ativa: 1, ordem: i }).execute();
    }
  },
};

export const migracaoNucleoUsuarios: Migracao = {
  nome: "0220_nucleo_usuarios",
  async up(db) {
    await db.schema
      .createTable("perfis")
      .addColumn("nome", "text", (c) => c.primaryKey())
      .addColumn("limite_desconto", "integer", (c) => c.notNull())
      .execute();
    await db.schema
      .createTable("perfil_permissoes")
      .addColumn("perfil", "text", (c) => c.notNull().references("perfis.nome"))
      .addColumn("permissao", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("perfil_permissoes_pk", ["perfil", "permissao"])
      .execute();
    await db.schema
      .createTable("usuarios")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("nome", "text", (c) => c.notNull())
      .addColumn("login", "text", (c) => c.notNull().unique())
      .addColumn("senha_hash", "text", (c) => c.notNull())
      .addColumn("senha_salt", "text", (c) => c.notNull())
      .addColumn("perfil", "text", (c) => c.notNull().references("perfis.nome"))
      .addColumn("trocar_senha", "integer", (c) => c.notNull().defaultTo(0))
      .execute();
    await db.schema
      .createTable("sessoes")
      .addColumn("token", "text", (c) => c.primaryKey())
      .addColumn("usuario_id", "text", (c) => c.notNull().references("usuarios.id"))
      .addColumn("criada_em", "text", (c) => c.notNull())
      .execute();
    for (const p of PERFIS_PADRAO) {
      await db.insertInto("perfis").values({ nome: p.nome, limite_desconto: p.limiteDesconto }).execute();
      for (const permissao of p.permissoes) await db.insertInto("perfil_permissoes").values({ perfil: p.nome, permissao }).execute();
    }
    const { hash, salt } = hashSenhaSync("admin");
    await db
      .insertInto("usuarios")
      .values({ id: "usuario-admin", nome: "Administrador", login: "admin", senha_hash: hash, senha_salt: salt, perfil: "admin", trocar_senha: 1 })
      .execute();
  },
};
