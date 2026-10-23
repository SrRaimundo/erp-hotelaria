import { exigirPermissao, type UsuarioSessao } from "../nucleo/permissoes.js";
import { listarQuartos, mudarSituacaoQuarto, obterQuarto, type SituacaoQuarto } from "../nucleo/quartos.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import type { Data } from "../shared/tempo.js";

export type ItemGovernanca = { quartoId: string; numero: string; situacao: SituacaoQuarto; hospedadoAte?: Data };

/** Quartos sujos primeiro, depois por número; `hospedadoAte` é a saída da reserva hospedada no quarto. */
export async function listaGovernanca(ctx: Contexto): Promise<ItemGovernanca[]> {
  const quartos = await listarQuartos(ctx);
  const hospedadas = await ctx.db
    .selectFrom("reservas")
    .select(["quarto_id", "saida"])
    .where("estado", "=", "hospedada")
    .where("quarto_id", "is not", null)
    .execute();
  const saidaPorQuarto = new Map(hospedadas.map((r) => [r.quarto_id as string, r.saida as Data]));
  const itens = quartos.map((q): ItemGovernanca => {
    const item: ItemGovernanca = { quartoId: q.id, numero: q.numero, situacao: q.situacao };
    const saida = saidaPorQuarto.get(q.id);
    if (saida) item.hospedadoAte = saida;
    return item;
  });
  return itens.sort((a, b) => Number(b.situacao === "sujo") - Number(a.situacao === "sujo") || a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));
}

export async function marcarLimpo(ctx: Contexto, quartoId: string, usuario: UsuarioSessao): Promise<void> {
  exigirPermissao(usuario, "quartos.situacao");
  await emTransacao(ctx, async (tx) => {
    const quarto = await obterQuarto(tx, quartoId);
    if (quarto.situacao !== "sujo") {
      throw new ErroDominio("TRANSICAO_QUARTO_INVALIDA", `O quarto ${quarto.numero} não está sujo, então não há o que marcar como limpo.`, { de: quarto.situacao, para: "livre" });
    }
    await mudarSituacaoQuarto(tx, quartoId, "livre", usuario.id);
  });
}

function exigirMotivo(motivo: string): string {
  const m = motivo.trim();
  if (!m) throw new ErroDominio("MOTIVO_OBRIGATORIO", "Informe o motivo.");
  return m;
}

async function restringir(ctx: Contexto, quartoId: string, nova: "em_manutencao" | "bloqueado", motivo: string, usuario: UsuarioSessao): Promise<void> {
  exigirPermissao(usuario, "quartos.manutencao");
  const m = exigirMotivo(motivo);
  await emTransacao(ctx, async (tx) => {
    const quarto = await obterQuarto(tx, quartoId);
    const hospedada = await tx.db.selectFrom("reservas").select("id").where("quarto_id", "=", quartoId).where("estado", "=", "hospedada").executeTakeFirst();
    if (hospedada) {
      throw new ErroDominio("QUARTO_OCUPADO", `O quarto ${quarto.numero} tem hóspede. Faça o check-out antes de tirá-lo de uso.`);
    }
    await mudarSituacaoQuarto(tx, quartoId, nova, usuario.id, m);
  });
}

export const colocarEmManutencao = (ctx: Contexto, quartoId: string, motivo: string, usuario: UsuarioSessao) =>
  restringir(ctx, quartoId, "em_manutencao", motivo, usuario);

export const bloquear = (ctx: Contexto, quartoId: string, motivo: string, usuario: UsuarioSessao) =>
  restringir(ctx, quartoId, "bloqueado", motivo, usuario);

export async function liberar(ctx: Contexto, quartoId: string, motivo: string, usuario: UsuarioSessao): Promise<void> {
  exigirPermissao(usuario, "quartos.manutencao");
  const m = exigirMotivo(motivo);
  await emTransacao(ctx, async (tx) => {
    const quarto = await obterQuarto(tx, quartoId);
    if (quarto.situacao !== "em_manutencao" && quarto.situacao !== "bloqueado") {
      throw new ErroDominio("TRANSICAO_QUARTO_INVALIDA", `O quarto ${quarto.numero} não está em manutenção nem bloqueado.`, { de: quarto.situacao, para: "livre" });
    }
    await mudarSituacaoQuarto(tx, quartoId, "livre", usuario.id, m);
  });
}
