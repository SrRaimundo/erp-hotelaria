import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { autorizarSupervisor } from "../../nucleo/supervisor.js";
import type { Contexto } from "../../shared/contexto.js";
import { LançamentoService } from "../servicos/lançamentos.js";
import { credencialSupervisor, data, exigirFinanceiro, fimDoDia, inicioDoDia, usuarioDe, uuid } from "./comum.js";

const queryListar = z.object({ local_id: uuid, data_inicio: data.optional(), data_fim: data.optional() });
const corpoCancelar = z.object({ motivo: z.string(), supervisor: credencialSupervisor.optional() });

export function registrarRotasLancamentos(app: FastifyInstance, ctx: Contexto): void {
  app.get("/api/financeiro/lancamentos", async (req) => {
    exigirFinanceiro(req);
    const q = queryListar.parse(req.query);
    const lista = await new LançamentoService(ctx).listar(q.local_id, {
      data_inicio: q.data_inicio ? inicioDoDia(q.data_inicio) : undefined,
      data_fim: q.data_fim ? fimDoDia(q.data_fim) : undefined,
    });
    return lista.map((l) => ({ ...l, valor: l.valor.centavos }));
  });

  // Ação sensível: exige motivo e credencial de supervisor.
  app.delete("/api/financeiro/lancamentos/:id", async (req) => {
    exigirFinanceiro(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = corpoCancelar.parse(req.body ?? {});
    const aut = await autorizarSupervisor(ctx, corpo.supervisor, corpo.motivo);
    const l = await new LançamentoService(ctx).cancelar(id, aut.motivo, aut.supervisorId, usuarioDe(req));
    return { ...l, valor: l.valor.centavos };
  });
}
