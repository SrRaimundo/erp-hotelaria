import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";

export type Produto = {
  id: string;
  codigo: string;
  nome: string;
  precoCentavos: number;
  unidade: string;
  grupo: string;
  tipo: "produto" | "servico";
};

function paraProduto(l: any): Produto {
  return {
    id: l.id,
    codigo: l.codigo,
    nome: l.nome,
    precoCentavos: l.preco_centavos,
    unidade: l.unidade,
    grupo: l.grupo,
    tipo: l.tipo,
  };
}

export async function criarProduto(ctx: Contexto, d: Omit<Produto, "id">, ator: string): Promise<Produto> {
  if (!Number.isInteger(d.precoCentavos) || d.precoCentavos < 0) {
    throw new ErroDominio("PRECO_INVALIDO", "Preço inválido. Informe o valor em centavos, sem casas decimais.");
  }
  return emTransacao(ctx, async (tx) => {
    const dup = await tx.db.selectFrom("produtos").select("id").where("codigo", "=", d.codigo).executeTakeFirst();
    if (dup) throw new ErroDominio("CODIGO_PRODUTO_DUPLICADO", `Já existe um produto com o código ${d.codigo}. Use outro código.`);
    const p: Produto = { id: novoId(), ...d };
    await tx.db
      .insertInto("produtos")
      .values({
        id: p.id,
        codigo: p.codigo,
        nome: p.nome,
        preco_centavos: p.precoCentavos,
        unidade: p.unidade,
        grupo: p.grupo,
        tipo: p.tipo,
      })
      .execute();
    await auditar(tx, { ator, acao: "produto.criar", alvoTipo: "produto", alvoId: p.id, dados: p });
    await registrarEvento(tx, "nucleo.ProdutoCriado", { produtoId: p.id });
    return p;
  });
}

export async function obterProdutoPorCodigo(ctx: Contexto, codigo: string): Promise<Produto> {
  const l = await ctx.db.selectFrom("produtos").selectAll().where("codigo", "=", codigo).executeTakeFirst();
  if (!l) throw new ErroDominio("PRODUTO_NAO_ENCONTRADO", `Produto ${codigo} não encontrado.`);
  return paraProduto(l);
}

export async function listarProdutos(ctx: Contexto): Promise<Produto[]> {
  return (await ctx.db.selectFrom("produtos").selectAll().orderBy("nome").orderBy("id").execute()).map(paraProduto);
}
