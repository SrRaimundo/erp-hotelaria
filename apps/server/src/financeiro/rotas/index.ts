import type { FastifyInstance } from "fastify";
import type { Contexto } from "../../shared/contexto.js";
import { registrarRotasRelatorios } from "../relatórios/rotas.js";
import { registrarRotasCaixaBanco } from "./caixa-banco.js";
import { registrarRotasContasReceber } from "./contas-receber.js";
import { registrarRotasFaturamento } from "./faturamento.js";
import { registrarRotasLancamentos } from "./lançamentos.js";

export function registrarRotasFinanceiro(app: FastifyInstance, ctx: Contexto): void {
  registrarRotasLancamentos(app, ctx);
  registrarRotasFaturamento(app, ctx);
  registrarRotasContasReceber(app, ctx);
  registrarRotasCaixaBanco(app, ctx);
  registrarRotasRelatorios(app, ctx);
}
