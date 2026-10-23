import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export type Configuracao = { arquivoBanco: string; porta: number; host: string; webDir: string };

/** Lê a configuração do servidor das variáveis de ambiente ERP_DB, ERP_PORTA, ERP_HOST e ERP_WEB_DIR. */
export function lerConfiguracao(env: NodeJS.ProcessEnv = process.env): Configuracao {
  const bruta = env.ERP_PORTA?.trim() || "8080";
  const porta = Number(bruta);
  if (!/^\d+$/.test(bruta) || porta < 1 || porta > 65535) {
    throw new Error(`ERP_PORTA inválida ("${bruta}"). Use um número inteiro entre 1 e 65535.`);
  }
  return {
    arquivoBanco: env.ERP_DB?.trim() || "./dados/erp.db",
    porta,
    host: env.ERP_HOST?.trim() || "0.0.0.0",
    webDir: env.ERP_WEB_DIR?.trim() || resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist"),
  };
}
