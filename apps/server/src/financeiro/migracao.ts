import { sql } from "kysely";
import type { Migracao } from "../shared/banco.js";

export const migracaoFinanceiro: Migracao = {
  nome: "0700_financeiro",
  async up(db) {
    // 1. fin_local — Local segregation
    await db.schema
      .createTable("fin_local")
      .ifNotExists()
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("pousada_id", "text", (c) => c.notNull().unique())
      .addColumn("nome", "text", (c) => c.notNull())
      .addColumn("ativo", "integer", (c) => c.notNull().defaultTo(1))
      .addColumn("parametros", "text")
      .addColumn("criado_em", "text", (c) => c.notNull())
      .execute();

    // 2. fin_cliente — Cadastro de clientes
    await db.schema
      .createTable("fin_cliente")
      .ifNotExists()
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("local_id", "text", (c) => c.notNull().references("fin_local.id"))
      .addColumn("nome", "text", (c) => c.notNull())
      .addColumn("cpf_cnpj", "text")
      .addColumn("tipo", "text", (c) => c.notNull())
      .addColumn("contato", "text")
      .addColumn("criado_em", "text", (c) => c.notNull())
      .execute();
    // UNIQUE per local
    await sql`CREATE UNIQUE INDEX fin_cliente_cpf_cnpj_per_local ON fin_cliente (local_id, cpf_cnpj) WHERE cpf_cnpj IS NOT NULL`.execute(
      db
    );

    // 3. fin_fornecedor — Cadastro de fornecedores
    await db.schema
      .createTable("fin_fornecedor")
      .ifNotExists()
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("local_id", "text", (c) => c.notNull().references("fin_local.id"))
      .addColumn("razao_social", "text", (c) => c.notNull())
      .addColumn("cnpj", "text")
      .addColumn("contato", "text")
      .addColumn("banco", "text")
      .addColumn("criado_em", "text", (c) => c.notNull())
      .execute();
    // UNIQUE per local
    await sql`CREATE UNIQUE INDEX fin_fornecedor_cnpj_per_local ON fin_fornecedor (local_id, cnpj) WHERE cnpj IS NOT NULL`.execute(
      db
    );

    // 4. fin_conta_bancaria — Contas bancárias
    await db.schema
      .createTable("fin_conta_bancaria")
      .ifNotExists()
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("local_id", "text", (c) => c.notNull().references("fin_local.id"))
      .addColumn("nome", "text", (c) => c.notNull())
      .addColumn("banco", "text", (c) => c.notNull())
      .addColumn("agencia", "text", (c) => c.notNull())
      .addColumn("numero", "text", (c) => c.notNull())
      .addColumn("tipo", "text", (c) => c.notNull())
      .addColumn("saldo_inicial", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("criado_em", "text", (c) => c.notNull())
      .execute();
    // UNIQUE per local
    await sql`CREATE UNIQUE INDEX fin_conta_bancaria_numero_per_local ON fin_conta_bancaria (local_id, numero)`.execute(
      db
    );

    // 5. fin_moeda — Moedas (global, not per local)
    await db.schema
      .createTable("fin_moeda")
      .ifNotExists()
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("codigo", "text", (c) => c.notNull().unique())
      .addColumn("nome", "text", (c) => c.notNull())
      .addColumn("taxa_cambio", "text")
      .execute();

    // 6. fin_lancamento — Core: all transactions
    await db.schema
      .createTable("fin_lancamento")
      .ifNotExists()
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("local_id", "text", (c) => c.notNull().references("fin_local.id"))
      .addColumn("data", "text", (c) => c.notNull())
      .addColumn("tipo", "text", (c) => c.notNull())
      .addColumn("origem", "text", (c) => c.notNull())
      .addColumn("valor", "integer", (c) => c.notNull())
      .addColumn("forma_pagamento", "text", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("referencia_id", "text")
      .addColumn("referencia_tipo", "text")
      .addColumn("criado_por", "text", (c) => c.notNull())
      .addColumn("criado_em", "text", (c) => c.notNull())
      .addColumn("dispositivo", "text")
      .addColumn("motivo_cancelamento", "text")
      .addColumn("atualizado_por", "text")
      .addColumn("atualizado_em", "text")
      .execute();
    // Index on (local_id, data)
    await db.schema
      .createIndex("fin_lancamento_local_data")
      .on("fin_lancamento")
      .columns(["local_id", "data"])
      .execute();

    // 7. fin_faturamento — Invoices (Hospedagem checkouts)
    await db.schema
      .createTable("fin_faturamento")
      .ifNotExists()
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("local_id", "text", (c) => c.notNull().references("fin_local.id"))
      .addColumn("cliente_id", "text", (c) => c.notNull().references("fin_cliente.id"))
      .addColumn("referencia_id", "text", (c) => c.notNull())
      .addColumn("valor_original", "integer", (c) => c.notNull())
      .addColumn("valor_liquido", "integer", (c) => c.notNull())
      .addColumn("data_vencimento", "text", (c) => c.notNull())
      .addColumn("forma_cobranca", "text", (c) => c.notNull())
      .addColumn("numero_documento", "text")
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("lançamentos_id", "text")
      .addColumn("criado_em", "text", (c) => c.notNull())
      .execute();

    // 8. fin_conta_receber — Receivables (Faturamento → receivement)
    await db.schema
      .createTable("fin_conta_receber")
      .ifNotExists()
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("local_id", "text", (c) => c.notNull().references("fin_local.id"))
      .addColumn("cliente_id", "text", (c) => c.notNull().references("fin_cliente.id"))
      .addColumn("numero_documento", "text", (c) => c.notNull())
      .addColumn("valor_original", "integer", (c) => c.notNull())
      .addColumn("valor_recebido", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("data_vencimento", "text", (c) => c.notNull())
      .addColumn("forma_pagamento", "text", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("conta_destino_id", "text")
      .addColumn("lançamentos_id", "text")
      .addColumn("criado_em", "text", (c) => c.notNull())
      .execute();

    // 9. fin_movimento — Caixa/Banco movements
    await db.schema
      .createTable("fin_movimento")
      .ifNotExists()
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("local_id", "text", (c) => c.notNull().references("fin_local.id"))
      .addColumn("conta_id", "text", (c) => c.notNull().references("fin_conta_bancaria.id"))
      .addColumn("lancamento_id", "text", (c) => c.notNull().references("fin_lancamento.id"))
      .addColumn("tipo", "text", (c) => c.notNull())
      .addColumn("valor", "integer", (c) => c.notNull())
      .addColumn("saldo_anterior", "integer", (c) => c.notNull())
      .addColumn("saldo_posterior", "integer", (c) => c.notNull())
      .addColumn("data", "text", (c) => c.notNull())
      .addColumn("criado_em", "text", (c) => c.notNull())
      .execute();
    // Index on (conta_id, data)
    await db.schema
      .createIndex("fin_movimento_conta_data")
      .on("fin_movimento")
      .columns(["conta_id", "data"])
      .execute();

    // 10. fin_saldo — Caixa/Banco balance history
    await db.schema
      .createTable("fin_saldo")
      .ifNotExists()
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("conta_id", "text", (c) => c.notNull().references("fin_conta_bancaria.id"))
      .addColumn("data", "text", (c) => c.notNull())
      .addColumn("saldo", "integer", (c) => c.notNull())
      .addColumn("criado_em", "text", (c) => c.notNull())
      .execute();
    // Index on (conta_id, data)
    await db.schema
      .createIndex("fin_saldo_conta_data")
      .on("fin_saldo")
      .columns(["conta_id", "data"])
      .execute();
  },
};

/**
 * Concede `financeiro.gerenciar` aos perfis `admin` já existentes. Idempotente (bancos novos já a recebem do seed).
 * Perfis personalizados copiados do admin NÃO são alterados: concedem-se pela tela de perfis.
 */
export const migracaoFinanceiroPermissao: Migracao = {
  nome: "0720_financeiro_permissao",
  async up(db) {
    await sql`INSERT OR IGNORE INTO perfil_permissoes (perfil, permissao) SELECT nome, 'financeiro.gerenciar' FROM perfis WHERE nome = 'admin'`.execute(db);
  },
};

/**
 * Fase 1b: Contas a Pagar (descrição, categoria, vencimento e fornecedor no lançamento),
 * política do cliente para o Faturamento e movimentos de cartão (crédito, débito e voucher) com bruto, taxa e líquido.
 */
export const migracaoFinanceiroPagarCartao: Migracao = {
  nome: "0730_financeiro_pagar_cartao",
  async up(db) {
    for (const coluna of ["descricao", "categoria", "vencimento", "fornecedor_id"]) {
      await sql.raw(`ALTER TABLE fin_lancamento ADD COLUMN ${coluna} text`).execute(db);
    }
    await sql`ALTER TABLE fin_cliente ADD COLUMN politica text`.execute(db);

    await db.schema
      .createTable("fin_cartao_movimento")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("local_id", "text", (c) => c.notNull().references("fin_local.id"))
      .addColumn("data", "text", (c) => c.notNull())
      .addColumn("bandeira", "text", (c) => c.notNull())
      .addColumn("tipo", "text", (c) => c.notNull()) // credito | debito | voucher
      .addColumn("valor_bruto", "integer", (c) => c.notNull())
      .addColumn("taxa_percentual", "real", (c) => c.notNull().defaultTo(0))
      .addColumn("valor_taxa", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("valor_liquido", "integer", (c) => c.notNull())
      .addColumn("previsao", "text", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull()) // a_receber | baixado | cancelado
      .addColumn("lancamento_id", "text", (c) => c.notNull().references("fin_lancamento.id"))
      .addColumn("conta_destino_id", "text")
      .addColumn("baixado_em", "text")
      .addColumn("criado_em", "text", (c) => c.notNull())
      .execute();
    await db.schema.createIndex("fin_cartao_movimento_local").on("fin_cartao_movimento").columns(["local_id", "previsao"]).execute();
  },
};

/**
 * Fila do Financeiro sobre o outbox: um cursor persistido por consumidor.
 * Posição inicial: o maior `seq` já existente no outbox. Eventos anteriores à instalação do Financeiro
 * (sinais e pagamentos do histórico, sem saldo de abertura conhecido) NÃO são reprocessados; um banco novo começa em 0.
 */
export const migracaoFinanceiroFila: Migracao = {
  nome: "0740_financeiro_fila",
  async up(db) {
    await db.schema
      .createTable("fin_cursor")
      .ifNotExists()
      .addColumn("nome", "text", (c) => c.primaryKey())
      .addColumn("ultimo_seq", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("falha_seq", "integer")
      .addColumn("falhas", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("ultimo_erro", "text")
      .execute();
    await sql`INSERT OR IGNORE INTO fin_cursor (nome, ultimo_seq) SELECT 'hospedagem', COALESCE(MAX(seq), 0) FROM outbox`.execute(db);
  },
};

/** Defesas e ajustes: marca de reversão nos movimentos, unicidade do que já era "checado antes de gravar" e chaves de idempotência. */
export const migracaoFinanceiroDefesas: Migracao = {
  nome: "0750_financeiro_defesas",
  async up(db) {
    await sql`ALTER TABLE fin_movimento ADD COLUMN reversao integer NOT NULL DEFAULT 0`.execute(db);
    await sql`CREATE UNIQUE INDEX fin_lancamento_pagamento_hospedagem ON fin_lancamento (referencia_id) WHERE referencia_tipo = 'hospedagem_pagamento'`.execute(db);
    await sql`CREATE UNIQUE INDEX fin_faturamento_checkout ON fin_faturamento (referencia_id) WHERE status != 'cancelado'`.execute(db);
    await db.schema
      .createTable("fin_idempotencia")
      .addColumn("chave", "text", (c) => c.primaryKey())
      .addColumn("status", "integer", (c) => c.notNull())
      .addColumn("resposta", "text", (c) => c.notNull())
      .addColumn("criado_em", "text", (c) => c.notNull())
      .execute();
  },
};
