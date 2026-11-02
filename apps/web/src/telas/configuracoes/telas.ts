export const PERM_CONFIG = "config.gerenciar";

/** Telas da área Configurações e a permissão que cada uma exige (spec §2). */
export const TELAS_CONFIGURACOES = [
  { caminho: "pousada", rotulo: "Pousada", permissao: PERM_CONFIG },
  { caminho: "usuarios", rotulo: "Usuários", permissao: PERM_CONFIG },
  { caminho: "perfis", rotulo: "Perfis", permissao: PERM_CONFIG },
  { caminho: "checklists", rotulo: "Checklists", permissao: PERM_CONFIG },
  { caminho: "assistente", rotulo: "Primeira configuração", permissao: PERM_CONFIG },
] as const;
