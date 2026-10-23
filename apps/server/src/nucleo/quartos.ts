import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";

export type SituacaoQuarto = "livre" | "ocupado" | "sujo" | "em_manutencao" | "bloqueado";
export type Quarto = { id: string; numero: string; categoriaId: string; bloco: string | null; situacao: SituacaoQuarto };

const TRANSICOES: Record<SituacaoQuarto, SituacaoQuarto[]> = {
  livre: ["ocupado", "em_manutencao", "bloqueado"],
  ocupado: ["sujo"],
  sujo: ["livre", "em_manutencao"],
  em_manutencao: ["livre", "sujo"],
  bloqueado: ["livre"],
};

function paraQuarto(l: any): Quarto {
  return { id: l.id, numero: l.numero, categoriaId: l.categoria_id, bloco: l.bloco, situacao: l.situacao };
}

export async function criarQuarto(
  ctx: Contexto,
  d: { numero: string; categoriaId: string; bloco?: string },
  ator: string,
): Promise<Quarto> {
  return emTransacao(ctx, async (tx) => {
    const cat = await tx.db.selectFrom("categorias").select("id").where("id", "=", d.categoriaId).executeTakeFirst();
    if (!cat) throw new ErroDominio("CATEGORIA_NAO_ENCONTRADA", "Categoria não encontrada. Escolha uma categoria cadastrada.");
    const dup = await tx.db.selectFrom("quartos").select("id").where("numero", "=", d.numero).executeTakeFirst();
    if (dup) throw new ErroDominio("NUMERO_QUARTO_DUPLICADO", `Já existe um quarto com o número ${d.numero}. Use outro número.`);
    const q: Quarto = { id: novoId(), numero: d.numero, categoriaId: d.categoriaId, bloco: d.bloco ?? null, situacao: "livre" };
    await tx.db
      .insertInto("quartos")
      .values({ id: q.id, numero: q.numero, categoria_id: q.categoriaId, bloco: q.bloco, situacao: q.situacao })
      .execute();
    await auditar(tx, { ator, acao: "quarto.criar", alvoTipo: "quarto", alvoId: q.id, dados: q });
    await registrarEvento(tx, "nucleo.QuartoCriado", { quartoId: q.id });
    return q;
  });
}

export async function listarQuartos(ctx: Contexto, filtro?: { categoriaId?: string }): Promise<Quarto[]> {
  let q = ctx.db.selectFrom("quartos").selectAll();
  if (filtro?.categoriaId) q = q.where("categoria_id", "=", filtro.categoriaId);
  return (await q.orderBy("numero").execute()).map(paraQuarto);
}

export async function obterQuarto(ctx: Contexto, id: string): Promise<Quarto> {
  const l = await ctx.db.selectFrom("quartos").selectAll().where("id", "=", id).executeTakeFirst();
  if (!l) throw new ErroDominio("QUARTO_NAO_ENCONTRADO", "Quarto não encontrado.");
  return paraQuarto(l);
}

/** Roda dentro da transação do chamador. */
export async function mudarSituacaoQuarto(
  tx: Contexto,
  quartoId: string,
  nova: SituacaoQuarto,
  ator: string,
  motivo?: string,
): Promise<void> {
  const quarto = await obterQuarto(tx, quartoId);
  if (!TRANSICOES[quarto.situacao].includes(nova)) {
    throw new ErroDominio(
      "TRANSICAO_QUARTO_INVALIDA",
      `O quarto ${quarto.numero} não pode passar de "${quarto.situacao}" para "${nova}".`,
      { de: quarto.situacao, para: nova },
    );
  }
  await tx.db.updateTable("quartos").set({ situacao: nova }).where("id", "=", quartoId).execute();
  await auditar(tx, { ator, acao: "quarto.situacao", alvoTipo: "quarto", alvoId: quartoId, motivo, dados: { de: quarto.situacao, para: nova } });
  await registrarEvento(tx, "nucleo.SituacaoQuartoAlterada", { quartoId, de: quarto.situacao, para: nova });
}
