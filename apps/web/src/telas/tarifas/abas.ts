export const PERM_TARIFAS = "tarifas.gerenciar";
export const PERM_SIMULAR = "reservas.gerenciar";

/** Abas da área Tarifas (`/reservas/tarifas/<caminho>`) e a permissão de cada uma. O Simulador só pede a de reservas. */
export const ABAS_TARIFAS = [
  { caminho: "tabela-base", rotulo: "Tabela base", permissao: PERM_TARIFAS },
  { caminho: "temporadas", rotulo: "Temporadas", permissao: PERM_TARIFAS },
  { caminho: "dias-semana", rotulo: "Dias da semana", permissao: PERM_TARIFAS },
  { caminho: "canais", rotulo: "Canais", permissao: PERM_TARIFAS },
  { caminho: "ocupacao", rotulo: "Ocupação", permissao: PERM_TARIFAS },
  { caminho: "criancas", rotulo: "Crianças", permissao: PERM_TARIFAS },
  { caminho: "pacotes", rotulo: "Pacotes", permissao: PERM_TARIFAS },
  { caminho: "restricoes", rotulo: "Restrições", permissao: PERM_TARIFAS },
  { caminho: "simulador", rotulo: "Simulador", permissao: PERM_SIMULAR },
] as const;
