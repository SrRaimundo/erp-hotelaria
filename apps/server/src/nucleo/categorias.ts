import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { novoId } from "../shared/ids.js";

export type Categoria = { id: string; nome: string; maxAdultos: number; maxCriancas: number; comodidades: string[] };

export async function criarCategoria(
  ctx: Contexto,
  d: { nome: string; maxAdultos: number; maxCriancas: number; comodidades: string[] },
  ator: string,
): Promise<Categoria> {
  return emTransacao(ctx, async (tx) => {
    const cat: Categoria = { id: novoId(), nome: d.nome, maxAdultos: d.maxAdultos, maxCriancas: d.maxCriancas, comodidades: d.comodidades };
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

export async function listarCategorias(ctx: Contexto): Promise<Categoria[]> {
  const linhas = await ctx.db.selectFrom("categorias").selectAll().orderBy("nome").orderBy("id").execute();
  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    maxAdultos: l.max_adultos,
    maxCriancas: l.max_criancas,
    comodidades: JSON.parse(l.comodidades),
  }));
}
