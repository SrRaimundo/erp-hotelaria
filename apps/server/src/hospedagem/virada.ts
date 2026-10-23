import { ATOR_SISTEMA } from "../infra/auditoria.js";
import { obterConfig } from "../nucleo/pousada.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { diaHoteleiro, type Data } from "../shared/tempo.js";
import { lancar } from "./conta.js";

/**
 * Lança as noites congeladas D com chegada <= D < `ate` que ainda não têm diária na conta.
 * Roda na transação do chamador. Noite com valor zero não gera lançamento. Retorna quantas lançou.
 */
export async function lancarDiariasPendentes(tx: Contexto, reservaId: string, ate: Data): Promise<number> {
  const reserva = await tx.db.selectFrom("reservas").select(["conta_id", "chegada"]).where("id", "=", reservaId).executeTakeFirst();
  if (!reserva) throw new ErroDominio("RESERVA_NAO_ENCONTRADA", "Reserva não encontrada. Confira o número informado.", { id: reservaId });
  const noites = await tx.db.selectFrom("reserva_noites").select(["data", "valor", "passos"])
    .where("reserva_id", "=", reservaId).where("data", ">=", reserva.chegada).where("data", "<", ate).orderBy("data").execute();
  const feitas = new Set(
    (await tx.db.selectFrom("lancamentos").select("data_ref").where("reserva_id", "=", reservaId).where("tipo", "=", "diaria").execute()).map((l) => l.data_ref),
  );
  let total = 0;
  for (const noite of noites) {
    if (feitas.has(noite.data) || noite.valor < 1) continue;
    const passos = JSON.parse(noite.passos) as { rotulo: string }[];
    const [, mes, dia] = noite.data.split("-");
    await lancar(tx, {
      contaId: reserva.conta_id, reservaId, tipo: "diaria", origem: "hospedagem",
      descricao: `Diária ${dia}/${mes} — ${passos.at(-1)?.rotulo ?? "Diária"}`,
      quantidade: 1, valorUnitario: noite.valor, dataRef: noite.data,
    }, ATOR_SISTEMA);
    total++;
  }
  return total;
}

/**
 * Virada do dia hoteleiro: lança as diárias vencidas das reservas hospedadas.
 * Idempotente. Cada reserva roda na sua transação; uma falha não impede as demais. Retorna o total lançado.
 */
export async function processarVirada(ctx: Contexto): Promise<number> {
  const config = await obterConfig(ctx);
  const hoje = diaHoteleiro(ctx.relogio.agora(), config.fuso, config.viradaDia);
  const hospedadas = await ctx.db.selectFrom("reservas").select(["id", "saida"]).where("estado", "=", "hospedada").orderBy("id").execute();
  let total = 0;
  for (const { id, saida } of hospedadas) {
    try {
      total += await emTransacao(ctx, (tx) => lancarDiariasPendentes(tx, id, hoje < saida ? hoje : saida));
    } catch (e) {
      console.error(`Falha ao lançar as diárias da reserva ${id}:`, e);
    }
  }
  return total;
}
