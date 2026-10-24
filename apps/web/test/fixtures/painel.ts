import type { Painel } from "../../src/api/tipos";

const base = { codigo: 1, chegada: "2026-11-20", saida: "2026-11-22" };

/** Painel completo e coerente; `extras` sobrescreve campos de topo. */
export function criarPainel(extras: Partial<Painel> = {}): Painel {
  return {
    dia: "2026-11-20",
    chegadas: [
      { ...base, reservaId: "r1", titular: "Ana Souza", quartoNumero: "101", estado: "confirmada", noites: 2, adultos: 2, criancas: 1, canal: "Balcão", sinalPendente: 0, pendenciasFnrh: false },
      { ...base, reservaId: "r2", titular: "Bruno Lima", quartoNumero: null, estado: "confirmada", noites: 3, adultos: 1, criancas: 0, canal: "Booking", sinalPendente: 0, pendenciasFnrh: false },
      { ...base, reservaId: "r3", titular: "Carla Dias", quartoNumero: "102", estado: "confirmada", noites: 1, adultos: 2, criancas: 0, canal: "Site", sinalPendente: 5000, pendenciasFnrh: true },
    ],
    saidas: [
      { ...base, reservaId: "r4", titular: "Davi Melo", quartoNumero: "201", contaId: "c4", saldo: 8600 },
      { ...base, reservaId: "r5", titular: "Eva Nunes", quartoNumero: "202", contaId: "c5", saldo: 0 },
    ],
    hospedados: 5,
    quartosSujos: [{ quartoId: "q103", numero: "103" }],
    sinaisVencendo: [],
    chegadasVencidas: [],
    alertas: [],
    ocupacao: { ocupados: 9, total: 12, percentual: 75 },
    numeros: { chegadas: 3, chegadasJaHospedadas: 1, saidas: 2, hospedados: 5, pessoasHospedadas: 8, quartosSujos: 1, quartosManutencao: 1, livresHoje: 3 },
    governanca: [
      { quartoId: "q103", numero: "103", situacao: "sujo", motivo: null },
      { quartoId: "q106", numero: "106", situacao: "em_manutencao", motivo: "chuveiro" },
    ],
    proximosDias: [
      { dia: "2026-11-21", chegadas: 4, saidas: 2, ocupacaoPct: 83 },
      { dia: "2026-11-22", chegadas: 1, saidas: 0, ocupacaoPct: 100 },
    ],
    atencao: [
      { tipo: "sinal_vencendo", id: "a1", titulo: "Sinal vence às 18:00", detalhe: "Reserva #8 · Fábio Reis · faltam R$ 150,00", reservaId: "r8", contaId: null, telefone: "(11) 99999-0000", sinalPendente: 15000, acoes: ["registrar_sinal", "prorrogar_sinal"] },
      { tipo: "chegada_atrasada", id: "a2", titulo: "Chegada atrasada", detalhe: "Reserva #9 · Gil Prado", reservaId: "r9", contaId: null, telefone: null, acoes: ["marcar_no_show", "abrir_reserva"] },
    ],
    ...extras,
  };
}
