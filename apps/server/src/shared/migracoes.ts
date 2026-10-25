import { migracaoInfra } from "../infra/migracao.js";
import { migracaoNucleo, migracaoNucleoCadastros, migracaoNucleoCaixa, migracaoNucleoUsuarios } from "../nucleo/migracao.js";
import { migracaoHospedagem, migracaoHospedagemConta, migracaoHospedagemFaturadoSemTurno, migracaoHospedagemReceber } from "../hospedagem/migracao.js";
import { migracaoGovernancaAlertasChave, migracaoGovernancaChamados, migracaoGovernancaExecucoes, migracaoGovernancaModelos, migracaoGovernancaSetores } from "../governanca/migracao.js";
import { migracaoTarifas } from "../tarifas/migracao.js";
import type { Migracao } from "./banco.js";

/**
 * Registro único de migrações. Cada módulo acrescenta as suas aqui,
 * com nomes de prefixo numérico: 0100_infra*, 0200_nucleo*, 0300_tarifas*, 0400_hospedagem*, 0500_governanca*.
 */
export const todasMigracoes: Migracao[] = [migracaoInfra, migracaoNucleo, migracaoNucleoCadastros, migracaoNucleoUsuarios, migracaoNucleoCaixa, migracaoTarifas, migracaoHospedagem, migracaoHospedagemConta, migracaoHospedagemReceber, migracaoHospedagemFaturadoSemTurno, migracaoGovernancaSetores, migracaoGovernancaModelos, migracaoGovernancaChamados, migracaoGovernancaAlertasChave, migracaoGovernancaExecucoes];
