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

/** Chamados de defeito e reposição abertos pela camareira; nunca apagados, só encerrados. */
export const migracaoGovernancaChamados: Migracao = {
  nome: "0520_governanca_chamados",
  async up(db) {
    await db.schema
      .createTable("chamados")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("quarto_id", "text", (c) => c.notNull().references("quartos.id"))
      .addColumn("item_id", "text", (c) => c.references("checklist_itens.id"))
      .addColumn("tipo", "text", (c) => c.notNull())
      .addColumn("descricao", "text", (c) => c.notNull())
      .addColumn("observacao", "text")
      .addColumn("situacao", "text", (c) => c.notNull())
      .addColumn("aberto_por", "text", (c) => c.notNull().references("usuarios.id"))
      .addColumn("aberto_em", "text", (c) => c.notNull())
      .addColumn("encerrado_por", "text")
      .addColumn("encerrado_em", "text")
      .addColumn("observacao_encerramento", "text")
      .execute();
    await sql`CREATE INDEX chamados_quarto_situacao ON chamados (quarto_id, situacao)`.execute(db);
  },
};

/** Chave opcional do alerta: permite vários avisos abertos do mesmo tipo para o mesmo alvo (um por item). */
export const migracaoGovernancaAlertasChave: Migracao = {
  nome: "0521_governanca_alertas_chave",
  async up(db) {
    await sql`ALTER TABLE alertas ADD COLUMN chave TEXT`.execute(db);
  },
};

/** Execuções de checklist, respostas (com cópia do texto do item) e movimentos de frigobar; somente inserção. */
export const migracaoGovernancaExecucoes: Migracao = {
  nome: "0530_governanca_execucoes",
  async up(db) {
    await db.schema
      .createTable("checklist_execucoes")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("quarto_id", "text", (c) => c.notNull().references("quartos.id"))
      .addColumn("tipo", "text", (c) => c.notNull())
      .addColumn("reserva_id", "text", (c) => c.references("reservas.id"))
      .addColumn("usuario_id", "text", (c) => c.notNull().references("usuarios.id"))
      .addColumn("iniciado_em", "text", (c) => c.notNull())
      .addColumn("concluido_em", "text", (c) => c.notNull())
      .addColumn("resultado", "text")
      .addColumn("motivo", "text")
      .execute();
    await sql`CREATE INDEX checklist_execucoes_quarto ON checklist_execucoes (quarto_id, concluido_em)`.execute(db);
    await db.schema
      .createTable("checklist_respostas")
      .addColumn("execucao_id", "text", (c) => c.notNull().references("checklist_execucoes.id"))
      .addColumn("item_id", "text", (c) => c.notNull().references("checklist_itens.id"))
      .addColumn("etapa", "text", (c) => c.notNull())
      .addColumn("texto_item", "text", (c) => c.notNull())
      .addColumn("sim_nao", "integer")
      .addColumn("quantidade", "integer")
      .addColumn("equipamento", "text")
      .addColumn("presenca", "text")
      .addColumn("observacao", "text")
      .addColumn("chamado_id", "text", (c) => c.references("chamados.id"))
      .addColumn("alerta_id", "text", (c) => c.references("alertas.id"))
      .addPrimaryKeyConstraint("checklist_respostas_pk", ["execucao_id", "item_id"])
      .execute();
    await db.schema
      .createTable("frigobar_movimentos")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("execucao_id", "text", (c) => c.references("checklist_execucoes.id"))
      .addColumn("quarto_id", "text", (c) => c.notNull().references("quartos.id"))
      .addColumn("reserva_id", "text", (c) => c.references("reservas.id"))
      .addColumn("produto_id", "text", (c) => c.notNull().references("produtos.id"))
      .addColumn("quantidade", "integer", (c) => c.notNull())
      .addColumn("tipo", "text", (c) => c.notNull())
      .addColumn("lancamento_id", "text", (c) => c.references("lancamentos.id"))
      .addColumn("usuario_id", "text", (c) => c.notNull().references("usuarios.id"))
      .addColumn("instante", "text", (c) => c.notNull())
      .execute();
  },
};
