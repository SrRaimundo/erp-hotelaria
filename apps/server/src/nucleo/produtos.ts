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

/** Serviços de hospedagem (early check-in/late check-out) só aparecem no setor `hospedagem`. */
const CODIGOS_HOSPEDAGEM = ["EARLY_CHECKIN", "LATE_CHECKOUT"];

export async function listarProdutos(ctx: Contexto, setor?: Setor, filtro?: { incluirInativos?: boolean }): Promise<Produto[]> {
  let q = ctx.db.selectFrom("produtos").selectAll().orderBy("nome").orderBy("id");
  if (setor) q = q.where("id", "in", ctx.db.selectFrom("produto_setores").select("produto_id").where("setor", "=", setor));
  if (setor !== "hospedagem") q = q.where("codigo", "not in", CODIGOS_HOSPEDAGEM);
  if (!filtro?.incluirInativos) q = q.where("ativo", "=", 1);
  const ls = await q.execute();
  const setores = await setoresDe(ctx, ls.map((l) => l.id));
  return ls.map((l) => paraProduto(l, setores.get(l.id) ?? []));
}

async function produtoOuErro(tx: Contexto, id: string): Promise<Produto> {
  const l = await tx.db.selectFrom("produtos").selectAll().where("id", "=", id).executeTakeFirst();
  if (!l) throw new ErroDominio("PRODUTO_NAO_ENCONTRADO", "Produto não encontrado.");
  return paraProduto(l, (await setoresDe(tx, [id])).get(id) ?? []);
}

/** O código e o grupo do produto não mudam. */
export async function editarProduto(
  ctx: Contexto,
  id: string,
  d: { nome: string; precoCentavos: number; unidade: string; tipo: "produto" | "servico"; setores: Setor[] },
  ator: string,
): Promise<Produto> {
  if (!Number.isInteger(d.precoCentavos) || d.precoCentavos < 0) {
    throw new ErroDominio("PRECO_INVALIDO", "Preço inválido. Informe o valor em centavos, sem casas decimais.");
  }
  const setores = SETORES.filter((s) => d.setores.includes(s));
  const invalido = d.setores.find((s) => !SETORES.includes(s));
  if (invalido) throw new ErroDominio("SETOR_INVALIDO", `Setor inválido: ${invalido}.`);
  if (setores.length === 0) throw new ErroDominio("SETOR_INVALIDO", "Informe ao menos um setor.");
  return emTransacao(ctx, async (tx) => {
    const antes = await produtoOuErro(tx, id);
    const depois: Produto = { ...antes, nome: d.nome, precoCentavos: d.precoCentavos, unidade: d.unidade, tipo: d.tipo, setores: [...setores].sort() };
    await tx.db
      .updateTable("produtos")
      .set({ nome: depois.nome, preco_centavos: depois.precoCentavos, unidade: depois.unidade, tipo: depois.tipo })
      .where("id", "=", id)
      .execute();
    await tx.db.deleteFrom("produto_setores").where("produto_id", "=", id).execute();
    await tx.db.insertInto("produto_setores").values(depois.setores.map((setor) => ({ produto_id: id, setor }))).execute();
    await auditar(tx, { ator, acao: "produto.editar", alvoTipo: "produto", alvoId: id, dados: { antes, depois } });
    await registrarEvento(tx, "nucleo.ProdutoEditado", { produtoId: id });
    return depois;
  });
}

export async function definirProdutoAtivo(ctx: Contexto, id: string, ativo: boolean, ator: string): Promise<void> {
  await emTransacao(ctx, async (tx) => {
    await produtoOuErro(tx, id);
    await tx.db.updateTable("produtos").set({ ativo: ativo ? 1 : 0 }).where("id", "=", id).execute();
    await auditar(tx, { ator, acao: ativo ? "produto.reativar" : "produto.desativar", alvoTipo: "produto", alvoId: id });
    await registrarEvento(tx, ativo ? "nucleo.ProdutoReativado" : "nucleo.ProdutoDesativado", { produtoId: id });
  });
}
