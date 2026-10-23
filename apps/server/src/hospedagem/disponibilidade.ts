import type { Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { noites, type Data } from "../shared/tempo.js";
import { ESTADOS_ATIVOS } from "./estados.js";

const INDISPONIVEIS = ["em_manutencao", "bloqueado"];

/**
 * Lança QUARTO_INDISPONIVEL (quarto com reserva ativa sobreposta ou em manutenção/bloqueado)
 * ou CATEGORIA_LOTADA (em alguma noite, reservas ativas da categoria >= quartos disponíveis).
 * Chame dentro da transação que grava a reserva para que leitura e escrita sejam serializadas.
 */
export async function verificarDisponibilidade(
  tx: Contexto,
  p: { categoriaId: string; quartoId?: string; chegada: Data; saida: Data; ignorarReservaId?: string },
): Promise<void> {
  if (p.quartoId) {
    const quarto = await tx.db.selectFrom("quartos").select(["numero", "situacao"]).where("id", "=", p.quartoId).executeTakeFirst();
    if (!quarto) throw new ErroDominio("QUARTO_NAO_ENCONTRADO", "Quarto não encontrado.");
    if (INDISPONIVEIS.includes(quarto.situacao)) {
      throw new ErroDominio("QUARTO_INDISPONIVEL", `O quarto ${quarto.numero} está fora de uso (${quarto.situacao.replace("_", " ")}). Escolha outro quarto.`);
    }
    let q = tx.db
      .selectFrom("reservas")
      .select("id")
      .where("quarto_id", "=", p.quartoId)
      .where("estado", "in", ESTADOS_ATIVOS)
      .where("chegada", "<", p.saida)
      .where("saida", ">", p.chegada);
    if (p.ignorarReservaId) q = q.where("id", "!=", p.ignorarReservaId);
    if (await q.executeTakeFirst()) {
      throw new ErroDominio("QUARTO_INDISPONIVEL", `O quarto ${quarto.numero} já está reservado em parte deste período. Escolha outro quarto ou outras datas.`);
    }
  }

  const disponiveis = await tx.db
    .selectFrom("quartos")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("categoria_id", "=", p.categoriaId)
    .where("situacao", "not in", INDISPONIVEIS)
    .executeTakeFirstOrThrow();
  let q = tx.db
    .selectFrom("reservas")
    .select(["chegada", "saida"])
    .where("categoria_id", "=", p.categoriaId)
    .where("estado", "in", ESTADOS_ATIVOS)
    .where("chegada", "<", p.saida)
    .where("saida", ">", p.chegada);
  if (p.ignorarReservaId) q = q.where("id", "!=", p.ignorarReservaId);
  const ativas = await q.execute();
  for (const d of noites(p.chegada, p.saida)) {
    const ocupadas = ativas.filter((r) => r.chegada <= d && r.saida > d).length;
    if (ocupadas >= disponiveis.n) {
      throw new ErroDominio("CATEGORIA_LOTADA", `Não há mais quartos desta categoria na noite de ${d.split("-").reverse().join("/")}. Escolha outra categoria ou outras datas.`, { data: d });
    }
  }
}
