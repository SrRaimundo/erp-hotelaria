import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../nucleo/permissoes.js";
import type { Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { relatorioCafe } from "./cafe.js";
import { relatorioCheckIn } from "./check-in.js";
import { relatorioCheckOut } from "./check-out.js";
import type { DefinicaoRelatorio } from "./modelo.js";
import { relatorioNaCasa } from "./na-casa.js";

/** Catálogo: um relatório novo é uma entrada aqui (id, permissão, filtros zod e gerar). */
export const REGISTRO: DefinicaoRelatorio[] = [relatorioCheckIn, relatorioCheckOut, relatorioNaCasa, relatorioCafe];

export function registrarRotasRelatorios(app: FastifyInstance, ctx: Contexto): void {
  app.get("/api/relatorios/:id", async (req, res) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const def = REGISTRO.find((r) => r.id === id);
    if (!def) return res.status(404).send({ codigo: "RELATORIO_NAO_ENCONTRADO", mensagem: "Relatório não encontrado.", detalhes: null });
    exigirPermissao(req.usuario, def.permissao);
    const filtros = def.filtros.safeParse(req.query);
    if (!filtros.success) {
      const campos = filtros.error.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message }));
      throw new ErroDominio("FILTRO_INVALIDO", campos.map((c) => c.mensagem).join(" "), campos);
    }
    return def.gerar(ctx, filtros.data, req.usuario);
  });
}
