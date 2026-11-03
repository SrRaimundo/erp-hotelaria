import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../../shared/contexto.js";
import { novoId } from "../../shared/ids.js";
import { LocalService } from "../servicos/locais.js";
import { exigirFinanceiro, usuarioDe, uuid } from "./comum.js";

const nome = z.string().trim().min(1, "Informe o nome do local.");
const corpoCriar = z.object({ nome });
const corpoAtualizar = z.object({ nome: nome.optional(), ativo: z.boolean().optional(), hospedagem_padrao: z.boolean().optional() });

export function registrarRotasLocais(app: FastifyInstance, ctx: Contexto): void {
  app.get("/api/financeiro/locais", async (req) => {
    exigirFinanceiro(req);
    return new LocalService(ctx).listar();
  });

  app.post("/api/financeiro/locais", async (req, res) => {
    exigirFinanceiro(req);
    const c = corpoCriar.parse(req.body);
    // Cada local é uma ilha: o vínculo com a pousada é um identificador próprio, não compartilhado.
    const local = await new LocalService(ctx).criar(novoId(), c.nome, usuarioDe(req));
    return res.status(201).send({ ...local, hospedagem_padrao: false });
  });

  app.put("/api/financeiro/locais/:id", async (req) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = corpoAtualizar.parse(req.body);
    const svc = new LocalService(ctx);
    await svc.atualizar(id, { nome: c.nome, ativo: c.ativo }, usuarioDe(req));
    if (c.hospedagem_padrao) await svc.definirPadraoHospedagem(id, usuarioDe(req));
    return (await svc.listar()).find((l) => l.id === id);
  });
}
