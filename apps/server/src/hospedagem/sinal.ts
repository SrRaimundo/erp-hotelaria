import { criarAlerta, resolverAlerta } from "../infra/alertas.js";
import { ATOR_SISTEMA, auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { obterConfig } from "../nucleo/pousada.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { pagoNaReserva } from "./conta.js";
import { transicionar } from "./estados.js";

const MOTIVO = "sinal não pago";

/**
 * Avisa as pré-reservas com sinal vencido e cancela as que seguem sem pagamento após a tolerância.
 * Idempotente. Cada reserva roda na sua própria transação; uma falha não impede as demais.
 */
export async function processarSinais(ctx: Contexto): Promise<{ avisadas: string[]; canceladas: string[] }> {
  const avisadas: string[] = [];
  const canceladas: string[] = [];
  const { sinal } = await obterConfig(ctx);
  const toleranciaMs = sinal.toleranciaHoras * 3_600_000;
  const candidatas = await ctx.db
    .selectFrom("reservas")
    .select("id")
    .where("estado", "=", "pre_reserva")
    .where("prazo_sinal", "is not", null)
    .orderBy("prazo_sinal")
    .orderBy("id")
    .execute();

  for (const { id } of candidatas) {
    try {
      await emTransacao(ctx, async (tx) => {
        const r = await tx.db.selectFrom("reservas").select(["estado", "prazo_sinal", "aviso_sinal_em"]).where("id", "=", id).executeTakeFirst();
        if (!r || r.estado !== "pre_reserva" || !r.prazo_sinal) return;
        const agora = tx.relogio.agora().toISOString();
        let aviso = r.aviso_sinal_em;
        if (!aviso) {
          if (agora < r.prazo_sinal) return;
          await tx.db.updateTable("reservas").set({ aviso_sinal_em: agora }).where("id", "=", id).execute();
          await criarAlerta(tx, {
            tipo: "sinal_vencido", alvoTipo: "reserva", alvoId: id,
            mensagem: "O prazo do sinal desta pré-reserva venceu. Cobre o sinal ou prorrogue o prazo, ou a reserva será cancelada.",
          });
          aviso = agora;
          avisadas.push(id);
        }
        if (new Date(aviso).getTime() + toleranciaMs > tx.relogio.agora().getTime()) return;

        if ((await pagoNaReserva(tx, id)) > 0) {
          await criarAlerta(tx, {
            tipo: "sinal_parcial", alvoTipo: "reserva", alvoId: id,
            mensagem: "O sinal foi pago só em parte e o prazo acabou. A reserva não foi cancelada: cobre o restante ou decida o que fazer.",
          });
          return;
        }
        transicionar(r.estado, "cancelada");
        await tx.db.updateTable("reservas").set({ estado: "cancelada" }).where("id", "=", id).execute();
        const abertos = await tx.db.selectFrom("alertas").select("id")
          .where("alvo_tipo", "=", "reserva").where("alvo_id", "=", id).where("tipo", "=", "sinal_vencido").where("resolvido_em", "is", null).execute();
        for (const a of abertos) await resolverAlerta(tx, a.id, ATOR_SISTEMA);
        await auditar(tx, {
          ator: ATOR_SISTEMA, acao: "reserva.cancelar", motivo: MOTIVO, alvoTipo: "reserva", alvoId: id,
          dados: { estadoAnterior: r.estado, prazoSinal: r.prazo_sinal },
        });
        await registrarEvento(tx, "hospedagem.ReservaCancelada", { reservaId: id, motivo: MOTIVO, automatico: true });
        canceladas.push(id);
      });
    } catch (e) {
      // Falha em uma reserva não bloqueia as demais; a próxima execução tenta de novo.
      const i = avisadas.indexOf(id);
      if (i >= 0) avisadas.splice(i, 1);
      console.error(`Falha ao processar o sinal da reserva ${id}:`, e);
    }
  }
  return { avisadas, canceladas };
}
