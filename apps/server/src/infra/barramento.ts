export type Evento = { id: string; seq: number; tipo: string; payload: unknown; criadoEm: string };

type Assinante = (e: Evento) => void | Promise<void>;

/** Barramento em memória. Falhas de assinantes (síncronas ou assíncronas) são registradas e isoladas. */
export class Barramento {
  private assinantes = new Map<string, Assinante[]>();

  assinar(tipo: string, fn: Assinante): void {
    const lista = this.assinantes.get(tipo) ?? [];
    lista.push(fn);
    this.assinantes.set(tipo, lista);
  }

  publicar(e: Evento): void {
    for (const fn of this.assinantes.get(e.tipo) ?? []) {
      try {
        const r = fn(e);
        if (r) r.catch((erro) => console.error(`Assinante de ${e.tipo} falhou:`, erro));
      } catch (erro) {
        console.error(`Assinante de ${e.tipo} falhou:`, erro);
      }
    }
  }
}
