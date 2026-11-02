import { z } from "zod";
import { listarFormas } from "../nucleo/formas-pagamento.js";
import type { UsuarioSessao } from "../nucleo/permissoes.js";
import type { Contexto } from "../shared/contexto.js";
import { formatarBRL } from "../shared/dinheiro.js";
import { ErroDominio } from "../shared/erros.js";
import { dataLocal, dataValida, horaLocal, somarDias, type Data } from "../shared/tempo.js";
import { obterConfig } from "../nucleo/pousada.js";
import { dataOuHoje } from "./consulta.js";
import { dataBR } from "./formato.js";
import { definir, type Relatorio } from "./modelo.js";

export type TurnoDoPeriodo = {
  id: string;
  operador: string;
  abertoEm: string;
  fechadoEm: string | null;
  situacao: "aberto" | "fechado";
  valorInicial: number;
};

/** Quem enxerga turnos de outros operadores. */
const veTodos = (u: UsuarioSessao) => u.permissoes.includes("config.gerenciar") || u.permissoes.includes("supervisor");

const dataIso = z.string().refine(dataValida, "Data inválida. Use AAAA-MM-DD.");
const vazioParaAusente = (v: unknown) => (v === "" ? undefined : v);

export const filtrosPeriodo = z
  .object({ inicio: z.preprocess(vazioParaAusente, dataIso.optional()), fim: z.preprocess(vazioParaAusente, dataIso.optional()) })
  .refine((f) => !f.inicio || !f.fim || f.inicio <= f.fim, "O início do período deve ser anterior ou igual ao fim.");

/** Turnos abertos no período (dia local da pousada, inclusive), só os do usuário, salvo supervisor ou config.gerenciar. */
export async function turnosDoPeriodo(ctx: Contexto, usuario: UsuarioSessao, inicio: Data | undefined, fim: Data | undefined): Promise<TurnoDoPeriodo[]> {
  const hoje = await dataOuHoje(ctx, undefined);
  const de = inicio ?? fim ?? hoje;
  const ate = fim ?? inicio ?? hoje;
  const { fuso } = await obterConfig(ctx);
  let qb = ctx.db
    .selectFrom("turnos_caixa as t")
    .innerJoin("usuarios as u", "u.id", "t.usuario_id")
    .select(["t.id", "u.nome as operador", "t.aberto_em", "t.fechado_em", "t.valor_inicial"])
    // folga de um dia para cada lado: o dia local pode divergir do dia UTC; o filtro exato é feito abaixo
    .where("t.aberto_em", ">=", `${somarDias(de, -1)}T00:00:00.000Z`)
    .where("t.aberto_em", "<", `${somarDias(ate, 2)}T00:00:00.000Z`)
    .orderBy("t.aberto_em")
    .orderBy("t.id");
  if (!veTodos(usuario)) qb = qb.where("t.usuario_id", "=", usuario.id);
  return (await qb.execute())
    .filter((t) => {
      const d = dataLocal(new Date(t.aberto_em), fuso);
      return d >= de && d <= ate;
    })
    .map((t) => ({
      id: t.id, operador: t.operador, abertoEm: t.aberto_em, fechadoEm: t.fechado_em,
      situacao: t.fechado_em ? "fechado" : "aberto", valorInicial: t.valor_inicial,
    }));
}

const NOME_ORIGEM: Record<string, string> = { pagamento: "Pagamento", estorno: "Estorno" };

async function detalheDoTurno(ctx: Contexto, usuario: UsuarioSessao, turnoId: string) {
  const t = await ctx.db
    .selectFrom("turnos_caixa as t")
    .innerJoin("usuarios as u", "u.id", "t.usuario_id")
    .select(["t.id", "t.usuario_id", "u.nome as operador", "t.aberto_em", "t.fechado_em", "t.valor_inicial", "t.contados"])
    .where("t.id", "=", turnoId)
    .executeTakeFirst();
  if (!t) throw new ErroDominio("TURNO_NAO_ENCONTRADO", "Turno de caixa não encontrado. Escolha outro turno.", { turnoId });
  if (t.usuario_id !== usuario.id && !veTodos(usuario)) {
    throw new ErroDominio("SEM_PERMISSAO", "Você não tem permissão para realizar esta ação.", { turnoId });
  }
  const movs = await ctx.db
    .selectFrom("movimentos_caixa")
    .select(["forma_codigo", "valor", "origem_tipo", "instante"])
    .where("turno_id", "=", turnoId)
    .orderBy("instante")
    .orderBy("id")
    .execute();
  return { t, movs };
}

