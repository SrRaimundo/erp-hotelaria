import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../nucleo/permissoes.js";
import type { Contexto } from "../shared/contexto.js";
import { data, estadiaPermitida, MSG_ESTADIA_LONGA } from "../http/validacao.js";
import { cotar } from "./cotacao.js";
import {
  listarCanais, listarFaixasCrianca, listarFaixasOcupacao, listarPacotes, listarPercentuaisDiaSemana,
  listarRestricoes, listarTabelasBase, listarTemporadas, salvarCanal, salvarFaixasCrianca, salvarFaixasOcupacao,
  salvarPacote, salvarPercentualDiaSemana, salvarRestricao, salvarTabelaBase, salvarTemporada,
} from "./regras.js";

const centavos = z.number().int().min(0);
const percentual = z.number().gt(-100, "O percentual deve ser maior que −100"); // pode ser negativo (desconto)
const limite = z.number().min(0).max(100);
const texto = z.string().trim().min(1, "Campo obrigatório");
const porAdultos = z.object({ 1: centavos, 2: centavos, 3: centavos });
const tabela = z.object({ porAdultos, adultoExtra: centavos });

const corpoTabelaBase = z.object({
  categoriaId: texto, porAdultos, adultoExtra: centavos,
  piso: centavos.nullable().optional(), teto: centavos.nullable().optional(),
});
const corpoTemporada = z.object({
  id: z.string().optional(), nome: texto, inicio: data, fim: data, prioridade: z.number().int(),
  percentual: percentual.nullable().optional(),
  tabelas: z.array(tabela.extend({ categoriaId: texto })).optional(),
});
const corpoDia = z.object({ dia: z.number().int().min(0).max(6), percentual });
const corpoCanal = z.object({ id: z.string().optional(), nome: texto, percentual, exigeSinal: z.boolean() });
const corpoFaixasOcupacao = z.array(z.object({ acimaDe: limite, percentual }));
const corpoFaixasCrianca = z.array(
  z.object({
    idadeMin: z.number().int().min(0), idadeMax: z.number().int().min(0),
    tipo: z.enum(["gratis", "percentual_adicional", "fixo"]), valor: z.number().min(0),
  }),
);
const corpoPacote = z.object({
  id: z.string().optional(), nome: texto, categoriaId: texto, inicio: data, fim: data,
  minNoites: z.number().int().min(1), valorNoite: porAdultos, ativo: z.boolean(),
});
const corpoRestricao = z.object({
  categoriaId: texto, data, minNoites: z.number().int().min(1).nullable(),
  fechadoChegada: z.boolean(), fechadoSaida: z.boolean(), fechadoVenda: z.boolean(),
});
const corpoSimular = z.object({
  categoriaId: texto, chegada: data, saida: data,
  hospedes: z.object({ adultos: z.number().int().min(1), criancasNascimento: z.array(data).default([]) }),
  canal: texto, ignorarReservaId: z.string().optional(),
})
  .refine((p) => p.saida > p.chegada, { message: "A saída deve ser depois da chegada.", path: ["saida"] })
  .refine(estadiaPermitida, { message: MSG_ESTADIA_LONGA, path: ["saida"] });

export function registrarRotasTarifas(app: FastifyInstance, ctx: Contexto): void {
  const gerenciar = (req: { usuario: Parameters<typeof exigirPermissao>[0] }) => exigirPermissao(req.usuario, "tarifas.gerenciar");

  app.post("/api/tarifas/simular", async (req) => cotar(ctx, corpoSimular.parse(req.body)));

  app.get("/api/tarifas/tabelas-base", async (req) => { gerenciar(req); return listarTabelasBase(ctx); });
  app.put("/api/tarifas/tabelas-base", async (req) => {
    gerenciar(req);
    return salvarTabelaBase(ctx, corpoTabelaBase.parse(req.body), req.usuario.id);
  });

  app.get("/api/tarifas/temporadas", async (req) => { gerenciar(req); return listarTemporadas(ctx); });
  app.put("/api/tarifas/temporadas", async (req) => {
    gerenciar(req);
    return salvarTemporada(ctx, corpoTemporada.parse(req.body), req.usuario.id);
  });

  app.get("/api/tarifas/dias-semana", async (req) => { gerenciar(req); return listarPercentuaisDiaSemana(ctx); });
  app.put("/api/tarifas/dias-semana", async (req) => {
    gerenciar(req);
    return salvarPercentualDiaSemana(ctx, corpoDia.parse(req.body), req.usuario.id);
  });

  app.get("/api/tarifas/canais", async () => listarCanais(ctx)); // leitura: qualquer sessão
  app.put("/api/tarifas/canais", async (req) => {
    gerenciar(req);
    return salvarCanal(ctx, corpoCanal.parse(req.body), req.usuario.id);
  });

  app.get("/api/tarifas/faixas-ocupacao", async (req) => { gerenciar(req); return listarFaixasOcupacao(ctx); });
  app.put("/api/tarifas/faixas-ocupacao", async (req) => {
    gerenciar(req);
    return salvarFaixasOcupacao(ctx, corpoFaixasOcupacao.parse(req.body), req.usuario.id);
  });

  app.get("/api/tarifas/faixas-crianca", async (req) => { gerenciar(req); return listarFaixasCrianca(ctx); });
  app.put("/api/tarifas/faixas-crianca", async (req) => {
    gerenciar(req);
    return salvarFaixasCrianca(ctx, corpoFaixasCrianca.parse(req.body), req.usuario.id);
  });

  app.get("/api/tarifas/pacotes", async (req) => { gerenciar(req); return listarPacotes(ctx); });
  app.put("/api/tarifas/pacotes", async (req) => {
    gerenciar(req);
    return salvarPacote(ctx, corpoPacote.parse(req.body), req.usuario.id);
  });

  app.get("/api/tarifas/restricoes", async (req) => {
    gerenciar(req);
    const { categoriaId } = z.object({ categoriaId: z.string().optional() }).parse(req.query);
    return listarRestricoes(ctx, categoriaId);
  });
  app.put("/api/tarifas/restricoes", async (req) => {
    gerenciar(req);
    return salvarRestricao(ctx, corpoRestricao.parse(req.body), req.usuario.id);
  });
}
