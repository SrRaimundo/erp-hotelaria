import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";
import { diaHoteleiro } from "../shared/tempo.js";
import { obterConfig } from "./pousada.js";
import { ESTADOS_ATIVOS } from "../hospedagem/estados.js";

export type SituacaoQuarto = "livre" | "ocupado" | "sujo" | "em_manutencao" | "bloqueado";
export type Quarto = { id: string; numero: string; categoriaId: string; bloco: string | null; situacao: SituacaoQuarto; ativo: boolean };

const TRANSICOES: Record<SituacaoQuarto, SituacaoQuarto[]> = {
  livre: ["ocupado", "em_manutencao", "bloqueado"],
  ocupado: ["sujo"],
  sujo: ["livre", "em_manutencao", "bloqueado"],
  em_manutencao: ["livre", "sujo"],
  bloqueado: ["livre", "sujo"],
};

function paraQuarto(l: any): Quarto {
  return { id: l.id, numero: l.numero, categoriaId: l.categoria_id, bloco: l.bloco, situacao: l.situacao, ativo: !!l.ativo };
}

export async function criarQuarto(
  ctx: Contexto,
  d: { numero: string; categoriaId: string; bloco?: string },
  ator: string,
): Promise<Quarto> {
  return emTransacao(ctx, async (tx) => {
    await exigirCategoria(tx, d.categoriaId);
    await exigirNumeroLivre(tx, d.numero);
    const q: Quarto = { id: novoId(), numero: d.numero, categoriaId: d.categoriaId, bloco: d.bloco ?? null, situacao: "livre", ativo: true };
    await tx.db
      .insertInto("quartos")
      .values({ id: q.id, numero: q.numero, categoria_id: q.categoriaId, bloco: q.bloco, situacao: q.situacao })
      .execute();
    await auditar(tx, { ator, acao: "quarto.criar", alvoTipo: "quarto", alvoId: q.id, dados: q });
    await registrarEvento(tx, "nucleo.QuartoCriado", { quartoId: q.id });
    return q;
  });
}

const MAX_LOTE = 200;

async function exigirCategoria(tx: Contexto, id: string): Promise<void> {
  const cat = await tx.db.selectFrom("categorias").select(["id", "ativo"]).where("id", "=", id).executeTakeFirst();
  if (!cat) throw new ErroDominio("CATEGORIA_NAO_ENCONTRADA", "Categoria não encontrada. Escolha uma categoria cadastrada.");
  if (!cat.ativo) throw new ErroDominio("CATEGORIA_INATIVA", "Esta categoria está desativada. Reative a categoria ou escolha outra.");
}

/** Bloqueia (QUARTO_COM_RESERVAS) se o quarto está ocupado ou tem reserva ativa com saída a partir do dia hoteleiro. */
async function exigirSemReservas(tx: Contexto, quarto: Quarto): Promise<void> {
  const config = await obterConfig(tx);
  const dia = diaHoteleiro(tx.relogio.agora(), config.fuso, config.viradaDia);
  const reservas = await tx.db
    .selectFrom("reservas")
    .select("codigo")
    .where("quarto_id", "=", quarto.id)
    .where("estado", "in", ESTADOS_ATIVOS)
    .where("saida", ">=", dia)
    .orderBy("codigo")
    .execute();
  if (reservas.length > 0 || quarto.situacao === "ocupado") {
    throw new ErroDominio(
      "QUARTO_COM_RESERVAS",
      `O quarto ${quarto.numero} está ocupado ou tem reservas ativas. Mude as reservas de quarto antes de alterá-lo.`,
      { codigos: reservas.map((r) => r.codigo) },
    );
  }
}

/** Número livre = nenhum outro quarto (ativo ou inativo) o usa; o banco também garante a unicidade. */
async function exigirNumeroLivre(tx: Contexto, numero: string, ignorarId?: string): Promise<void> {
  let q = tx.db.selectFrom("quartos").select("id").where("numero", "=", numero);
  if (ignorarId) q = q.where("id", "!=", ignorarId);
  if (await q.executeTakeFirst()) throw new ErroDominio("NUMERO_QUARTO_DUPLICADO", `Já existe um quarto com o número ${numero}. Use outro número.`, { numeros: [numero] });
}

export async function listarQuartos(ctx: Contexto, filtro?: { categoriaId?: string; incluirInativos?: boolean }): Promise<Quarto[]> {
  let q = ctx.db.selectFrom("quartos").selectAll();
  if (filtro?.categoriaId) q = q.where("categoria_id", "=", filtro.categoriaId);
  if (!filtro?.incluirInativos) q = q.where("ativo", "=", 1);
  return (await q.orderBy("numero").execute()).map(paraQuarto);
}

