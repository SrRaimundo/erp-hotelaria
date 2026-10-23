import Fastify, { type FastifyInstance } from "fastify";
import type { Contexto } from "../shared/contexto.js";
import { registrarRotasBase } from "../nucleo/rotas.js";
import { registrarRotasHospedagem } from "../hospedagem/rotas.js";
import { registrarRotasTarifas } from "../tarifas/rotas.js";
import { registrarAutenticacao } from "./autenticacao.js";
import { tratarErro } from "./erros-http.js";
import { registrarEstaticos } from "./estaticos.js";

export function criarApp(ctx: Contexto, opcoes: { webDir?: string } = {}): FastifyInstance {
  const app = Fastify();
  app.setErrorHandler(tratarErro);
  registrarAutenticacao(app, ctx);
  registrarRotasBase(app, ctx);
  registrarRotasTarifas(app, ctx);
  registrarRotasHospedagem(app, ctx);
  if (opcoes.webDir) registrarEstaticos(app, opcoes.webDir);
  return app;
}
