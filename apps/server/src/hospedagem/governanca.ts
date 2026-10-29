import { sql } from "kysely";
import { defeitosAbertos } from "../governanca/chamados.js";
import { exigirPermissao, type UsuarioSessao } from "../nucleo/permissoes.js";
import { listarQuartos, mudarSituacaoQuarto, obterQuarto, type SituacaoQuarto } from "../nucleo/quartos.js";
import { obterConfig } from "../nucleo/pousada.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { diaHoteleiro, type Data } from "../shared/tempo.js";

export type ItemGovernanca = {
  quartoId: string;
  numero: string;
  situacao: SituacaoQuarto;
  hospedadoAte?: Data;
  tarefa: "limpeza_saida" | "arrumacao" | null;
  /** ISO da última arrumação (diária) concluída no dia hoteleiro atual. */
  arrumadoHojeEm: string | null;
  motivoBloqueio: string | null;
  chamadosAbertos: number;
  /** Chamados de defeito abertos (os que impedem Liberado). */
  defeitosAbertos: number;
  /** Reserva hospedada no quarto, quando há. */
  reservaId: string | null;
  /** Instante da última entrada do quarto na situação atual (auditoria); identifica o período em que o rascunho nasceu. */
  situacaoDesde: string | null;
};

/** Última arrumação (checklist de diária) da hospedagem atual de cada quarto, concluída dentro do dia hoteleiro atual. */
export async function arrumacoesDeHoje(ctx: Contexto): Promise<Map<string, string>> {
  const agora = ctx.relogio.agora();
  const config = await obterConfig(ctx);
  const hoje = diaHoteleiro(agora, config.fuso, config.viradaDia);
  const linhas = await ctx.db
    .selectFrom("checklist_execucoes as e")
    // Só vale a arrumação da reserva hoje hospedada: hóspede novo no mesmo dia volta a ter a tarefa.
    .innerJoin("reservas as r", (j) => j.onRef("r.id", "=", "e.reserva_id").on("r.estado", "=", "hospedada"))
    .select(["e.quarto_id", "e.concluido_em"])
    .where("e.tipo", "=", "diaria")
    .where("e.concluido_em", ">=", new Date(agora.getTime() - 48 * 3_600_000).toISOString())
    .orderBy("e.concluido_em")
    .execute();
  const porQuarto = new Map<string, string>();
  for (const l of linhas) {
    if (diaHoteleiro(new Date(l.concluido_em), config.fuso, config.viradaDia) === hoje) porQuarto.set(l.quarto_id, l.concluido_em);
  }
  return porQuarto;
}

/** Motivo da última mudança de situação do quarto (bloqueio ou manutenção), vindo da auditoria. */
export async function motivoDaSituacao(ctx: Contexto, quartoId: string, soComMotivo = false): Promise<string | null> {
  let q = ctx.db
    .selectFrom("auditoria")
    .select("motivo")
    .where("acao", "=", "quarto.situacao")
    .where("alvo_id", "=", quartoId);
  // Bloqueio e manutenção sempre gravam motivo; pular as mudanças sem motivo evita empate de instante com a passagem por "sujo".
  if (soComMotivo) q = q.where("motivo", "is not", null);
  const ultima = await q
    .orderBy("instante", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
  return ultima?.motivo ?? null;
}

/** Instante da última entrada em cada situação, por quarto, vindo da auditoria (`quarto.situacao`). */
async function entradasNasSituacoes(ctx: Contexto, quartoId?: string): Promise<Map<string, Map<string, string>>> {
  let q = ctx.db
    .selectFrom("auditoria")
    .select(["alvo_id", sql<string>`json_extract(dados, '$.para')`.as("para"), (eb) => eb.fn.max("instante").as("instante")])
    .where("acao", "=", "quarto.situacao");
  if (quartoId) q = q.where("alvo_id", "=", quartoId);
  const mapa = new Map<string, Map<string, string>>();
  for (const l of await q.groupBy("alvo_id").groupBy(sql`json_extract(dados, '$.para')`).execute()) {
    if (!mapa.has(l.alvo_id)) mapa.set(l.alvo_id, new Map());
    mapa.get(l.alvo_id)!.set(l.para, l.instante as string);
  }
  return mapa;
}

const GRUPO = { limpeza_saida: 0, arrumacao: 1, bloqueado: 2, demais: 3 } as const;

/** Ordem: limpeza de saída, arrumação, bloqueados/em manutenção e os demais; número crescente em cada grupo. `hospedadoAte` é a saída da reserva hospedada. */
export async function listaGovernanca(ctx: Contexto): Promise<ItemGovernanca[]> {
  const quartos = await listarQuartos(ctx);
  const hospedadas = await ctx.db
    .selectFrom("reservas")
    .select(["id", "quarto_id", "saida"])
    .where("estado", "=", "hospedada")
    .where("quarto_id", "is not", null)
    .execute();
  const saidaPorQuarto = new Map(hospedadas.map((r) => [r.quarto_id as string, r.saida as Data]));
  const reservaPorQuarto = new Map(hospedadas.map((r) => [r.quarto_id as string, r.id]));
  const arrumados = await arrumacoesDeHoje(ctx);
  const abertos = await ctx.db.selectFrom("chamados").select(["quarto_id", "tipo", (eb) => eb.fn.countAll<number>().as("n")]).where("situacao", "=", "aberto").groupBy("quarto_id").groupBy("tipo").execute();
  const chamadosPorQuarto = new Map<string, number>();
  const defeitosPorQuarto = new Map<string, number>();
  for (const c of abertos) {
    chamadosPorQuarto.set(c.quarto_id, (chamadosPorQuarto.get(c.quarto_id) ?? 0) + Number(c.n));
    if (c.tipo === "defeito") defeitosPorQuarto.set(c.quarto_id, Number(c.n));
  }
  const entradas = await entradasNasSituacoes(ctx);
  const itens: ItemGovernanca[] = [];
  for (const q of quartos) {
    const saida = saidaPorQuarto.get(q.id);
    const arrumadoHojeEm = arrumados.get(q.id) ?? null;
    const restrito = q.situacao === "bloqueado" || q.situacao === "em_manutencao";
    const item: ItemGovernanca = {
      quartoId: q.id, numero: q.numero, situacao: q.situacao,
      tarefa: q.situacao === "sujo" ? "limpeza_saida" : saida && !arrumadoHojeEm ? "arrumacao" : null,
      arrumadoHojeEm,
      motivoBloqueio: restrito ? await motivoDaSituacao(ctx, q.id, true) : null,
      chamadosAbertos: chamadosPorQuarto.get(q.id) ?? 0,
      defeitosAbertos: defeitosPorQuarto.get(q.id) ?? 0,
      reservaId: reservaPorQuarto.get(q.id) ?? null,
      situacaoDesde: entradas.get(q.id)?.get(q.situacao) ?? null,
    };
    if (saida) item.hospedadoAte = saida;
    itens.push(item);
  }
  const grupo = (i: ItemGovernanca) =>
    i.tarefa === "limpeza_saida" ? GRUPO.limpeza_saida : i.tarefa === "arrumacao" ? GRUPO.arrumacao : i.situacao === "bloqueado" || i.situacao === "em_manutencao" ? GRUPO.bloqueado : GRUPO.demais;
  return itens.sort((a, b) => grupo(a) - grupo(b) || a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));
}

