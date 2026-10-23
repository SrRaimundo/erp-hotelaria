import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { ErroDominio } from "../shared/erros.js";

export function tratarErro(erro: FastifyError | Error, _req: FastifyRequest, res: FastifyReply): FastifyReply {
  if (erro instanceof ErroDominio) {
    const status = erro.codigo === "SEM_PERMISSAO" ? 403 : 422;
    return res.status(status).send({ codigo: erro.codigo, mensagem: erro.message, detalhes: erro.detalhes ?? null });
  }
  if (erro instanceof ZodError) {
    const campos = erro.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message }));
    return res.status(400).send({ codigo: "DADOS_INVALIDOS", mensagem: "Há dados inválidos. Corrija os campos indicados.", campos });
  }
  const status = (erro as FastifyError).statusCode;
  if (status && status >= 400 && status < 500) {
    return res.status(400).send({ codigo: "REQUISICAO_INVALIDA", mensagem: "Requisição inválida. Confira os dados enviados." });
  }
  console.error(erro);
  return res.status(500).send({ codigo: "ERRO_INTERNO", mensagem: "Algo deu errado no servidor. Tente de novo." });
}
