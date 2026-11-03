import type { FastifyInstance } from "fastify";
import type { Contexto } from "../../shared/contexto.js";
import { registrarRotasRelatorios } from "../relatórios/rotas.js";
import { registrarRotasCadastros } from "./cadastros.js";
import { registrarRotasCaixaBanco } from "./caixa-banco.js";
import { registrarRotasCartao } from "./cartao.js";
import { registrarRotasContasPagar } from "./contas-pagar.js";
import { registrarRotasLocais } from "./locais.js";
import { registrarRotasContasReceber } from "./contas-receber.js";
import { registrarRotasFaturamento } from "./faturamento.js";
import { registrarRotasLancamentos } from "./lançamentos.js";

export function registrarRotasFinanceiro(app: FastifyInstance, ctx: Contexto): void {
  registrarRotasLocais(app, ctx);
  registrarRotasCadastros(app, ctx);
  registrarRotasLancamentos(app, ctx);
  registrarRotasContasPagar(app, ctx);
  registrarRotasCartao(app, ctx);
  registrarRotasFaturamento(app, ctx);
  registrarRotasContasReceber(app, ctx);
  registrarRotasCaixaBanco(app, ctx);
  registrarRotasRelatorios(app, ctx);
}