export async function editarQuarto(
  ctx: Contexto,
  id: string,
  d: { numero: string; categoriaId: string; bloco?: string | null },
  ator: string,
): Promise<Quarto> {
  return emTransacao(ctx, async (tx) => {
    const antes = await obterQuarto(tx, id);
    if (d.categoriaId !== antes.categoriaId) {
      await exigirCategoria(tx, d.categoriaId);
      await exigirSemReservas(tx, antes);
    }
    await exigirNumeroLivre(tx, d.numero, id);
    const depois: Quarto = { ...antes, numero: d.numero, categoriaId: d.categoriaId, bloco: d.bloco ?? null };
    await tx.db.updateTable("quartos").set({ numero: depois.numero, categoria_id: depois.categoriaId, bloco: depois.bloco }).where("id", "=", id).execute();
    await auditar(tx, { ator, acao: "quarto.editar", alvoTipo: "quarto", alvoId: id, dados: { antes, depois } });
    await registrarEvento(tx, "nucleo.QuartoEditado", { quartoId: id });
    return depois;
  });
}

/**
 * Desativar: bloqueado se o quarto está ocupado ou tem reserva ativa com saída a partir do dia hoteleiro
 * (QUARTO_COM_RESERVAS, detalhes.codigos). Reativar: a categoria do quarto precisa estar ativa.
 * Números são únicos entre todos os quartos (ativos e inativos), então reativar nunca gera duplicidade.
 */
export async function definirQuartoAtivo(ctx: Contexto, id: string, ativo: boolean, ator: string): Promise<void> {
  await emTransacao(ctx, async (tx) => {
    const quarto = await obterQuarto(tx, id);
    if (!ativo) await exigirSemReservas(tx, quarto);
    else await exigirCategoria(tx, quarto.categoriaId);
    await tx.db.updateTable("quartos").set({ ativo: ativo ? 1 : 0 }).where("id", "=", id).execute();
    await auditar(tx, { ator, acao: ativo ? "quarto.reativar" : "quarto.desativar", alvoTipo: "quarto", alvoId: id });
    await registrarEvento(tx, ativo ? "nucleo.QuartoReativado" : "nucleo.QuartoDesativado", { quartoId: id });
  });
}

/** Cria os quartos de..ate (números como texto). Qualquer número já existente (ativo ou inativo) cancela o lote inteiro. */
export async function criarQuartosEmLote(
  ctx: Contexto,
  d: { categoriaId: string; de: number; ate: number; bloco?: string },
  ator: string,
): Promise<Quarto[]> {
  if (!Number.isInteger(d.de) || !Number.isInteger(d.ate) || d.de < 0 || d.ate < d.de) {
    throw new ErroDominio("LOTE_INVALIDO", "Intervalo inválido. Informe números inteiros, com o final maior ou igual ao início.");
  }
  if (d.ate - d.de + 1 > MAX_LOTE) {
    throw new ErroDominio("LOTE_INVALIDO", `Cada lote pode criar no máximo ${MAX_LOTE} quartos.`, { maximo: MAX_LOTE });
  }
  return emTransacao(ctx, async (tx) => {
    await exigirCategoria(tx, d.categoriaId);
    const numeros = Array.from({ length: d.ate - d.de + 1 }, (_, i) => String(d.de + i));
    const existentes = await tx.db.selectFrom("quartos").select("numero").where("numero", "in", numeros).execute();
    if (existentes.length > 0) {
      const dup = new Set(existentes.map((e) => e.numero));
      throw new ErroDominio(
        "NUMERO_QUARTO_DUPLICADO",
        `Já existem quartos com os números ${numeros.filter((n) => dup.has(n)).join(", ")}. Nenhum quarto foi criado.`,
        { numeros: numeros.filter((n) => dup.has(n)) },
      );
    }
    const criados: Quarto[] = numeros.map((numero) => ({ id: novoId(), numero, categoriaId: d.categoriaId, bloco: d.bloco ?? null, situacao: "livre", ativo: true }));
    await tx.db
      .insertInto("quartos")
      .values(criados.map((q) => ({ id: q.id, numero: q.numero, categoria_id: q.categoriaId, bloco: q.bloco, situacao: q.situacao })))
      .execute();
    await auditar(tx, { ator, acao: "quarto.lote", alvoTipo: "categoria", alvoId: d.categoriaId, dados: { de: d.de, ate: d.ate, bloco: d.bloco ?? null, quartos: criados.map((q) => q.id) } });
    for (const q of criados) await registrarEvento(tx, "nucleo.QuartoCriado", { quartoId: q.id });
    return criados;
  });
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
