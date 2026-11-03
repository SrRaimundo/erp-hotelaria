import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { autorizarSupervisor } from "../../nucleo/supervisor.js";
import type { Contexto } from "../../shared/contexto.js";
import { CadastrosFinanceiroService } from "../servicos/cadastros.js";
import { LançamentoService } from "../servicos/lançamentos.js";
import { credencialSupervisor, data, exigirFinanceiro, fimDoDia, inicioDoDia, usuarioDe, uuid } from "./comum.js";

const queryListar = z.object({
  local_id: uuid, data_inicio: data.optional(), data_fim: data.optional(), tipo: z.enum(["recebimento", "pagamento", "transferencia", "ajuste"]).optional(),
});
const corpoCancelar = z.object({ motivo: z.string(), supervisor: credencialSupervisor.optional() });

export function registrarRotasLancamentos(app: FastifyInstance, ctx: Contexto): void {
  app.get("/api/financeiro/lancamentos", async (req) => {
    exigirFinanceiro(req);
    const q = queryListar.parse(req.query);
    const lista = await new LançamentoService(ctx).listar(q.local_id, {
      data_inicio: q.data_inicio ? await inicioDoDia(ctx, q.data_inicio) : undefined,
      data_fim: q.data_fim ? await fimDoDia(ctx, q.data_fim) : undefined,
    });
    const fornecedores = new Map((await new CadastrosFinanceiroService(ctx).listarFornecedores(q.local_id)).map((f) => [f.id, f.razao_social]));
    return lista
      .filter((l) => !q.tipo || l.tipo === q.tipo)
      .map((l) => ({ ...l, valor: l.valor.centavos, fornecedor_nome: l.fornecedor_id ? (fornecedores.get(l.fornecedor_id) ?? null) : null }));
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
