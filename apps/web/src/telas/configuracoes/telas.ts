export const PERM_CONFIG = "config.gerenciar";
export const PERM_CADASTROS = "cadastros.gerenciar";

/** Telas da área Configurações e a permissão que cada uma exige (spec §2). */
export const TELAS_CONFIGURACOES = [
  { caminho: "pousada", rotulo: "Pousada", permissao: PERM_CONFIG },
  { caminho: "categorias", rotulo: "Categorias e quartos", permissao: PERM_CADASTROS },
  { caminho: "usuarios", rotulo: "Usuários", permissao: PERM_CONFIG },
  { caminho: "perfis", rotulo: "Perfis", permissao: PERM_CONFIG },
  { caminho: "produtos", rotulo: "Produtos", permissao: PERM_CADASTROS },
  { caminho: "checklists", rotulo: "Checklists", permissao: PERM_CONFIG },
] as const;
