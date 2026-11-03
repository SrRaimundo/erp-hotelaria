/** Estrutura única do menu lateral: o MenuLateral e as rotas de "em breve" leem daqui. */
export type ItemMenu = { para: string; rotulo: string; permissao: string; /** Recuado logo abaixo do item anterior. */ subitem?: boolean };
export type GrupoMenu = { id: string; rotulo: string; itens: ItemMenu[] };

const CONFIG = "config.gerenciar";
const CADASTROS = "cadastros.gerenciar";
const FINANCEIRO = "financeiro.gerenciar";

const financeiro = (slug: string, rotulo: string): ItemMenu => ({ para: `/financeiro/${slug}`, rotulo, permissao: FINANCEIRO });
const estoque = (slug: string, rotulo: string): ItemMenu => ({ para: `/estoque/${slug}`, rotulo, permissao: CONFIG });
const cadastro = (slug: string, rotulo: string): ItemMenu => ({ para: `/cadastros/${slug}`, rotulo, permissao: CADASTROS });

export const GRUPOS_MENU: GrupoMenu[] = [
  {
    id: "hotel",
    rotulo: "Hotel",
    itens: [
      { para: "/", rotulo: "Hoje", permissao: "reservas.gerenciar" },
      { para: "/mapa", rotulo: "Mapa", permissao: "reservas.gerenciar" },
      { para: "/reservas", rotulo: "Reservas", permissao: "reservas.gerenciar" },
      { para: "/reservas/tarifas", rotulo: "Tarifas", permissao: "tarifas.gerenciar", subitem: true },
      { para: "/caixa", rotulo: "Caixa", permissao: "caixa.operar" },
      { para: "/governanca", rotulo: "Governança", permissao: "quartos.situacao" },
      { para: "/relatorios", rotulo: "Relatórios", permissao: "reservas.gerenciar" },
    ],
  },
  {
    id: "financeiro",
    rotulo: "Financeiro",
    itens: [
      financeiro("local", "Local"),
      financeiro("contas-a-pagar", "Contas a Pagar"),
      financeiro("contas-a-receber", "Contas a Receber"),
      financeiro("cartao-de-credito", "Cartão de Crédito"),
      financeiro("caixa-e-banco", "Caixa e Banco"),
      financeiro("faturamento", "Faturamento"),
      financeiro("relatorios", "Relatórios"),
    ],
  },
  {
    id: "estoque",
    rotulo: "Estoque",
    itens: [
      estoque("local", "Local"),
      estoque("fiscal", "Fiscal"),
      estoque("movimento", "Movimento"),
      estoque("requisicao", "Requisição"),
      estoque("servico", "Serviço"),
      estoque("compra", "Compra"),
      estoque("inventario", "Inventário"),
      estoque("relatorios", "Relatórios"),
    ],
  },
  {
    id: "cadastros",
    rotulo: "Cadastros",
    itens: [
      cadastro("produtos", "Produtos"),
      cadastro("categorias-e-quartos", "Categorias e Quartos"),
      cadastro("setores", "Setores"),
      cadastro("fornecedor", "Fornecedor"),
      cadastro("cobranca", "Cobrança"),
      cadastro("tipo-de-documento", "Tipo de Documento"),
      cadastro("grupo", "Grupo"),
      cadastro("subgrupo", "SubGrupo"),
      cadastro("contas-bancarias", "Contas Bancárias"),
      cadastro("locais", "Locais"),
      cadastro("relatorios", "Relatórios"),
    ],
  },
];

/** O caminho está num subitem do `pai` (/reservas/tarifas sob Reservas): o pai não deve parecer ativo. */
export function emSubitemDe(pai: string, caminho: string): boolean {
  return GRUPOS_MENU.some((g) => g.itens.some((i) => i.subitem && i.para.startsWith(`${pai}/`) && rotaDoItem(i.para, caminho)));
}

/** O item cuja rota contém o caminho atual (`/reservas/nova` pertence a `/reservas`). */
export function rotaDoItem(para: string, caminho: string): boolean {
  return para === "/" ? caminho === "/" : caminho === para || caminho.startsWith(`${para}/`);
}
