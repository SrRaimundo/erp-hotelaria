export type { Painel, ItemAtencao, Mapa, Barra, ResultadoBusca } from "@server/hospedagem/consultas";
export type { ReservaDetalhe } from "@server/hospedagem/reservas";
export type { ItemListaReserva } from "@server/hospedagem/lista-reservas";
export type { LinhaExtrato } from "@server/hospedagem/conta";
export type { Cotacao } from "@server/tarifas/cotacao";
export type { UsuarioSessao } from "@server/nucleo/permissoes";
export type { Quarto } from "@server/nucleo/quartos";
export type { Categoria } from "@server/nucleo/categorias";
export type { Hospede } from "@server/nucleo/hospedes";
export type { FormaPagamento } from "@server/nucleo/formas-pagamento";
export type { Produto } from "@server/nucleo/produtos";

export type ErroApiDados = { codigo: string; mensagem: string; detalhes?: unknown };
