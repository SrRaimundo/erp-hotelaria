export type FiltroId = "data" | "reserva" | "busca" | "periodo" | "intervalo";
export type ItemCatalogo = { id: string; nome: string; descricao: string; permissao: string; filtros: FiltroId[] };

export const PERM_RELATORIOS = "reservas.gerenciar";

/** Relatórios da primeira entrega; cada id corresponde a uma entrada em REGISTRO no servidor. */
export const CATALOGO: ItemCatalogo[] = [
  { id: "check-in", nome: "Lista de check-in", descricao: "Chegadas do dia com hóspede, telefone, quarto, saldo e situação.", permissao: PERM_RELATORIOS, filtros: ["data"] },
  { id: "check-out", nome: "Lista de check-out", descricao: "Saídas do dia, pendentes primeiro, com o saldo a acertar.", permissao: PERM_RELATORIOS, filtros: ["data"] },
  { id: "na-casa", nome: "Hóspedes na casa", descricao: "Quem está hospedado agora, com entrada, saída e total de pessoas.", permissao: PERM_RELATORIOS, filtros: [] },
  { id: "cafe", nome: "Lista do café da manhã", descricao: "Quem dormiu na noite anterior, por quarto, com adultos e crianças.", permissao: PERM_RELATORIOS, filtros: ["data"] },
  { id: "limpeza", nome: "Limpeza dos apartamentos", descricao: "Quartos para limpar hoje, com colunas em branco para preencher à mão.", permissao: PERM_RELATORIOS, filtros: [] },
  { id: "conta", nome: "Conta do hóspede", descricao: "Estadia e extrato da conta de uma reserva, com débitos, créditos e saldo.", permissao: PERM_RELATORIOS, filtros: ["reserva"] },
  { id: "hospedes", nome: "Hóspedes cadastrados", descricao: "Cadastro de hóspedes com documento, contato e número de estadias.", permissao: PERM_RELATORIOS, filtros: ["busca"] },
  { id: "caixa", nome: "Fechamento de caixa", descricao: "Turnos do período e, no turno escolhido, esperado, contado e diferença por forma.", permissao: "caixa.operar", filtros: ["periodo"] },
  { id: "canais", nome: "Reservas por canal", descricao: "Hospedados agora e, no período, reservas, noites, receita, cancelamentos e no-shows de cada canal.", permissao: PERM_RELATORIOS, filtros: ["intervalo"] },
];

export const EM_BREVE = ["Resumo do dia", "Previsão de ocupação", "Desempenho"];

export const buscarNoCatalogo = (id: string) => CATALOGO.find((r) => r.id === id);
