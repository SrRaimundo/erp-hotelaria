import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";

export type Categoria = { id: string; nome: string; maxAdultos: number; maxCriancas: number; comodidades: string[]; ativo: boolean };

export async function criarCategoria(
  ctx: Contexto,
  d: { nome: string; maxAdultos: number; maxCriancas: number; comodidades: string[] },
  ator: string,
): Promise<Categoria> {
  return emTransacao(ctx, async (tx) => {
    const cat: Categoria = { id: novoId(), nome: d.nome, maxAdultos: d.maxAdultos, maxCriancas: d.maxCriancas, comodidades: d.comodidades, ativo: true };
    await tx.db
      .insertInto("categorias")
      .values({
        id: cat.id,
        nome: cat.nome,
        max_adultos: cat.maxAdultos,
        max_criancas: cat.maxCriancas,
        comodidades: JSON.stringify(cat.comodidades),
      })
      .execute();
    await auditar(tx, { ator, acao: "categoria.criar", alvoTipo: "categoria", alvoId: cat.id, dados: cat });
    await registrarEvento(tx, "nucleo.CategoriaCriada", { categoriaId: cat.id });
    return cat;
  });
}

export async function listarCategorias(ctx: Contexto, filtro?: { incluirInativos?: boolean }): Promise<Categoria[]> {
  let q = ctx.db.selectFrom("categorias").selectAll();
  if (!filtro?.incluirInativos) q = q.where("ativo", "=", 1);
  const linhas = await q.orderBy("nome").orderBy("id").execute();
  return linhas.map(paraCategoria);
}

function paraCategoria(l: any): Categoria {
  return { id: l.id, nome: l.nome, maxAdultos: l.max_adultos, maxCriancas: l.max_criancas, comodidades: JSON.parse(l.comodidades), ativo: !!l.ativo };
}

async function categoriaOuErro(tx: Contexto, id: string) {
  const l = await tx.db.selectFrom("categorias").selectAll().where("id", "=", id).executeTakeFirst();
  if (!l) throw new ErroDominio("CATEGORIA_NAO_ENCONTRADA", "Categoria não encontrada.");
  return l;
}

export async function editarCategoria(
  ctx: Contexto,
  id: string,
  d: { nome: string; maxAdultos: number; maxCriancas: number; comodidades: string[] },
  ator: string,
): Promise<Categoria> {
  return emTransacao(ctx, async (tx) => {
    const antes = paraCategoria(await categoriaOuErro(tx, id));
    const depois: Categoria = { id, nome: d.nome, maxAdultos: d.maxAdultos, maxCriancas: d.maxCriancas, comodidades: d.comodidades, ativo: antes.ativo };
    await tx.db
      .updateTable("categorias")
      .set({ nome: depois.nome, max_adultos: depois.maxAdultos, max_criancas: depois.maxCriancas, comodidades: JSON.stringify(depois.comodidades) })
      .where("id", "=", id)
      .execute();
    await auditar(tx, { ator, acao: "categoria.editar", alvoTipo: "categoria", alvoId: id, dados: { antes, depois } });
    await registrarEvento(tx, "nucleo.CategoriaEditada", { categoriaId: id });
    return depois;
  });
}

/** Desativar exige que a categoria não tenha quartos ativos. */
export async function definirCategoriaAtiva(ctx: Contexto, id: string, ativa: boolean, ator: string): Promise<void> {
  await emTransacao(ctx, async (tx) => {
    await categoriaOuErro(tx, id);
    if (!ativa) {
      const quarto = await tx.db.selectFrom("quartos").select("id").where("categoria_id", "=", id).where("ativo", "=", 1).executeTakeFirst();
      if (quarto) throw new ErroDominio("CATEGORIA_COM_QUARTOS", "Esta categoria ainda tem quartos ativos. Desative ou mude os quartos de categoria antes.");
    }
    await tx.db.updateTable("categorias").set({ ativo: ativa ? 1 : 0 }).where("id", "=", id).execute();
    await auditar(tx, { ator, acao: ativa ? "categoria.reativar" : "categoria.desativar", alvoTipo: "categoria", alvoId: id });
    await registrarEvento(tx, ativa ? "nucleo.CategoriaReativada" : "nucleo.CategoriaDesativada", { categoriaId: id });
  });
}
