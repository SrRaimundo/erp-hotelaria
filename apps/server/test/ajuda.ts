import { Barramento } from "../src/infra/barramento.js";
import { abrirBanco, migrar } from "../src/shared/banco.js";
import type { Contexto } from "../src/shared/contexto.js";
import { todasMigracoes } from "../src/shared/migracoes.js";
import { RelogioFixo } from "../src/shared/relogio.js";

export async function criarContextoTeste(
  iso = "2026-11-10T15:00:00Z",
): Promise<Contexto & { relogio: RelogioFixo; barramento: Barramento }> {
  const db = abrirBanco(":memory:");
  await migrar(db, todasMigracoes);
  return { db, relogio: new RelogioFixo(iso), barramento: new Barramento(), eventosPendentes: [] };
}