function exigirMotivo(motivo: string): string {
  const m = motivo.trim();
  if (!m) throw new ErroDominio("MOTIVO_OBRIGATORIO", "Informe o motivo.");
  return m;
}

async function restringir(ctx: Contexto, quartoId: string, nova: "em_manutencao" | "bloqueado", motivo: string, usuario: UsuarioSessao): Promise<SituacaoQuarto> {
  exigirPermissao(usuario, "quartos.manutencao");
  const m = exigirMotivo(motivo);
  return emTransacao(ctx, async (tx) => {
    const quarto = await obterQuarto(tx, quartoId);
    const hospedada = await tx.db.selectFrom("reservas").select("id").where("quarto_id", "=", quartoId).where("estado", "=", "hospedada").executeTakeFirst();
    if (hospedada) {
      throw new ErroDominio("QUARTO_OCUPADO", `O quarto ${quarto.numero} tem hóspede. Faça o check-out antes de tirá-lo de uso.`);
    }
    await mudarSituacaoQuarto(tx, quartoId, nova, usuario.id, m);
    return nova;
  });
}

export const colocarEmManutencao = (ctx: Contexto, quartoId: string, motivo: string, usuario: UsuarioSessao) =>
  restringir(ctx, quartoId, "em_manutencao", motivo, usuario);

export const bloquear = (ctx: Contexto, quartoId: string, motivo: string, usuario: UsuarioSessao) =>
  restringir(ctx, quartoId, "bloqueado", motivo, usuario);

/**
 * Tira o quarto de manutenção/bloqueio. Quarto que ainda não teve o checklist de saída do seu período sujo
 * volta para "sujo" (limpeza), nunca direto para a venda.
 */
export async function liberar(ctx: Contexto, quartoId: string, motivo: string, usuario: UsuarioSessao): Promise<SituacaoQuarto> {
  exigirPermissao(usuario, "quartos.manutencao");
  const m = exigirMotivo(motivo);
  return emTransacao(ctx, async (tx) => {
    const quarto = await obterQuarto(tx, quartoId);
    if (quarto.situacao !== "em_manutencao" && quarto.situacao !== "bloqueado") {
      throw new ErroDominio("TRANSICAO_QUARTO_INVALIDA", `O quarto ${quarto.numero} não está em manutenção nem bloqueado.`, { de: quarto.situacao, para: "livre" });
    }
    const defeitos = await defeitosAbertos(tx, quartoId);
    if (defeitos > 0) {
      throw new ErroDominio("CHAMADO_ABERTO", `Há ${defeitos} chamado(s) de defeito aberto(s) neste quarto.`, { defeitos });
    }
    const sujoDesde = (await entradasNasSituacoes(tx, quartoId)).get(quartoId)?.get("sujo");
    let destino: SituacaoQuarto = "livre";
    if (sujoDesde) {
      const saida = await tx.db.selectFrom("checklist_execucoes").select("id").where("quarto_id", "=", quartoId).where("tipo", "=", "saida").where("concluido_em", ">=", sujoDesde).executeTakeFirst();
      if (!saida) destino = "sujo";
    }
    await mudarSituacaoQuarto(tx, quartoId, destino, usuario.id, m);
    return destino;
  });
}
