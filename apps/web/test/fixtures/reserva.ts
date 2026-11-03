import type { ReservaDetalhe } from "../../src/api/tipos";

const titular = {
  id: "h1", nome: "Maria Silva", documentoTipo: "cpf" as const, documento: "12345678909", nascimento: "1985-03-02",
  nacionalidade: "BR", telefone: "11999990000", endereco: { logradouro: "Rua A", cidade: "Recife", uf: "PE", pais: "BR" },
  pendenciasFnrh: [] as string[],
};

/** Reserva #128 hospedada no 101, 3 noites (sexta a domingo) com cálculo detalhado; `extras` sobrescreve campos de topo. */
export function criarReserva(extras: Partial<ReservaDetalhe> = {}): ReservaDetalhe {
  return {
    id: "r1", codigo: 128, estado: "hospedada", titularId: "h1", categoriaId: "c1", quartoId: "q101", chegada: "2026-11-20", saida: "2026-11-23",
    adultos: 2, criancasNascimento: ["2020-01-01"], canal: "Balcão", comissaoPercentual: 0, observacoes: "Chegada tarde", grupoId: null, contaId: "ct1",
    valorSinal: 27000, prazoSinal: null, avisoSinalEm: null, criadaEm: "2026-11-01T10:00:00.000Z",
    noites: [
      { data: "2026-11-20", valor: 30000, passos: [{ rotulo: "Base", valor: 28000 }, { rotulo: "Sexta +7%", valor: 2000 }] },
      { data: "2026-11-21", valor: 32200, passos: [{ rotulo: "Base", valor: 28000 }, { rotulo: "Sábado +15%", valor: 4200 }] },
      { data: "2026-11-22", valor: 28000, passos: [{ rotulo: "Base", valor: 28000 }] },
    ],
    total: 90200, pago: 27000, quartoNumero: "101", titular, acompanhantes: [], ultimaArrumacao: null,
    ...extras,
  };
}

export { titular };