export const relatorioCaixa = definir({
  id: "caixa",
  permissao: "caixa.operar",
  filtros: filtrosPeriodo.and(z.object({ turno: z.preprocess(vazioParaAusente, z.string().min(1).optional()) })),
  gerar: async (ctx, f, usuario): Promise<Relatorio> => {
    const hoje = await dataOuHoje(ctx, undefined);
    const inicio = f.inicio ?? f.fim ?? hoje;
    const fim = f.fim ?? f.inicio ?? hoje;
    const { fuso } = await obterConfig(ctx);
    const dh = (iso: string | null) => (iso ? { data: dataLocal(new Date(iso), fuso), hora: horaLocal(new Date(iso), fuso) } : { data: null, hora: null });
    const turnos = await turnosDoPeriodo(ctx, usuario, inicio, fim);
    const resumo = [{ rotulo: "Turnos no período", valor: String(turnos.length) }];
    const secoes: Relatorio["secoes"] = [{
      titulo: "Turnos do período",
      colunas: [
        { chave: "operador", titulo: "Operador", tipo: "texto" },
        { chave: "aberturaData", titulo: "Abertura", tipo: "data" },
        { chave: "aberturaHora", titulo: "Hora", tipo: "texto" },
        { chave: "fechamentoData", titulo: "Fechamento", tipo: "data" },
        { chave: "fechamentoHora", titulo: "Hora", tipo: "texto" },
        { chave: "situacao", titulo: "Situação", tipo: "texto" },
        { chave: "valorInicial", titulo: "Valor inicial", tipo: "dinheiro" },
      ],
      linhas: turnos.map((t) => ({
        operador: t.operador, aberturaData: dh(t.abertoEm).data, aberturaHora: dh(t.abertoEm).hora,
        fechamentoData: dh(t.fechadoEm).data, fechamentoHora: dh(t.fechadoEm).hora,
        situacao: t.situacao === "aberto" ? "Aberto" : "Fechado", valorInicial: t.valorInicial,
      })),
    }];

    if (f.turno) {
      const { t, movs } = await detalheDoTurno(ctx, usuario, f.turno);
      const nomes = new Map((await listarFormas(ctx, false)).map((x) => [x.codigo as string, x.nome]));
      const nomeForma = (c: string) => nomes.get(c) ?? c;
      // O turno guarda só os valores contados; o esperado é recalculado dos movimentos (como no fechamento).
      const esperado: Record<string, number> = { dinheiro: t.valor_inicial };
      for (const m of movs) esperado[m.forma_codigo] = (esperado[m.forma_codigo] ?? 0) + m.valor;
      const fechado = t.fechado_em !== null;
      const contados: Record<string, number> = t.contados ? JSON.parse(t.contados) : {};
      const formas = [...new Set([...Object.keys(esperado), ...(fechado ? Object.keys(contados) : [])])];
      const porForma = formas.map((forma) => {
        const e = esperado[forma] ?? 0;
        const c = fechado ? (contados[forma] ?? 0) : null;
        return { forma, esperado: e, contado: c, diferenca: c === null ? null : c - e };
      });
      const soma = (k: "esperado" | "contado" | "diferenca") => porForma.reduce((s, x) => s + (x[k] ?? 0), 0);
      const ab = dh(t.aberto_em), fe = dh(t.fechado_em);
      resumo.push(
        { rotulo: "Operador", valor: t.operador },
        { rotulo: "Abertura", valor: `${dataBR(ab.data!)} ${ab.hora}` },
        { rotulo: "Fechamento", valor: fe.data ? `${dataBR(fe.data)} ${fe.hora}` : "Em aberto" },
        { rotulo: "Esperado", valor: formatarBRL(soma("esperado")) },
      );
      if (fechado) resumo.push({ rotulo: "Contado", valor: formatarBRL(soma("contado")) }, { rotulo: "Diferença", valor: formatarBRL(soma("diferenca")) });
      secoes.push(
        {
          titulo: `Fechamento por forma: ${t.operador}`,
          colunas: [
            { chave: "forma", titulo: "Forma", tipo: "texto" },
            { chave: "esperado", titulo: "Esperado", tipo: "dinheiro" },
            { chave: "contado", titulo: "Contado", tipo: "dinheiro" },
            { chave: "diferenca", titulo: "Diferença", tipo: "dinheiro" },
          ],
          linhas: porForma.map((x) => ({ forma: nomeForma(x.forma), esperado: x.esperado, contado: x.contado, diferenca: x.diferenca })),
          totais: fechado ? { esperado: soma("esperado"), contado: soma("contado"), diferenca: soma("diferenca") } : { esperado: soma("esperado") },
        },
        {
          titulo: "Movimentos",
          colunas: [
            { chave: "data", titulo: "Data", tipo: "data" },
            { chave: "hora", titulo: "Hora", tipo: "texto" },
            { chave: "forma", titulo: "Forma", tipo: "texto" },
            { chave: "origem", titulo: "Origem", tipo: "texto" },
            { chave: "valor", titulo: "Valor", tipo: "dinheiro" },
          ],
          linhas: movs.map((m) => ({
            data: dh(m.instante).data, hora: dh(m.instante).hora, forma: nomeForma(m.forma_codigo), origem: NOME_ORIGEM[m.origem_tipo] ?? m.origem_tipo, valor: m.valor,
          })),
          totais: { valor: movs.reduce((s, m) => s + m.valor, 0) },
        },
      );
    }
    return {
      id: "caixa",
      titulo: "Fechamento de caixa",
      subtitulo: inicio === fim ? `Dia ${dataBR(inicio)}` : `De ${dataBR(inicio)} a ${dataBR(fim)}`,
      geradoEm: ctx.relogio.agora().toISOString(),
      resumo,
      secoes,
    };
  },
});
