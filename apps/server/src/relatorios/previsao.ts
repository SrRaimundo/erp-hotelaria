import { z } from "zod";
import { formatarBRL } from "../shared/dinheiro.js";
import { dataValida, diaDaSemana, noites, somarDias } from "../shared/tempo.js";
import { VENDIDAS } from "./canais.js";
import { dataOuHoje } from "./consulta.js";
import { dataBR, percentual } from "./formato.js";
import { definir, type Relatorio } from "./modelo.js";

export const MAX_DIAS_PREVISAO = 90;
const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const vazioParaAusente = (v: unknown) => (v === "" ? undefined : v);

const filtrosPrevisao = z.object({
  inicio: z.preprocess(vazioParaAusente, z.string().refine(dataValida, "Data inválida. Use AAAA-MM-DD.").optional()),
  dias: z.preprocess(
    vazioParaAusente,
    z.coerce
      .number({ error: "Informe a quantidade de dias." })
      .int("Informe um número inteiro de dias.")
      .min(1, "Informe ao menos 1 dia.")
      .max(MAX_DIAS_PREVISAO, `A previsão vai até ${MAX_DIAS_PREVISAO} dias.`)
      .optional(),
  ),
});

export const relatorioPrevisao = definir({
  id: "previsao",
  permissao: "reservas.gerenciar",
  filtros: filtrosPrevisao,
  gerar: async (ctx, f): Promise<Relatorio> => {
    const inicio = await dataOuHoje(ctx, f.inicio);
    const dias = f.dias ?? 14;
    const fim = somarDias(inicio, dias - 1);
    const datas = noites(inicio, somarDias(fim, 1));

    // Inventário: quartos ativos hoje. Bloqueio e manutenção são só a situação atual do quarto (sem data), então não são descontados de nenhum dia.
    const disponiveis = Number((await ctx.db.selectFrom("quartos").select((eb) => eb.fn.countAll().as("n")).where("ativo", "=", 1).executeTakeFirstOrThrow()).n);

    // Pré-reservas, confirmadas, hospedadas e finalizadas; cancelada e no-show ficam de fora.
    const nts = await ctx.db
      .selectFrom("reserva_noites as n")
      .innerJoin("reservas as r", "r.id", "n.reserva_id")
      .select(["n.data", "n.valor"])
      .where("n.data", ">=", inicio)
      .where("n.data", "<=", fim)
      .where("r.estado", "in", [...VENDIDAS])
      .execute();
    const reservas = await ctx.db
      .selectFrom("reservas")
      .select(["chegada", "saida"])
      .where("estado", "in", [...VENDIDAS])
      .where((eb) => eb.or([eb.and([eb("chegada", ">=", inicio), eb("chegada", "<=", fim)]), eb.and([eb("saida", ">=", inicio), eb("saida", "<=", fim)])]))
      .execute();

    const linhas = datas.map((data) => {
      const doDia = nts.filter((n) => n.data === data);
      const ocupados = doDia.length;
      return {
        data, semana: SEMANA[diaDaSemana(data)]!, disponiveis, ocupados, livres: Math.max(0, disponiveis - ocupados), ocupacao: percentual(ocupados, disponiveis),
        chegadas: reservas.filter((r) => r.chegada === data).length, saidas: reservas.filter((r) => r.saida === data).length,
        receita: doDia.reduce((t, n) => t + n.valor, 0),
      };
    });
    const soma = (k: "ocupados" | "disponiveis" | "chegadas" | "saidas" | "receita") => linhas.reduce((t, l) => t + l[k], 0);
    const pico = linhas.reduce((m, l) => (l.ocupados > m.ocupados ? l : m), linhas[0]!);

    return {
      id: "previsao",
      titulo: "Previsão de ocupação",
      subtitulo: `De ${dataBR(inicio)} a ${dataBR(fim)} (${dias} ${dias === 1 ? "dia" : "dias"}) · inclui pré-reservas e confirmadas · quartos ativos; bloqueio e manutenção não são descontados (não têm data)`,
      geradoEm: ctx.relogio.agora().toISOString(),
      resumo: [
        { rotulo: "Ocupação média", valor: percentual(soma("ocupados"), soma("disponiveis")) },
        { rotulo: "Maior ocupação", valor: `${percentual(pico.ocupados, pico.disponiveis)} em ${dataBR(pico.data)}` },
        { rotulo: "Chegadas", valor: String(soma("chegadas")) },
        { rotulo: "Saídas", valor: String(soma("saidas")) },
        { rotulo: "Receita prevista", valor: formatarBRL(soma("receita")) },
      ],
      secoes: [{
        colunas: [
          { chave: "data", titulo: "Dia", tipo: "data" },
          { chave: "semana", titulo: "Dia da semana", tipo: "texto" },
          { chave: "disponiveis", titulo: "Quartos disponíveis", tipo: "numero" },
          { chave: "ocupados", titulo: "Ocupados", tipo: "numero" },
          { chave: "livres", titulo: "Livres", tipo: "numero" },
          { chave: "ocupacao", titulo: "Ocupação", tipo: "numero" },
          { chave: "chegadas", titulo: "Chegadas", tipo: "numero" },
          { chave: "saidas", titulo: "Saídas", tipo: "numero" },
          { chave: "receita", titulo: "Receita prevista", tipo: "dinheiro" },
        ],
        linhas,
        totais: { ocupados: soma("ocupados"), chegadas: soma("chegadas"), saidas: soma("saidas"), receita: soma("receita"), ocupacao: percentual(soma("ocupados"), soma("disponiveis")) },
      }],
    };
  },
});
