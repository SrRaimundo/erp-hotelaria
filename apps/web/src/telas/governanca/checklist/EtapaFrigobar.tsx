import type { Produto } from "../../../api/tipos";
import { formatarReais } from "../../../lib/dinheiro";
import { EtapaContagem } from "./EtapaContagem";

const MAXIMO_BOTAO = 3;

type Props = { produtos: Produto[]; valores: Record<string, number>; mostrarPreco: boolean; aoMudar: (produtoId: string, quantidade: number) => void };

export function EtapaFrigobar({ produtos, valores, mostrarPreco, aoMudar }: Props) {
  const preco = new Map(produtos.map((p) => [p.id, p.precoCentavos]));
  return (
    <EtapaContagem
      itens={produtos.map((p) => ({ id: p.id, texto: p.nome }))}
      valores={valores}
      maximoBotao={MAXIMO_BOTAO}
      aoMudar={aoMudar}
      detalhe={mostrarPreco ? (id) => formatarReais(preco.get(id) ?? 0) : undefined}
    />
  );
}
