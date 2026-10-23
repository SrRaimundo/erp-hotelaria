import { processarSinais } from "./hospedagem/sinal.js";
import { processarVirada } from "./hospedagem/virada.js";
import type { Contexto } from "./shared/contexto.js";

export type Agendador = { parar(): void; tick(): Promise<void> };

/**
 * Roda os jobs periódicos (sinais vencidos e virada do dia) a cada intervalo, e já uma vez ao iniciar.
 * Um erro em um job é registrado e não impede o outro. Execuções não se sobrepõem:
 * se a anterior ainda não terminou, tick() devolve a que está em andamento.
 */
export function iniciarAgendador(ctx: Contexto, intervaloMs = 60_000): Agendador {
  let emAndamento: Promise<void> | null = null;

  const executar = async (): Promise<void> => {
    const jobs: [string, (c: Contexto) => Promise<unknown>][] = [
      ["sinais", processarSinais],
      ["virada", processarVirada],
    ];
    for (const [nome, job] of jobs) {
      try {
        await job(ctx);
      } catch (erro) {
        console.error(`Falha no job de ${nome}:`, erro);
      }
    }
  };

  const tick = (): Promise<void> => {
    if (!emAndamento) emAndamento = executar().finally(() => { emAndamento = null; });
    return emAndamento;
  };

  void tick();
  const timer = setInterval(() => void tick(), intervaloMs);
  timer.unref();
  return { parar: () => clearInterval(timer), tick };
}
