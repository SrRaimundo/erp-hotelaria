import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { SETORES, type Setor } from "../governanca/setores.js";
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
  setores: Setor[];
};

function paraProduto(l: any, setores: Setor[]): Produto {
  return {
    id: l.id,
    codigo: l.codigo,
    nome: l.nome,
    precoCentavos: l.preco_centavos,
    unidade: l.unidade,
    grupo: l.grupo,
    tipo: l.tipo,
    setores,
  };
}

export async function criarProduto(ctx: Contexto, d: Omit<Produto, "id" | "setores"> & { setores?: Setor[] }, ator: string): Promise<Produto> {
  if (!Number.isInteger(d.precoCentavos) || d.precoCentavos < 0) {
    throw new ErroDominio("PRECO_INVALIDO", "Preço inválido. Informe o valor em centavos, sem casas decimais.");
  }
  return emTransacao(ctx, async (tx) => {
    const dup = await tx.db.selectFrom("produtos").select("id").where("codigo", "=", d.codigo).executeTakeFirst();
    if (dup) throw new ErroDominio("CODIGO_PRODUTO_DUPLICADO", `Já existe um produto com o código ${d.codigo}. Use outro código.`);
    const setores = [...new Set(d.setores?.length ? d.setores : ["recepcao" as Setor])];
    const invalido = setores.find((s) => !SETORES.includes(s));
    if (invalido) throw new ErroDominio("SETOR_INVALIDO", `Setor inválido: ${invalido}.`);
    const p: Produto = { id: novoId(), ...d, setores: SETORES.filter((s) => setores.includes(s)).sort() };
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
    await tx.db.insertInto("produto_setores").values(p.setores.map((setor) => ({ produto_id: p.id, setor }))).execute();
    await auditar(tx, { ator, acao: "produto.criar", alvoTipo: "produto", alvoId: p.id, dados: p });
    await registrarEvento(tx, "nucleo.ProdutoCriado", { produtoId: p.id });
    return p;
  });
}

export async function obterProdutoPorCodigo(ctx: Contexto, codigo: string): Promise<Produto> {
  const l = await ctx.db.selectFrom("produtos").selectAll().where("codigo", "=", codigo).executeTakeFirst();
  if (!l) throw new ErroDominio("PRODUTO_NAO_ENCONTRADO", `Produto ${codigo} não encontrado.`);
  return paraProduto(l, await setoresDe(ctx, [l.id]).then((m) => m.get(l.id) ?? []));
}

async function setoresDe(ctx: Contexto, ids: string[]): Promise<Map<string, Setor[]>> {
  const m = new Map<string, Setor[]>();
  if (ids.length === 0) return m;
  const ls = await ctx.db.selectFrom("produto_setores").select(["produto_id", "setor"]).where("produto_id", "in", ids).orderBy("setor").execute();
  for (const l of ls) m.set(l.produto_id, [...(m.get(l.produto_id) ?? []), l.setor as Setor]);
  return m;
}

export async function listarProdutos(ctx: Contexto, setor?: Setor): Promise<Produto[]> {
  let q = ctx.db.selectFrom("produtos").selectAll().orderBy("nome").orderBy("id");
  if (setor) q = q.where("id", "in", ctx.db.selectFrom("produto_setores").select("produto_id").where("setor", "=", setor));
  const ls = await q.execute();
  const setores = await setoresDe(ctx, ls.map((l) => l.id));
  return ls.map((l) => paraProduto(l, setores.get(l.id) ?? []));
}
