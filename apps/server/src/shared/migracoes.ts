import { migracaoInfra } from "../infra/migracao.js";
import type { Migracao } from "./banco.js";

/**
 * Registro único de migrações. Cada módulo acrescenta as suas aqui,
 * com nomes de prefixo numérico: 0100_infra*, 0200_nucleo*, 0300_tarifas*, 0400_hospedagem*.
 */
export const todasMigracoes: Migracao[] = [migracaoInfra];
