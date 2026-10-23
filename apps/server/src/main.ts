import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { iniciarAgendador } from "./agendador.js";
import { lerConfiguracao } from "./config.js";
import { criarApp } from "./http/app.js";
import { Barramento } from "./infra/barramento.js";
import { abrirBanco, migrar } from "./shared/banco.js";
import type { Contexto } from "./shared/contexto.js";
import { todasMigracoes } from "./shared/migracoes.js";
import { relogioSistema } from "./shared/relogio.js";

async function iniciar(): Promise<void> {
  const config = lerConfiguracao();
  mkdirSync(dirname(config.arquivoBanco), { recursive: true });
  const db = abrirBanco(config.arquivoBanco);
  await migrar(db, todasMigracoes);

  const ctx: Contexto = { db, relogio: relogioSistema, barramento: new Barramento(), eventosPendentes: [] };
  const app = criarApp(ctx);
  const agendador = iniciarAgendador(ctx);

  let encerrando = false;
  const encerrar = async (sinal: string): Promise<void> => {
    if (encerrando) return;
    encerrando = true;
    console.log(`Recebido ${sinal}, encerrando...`);
    agendador.parar();
    try {
      await app.close();
      await db.destroy();
    } catch (erro) {
      console.error("Erro ao encerrar:", erro);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void encerrar("SIGINT"));
  process.once("SIGTERM", () => void encerrar("SIGTERM"));

  await app.listen({ port: config.porta, host: config.host });
  console.log(`Servidor ouvindo em http://${config.host}:${config.porta} (banco: ${config.arquivoBanco})`);
}

iniciar().catch((erro) => {
  console.error("Não foi possível iniciar o servidor:", erro);
  process.exit(1);
});
