import { lancar } from "../hospedagem/conta.js";
import { exigirPermissao, type UsuarioSessao } from "../nucleo/permissoes.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";

export type ItemFrigobar = { produtoId: string; quantidade: number };
export type ProdutoFrigobar = { id: string; nome: string; preco: number };

/** Valida que cada produto existe e é vendido no setor Frigobar; devolve-os por id. Roda na transação do chamador. */
export async function produtosDoFrigobar(tx: Contexto, itens: ItemFrigobar[]): Promise<Map<string, ProdutoFrigobar>> {
  const mapa = new Map<string, ProdutoFrigobar>();
  for (const { produtoId } of itens) {
    if (mapa.has(produtoId)) continue;
    const p = await tx.db.selectFrom("produtos").select(["id", "nome", "preco_centavos", "ativo"]).where("id", "=", produtoId).executeTakeFirst();
    if (!p) throw new ErroDominio("PRODUTO_NAO_ENCONTRADO", "Produto não encontrado.", { produtoId });
    if (!p.ativo) throw new ErroDominio("PRODUTO_INATIVO", `${p.nome} está desativado e não pode ser lançado.`, { produtoId });
    const setor = await tx.db.selectFrom("produto_setores").select("produto_id").where("produto_id", "=", produtoId).where("setor", "=", "frigobar").executeTakeFirst();
    if (!setor) throw new ErroDominio("PRODUTO_NAO_FRIGOBAR", `${p.nome} não é um produto de frigobar.`, { produtoId });
    mapa.set(produtoId, { id: p.id, nome: p.nome, preco: p.preco_centavos });
  }
  return mapa;
}

/** Um lançamento de frigobar na conta (origem Governança). Roda na transação do chamador. */
export async function lancarConsumoFrigobar(
  tx: Contexto,
  d: { contaId: string; reservaId: string; produto: ProdutoFrigobar; quantidade: number },
  usuarioId: string,
): Promise<string> {
  return lancar(
    tx,
    {
      contaId: d.contaId, reservaId: d.reservaId, tipo: "extra", origem: "governanca", produtoId: d.produto.id,
      descricao: d.produto.nome, quantidade: d.quantidade, valorUnitario: d.produto.preco, setor: "frigobar",
    },
    usuarioId,
  );
}

/** Formulário rápido do check-out: um lançamento por item com quantidade > 0, na mesma transação. */
export async function lancarFrigobar(
  ctx: Contexto,
  contaId: string,
  d: { reservaId: string; itens: ItemFrigobar[] },
  usuario: UsuarioSessao,
): Promise<{ lancamentoIds: string[]; total: number }> {
  exigirPermissao(usuario, "conta.lancar");
  return emTransacao(ctx, async (tx) => {
    const reserva = await tx.db.selectFrom("reservas").select("id").where("id", "=", d.reservaId).where("conta_id", "=", contaId).executeTakeFirst();
    if (!reserva) throw new ErroDominio("RESERVA_NAO_ENCONTRADA", "Reserva não encontrada nesta conta. Confira o número informado.", { reservaId: d.reservaId });
    const produtos = await produtosDoFrigobar(tx, d.itens);
    const itens = d.itens.filter((i) => i.quantidade > 0);
    if (itens.length === 0) throw new ErroDominio("NADA_A_LANCAR", "Informe a quantidade de pelo menos um produto para lançar.");
    const lancamentoIds: string[] = [];
    let total = 0;
    for (const i of itens) {
      const produto = produtos.get(i.produtoId)!;
      lancamentoIds.push(await lancarConsumoFrigobar(tx, { contaId, reservaId: d.reservaId, produto, quantidade: i.quantidade }, usuario.id));
      total += i.quantidade * produto.preco;
    }
    return { lancamentoIds, total };
  });
}
