import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../nucleo/permissoes.js";
import type { Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { relatorioCafe } from "./cafe.js";
import { relatorioCaixa, filtrosPeriodo, turnosDoPeriodo } from "./caixa.js";
import { relatorioCheckIn } from "./check-in.js";
import { relatorioCheckOut } from "./check-out.js";
import { relatorioConta } from "./conta.js";
import { relatorioHospedes } from "./hospedes.js";
import { relatorioLimpeza } from "./limpeza.js";
import type { DefinicaoRelatorio } from "./modelo.js";
import { relatorioNaCasa } from "./na-casa.js";

/** Catálogo: um relatório novo é uma entrada aqui (id, permissão, filtros zod e gerar). */
export const REGISTRO: DefinicaoRelatorio[] = [
  relatorioCheckIn, relatorioCheckOut, relatorioNaCasa, relatorioCafe, relatorioLimpeza, relatorioConta, relatorioHospedes, relatorioCaixa,
];

function analisar<T>(esquema: z.ZodType<T, unknown>, entrada: unknown): T {
  const r = esquema.safeParse(entrada);
  if (r.success) return r.data;
  const campos = r.error.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message }));
  throw new ErroDominio("FILTRO_INVALIDO", campos.map((c) => c.mensagem).join(" "), campos);
}

export function registrarRotasRelatorios(app: FastifyInstance, ctx: Contexto): void {
  // Rota estática: o roteador a prefere a /api/relatorios/:id, então "caixa/turnos" nunca cai no :id.
  app.get("/api/relatorios/caixa/turnos", async (req) => {
    exigirPermissao(req.usuario, "caixa.operar");
    const f = analisar(filtrosPeriodo, req.query);
    return turnosDoPeriodo(ctx, req.usuario, f.inicio, f.fim);
  });

  app.get("/api/relatorios/:id", async (req, res) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const def = REGISTRO.find((r) => r.id === id);
    if (!def) return res.status(404).send({ codigo: "RELATORIO_NAO_ENCONTRADO", mensagem: "Relatório não encontrado.", detalhes: null });
    exigirPermissao(req.usuario, def.permissao);
    return def.gerar(ctx, analisar(def.filtros, req.query), req.usuario);
  });
}
