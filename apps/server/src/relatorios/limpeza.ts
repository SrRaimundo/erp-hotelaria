import { z } from "zod";
import { listaGovernanca } from "../hospedagem/governanca.js";
import type { SituacaoQuarto } from "../nucleo/quartos.js";
import { dataOuHoje } from "./consulta.js";
import { dataBR } from "./formato.js";
import { definir } from "./modelo.js";

const SITUACAO: Record<SituacaoQuarto, string> = {
  livre: "Livre", ocupado: "Ocupado", sujo: "Sujo", em_manutencao: "Em manutenção", bloqueado: "Bloqueado",
};

/** Lista de trabalho da governança de hoje: quartos a limpar, a arrumar e fora de uso. */
export const relatorioLimpeza = definir({
  id: "limpeza",
  permissao: "reservas.gerenciar",
  filtros: z.object({}),
  gerar: async (ctx) => {
    const itens = (await listaGovernanca(ctx)).filter((i) => i.tarefa || i.situacao === "em_manutencao" || i.situacao === "bloqueado");
    const hoje = await dataOuHoje(ctx, undefined);
    return {
      id: "limpeza",
      titulo: "Limpeza dos apartamentos",
      subtitulo: `Governança de ${dataBR(hoje)}`,
      geradoEm: ctx.relogio.agora().toISOString(),
      resumo: [
        { rotulo: "Limpezas de saída", valor: String(itens.filter((i) => i.tarefa === "limpeza_saida").length) },
        { rotulo: "Arrumações", valor: String(itens.filter((i) => i.tarefa === "arrumacao").length) },
        { rotulo: "Fora de uso", valor: String(itens.filter((i) => i.situacao === "em_manutencao" || i.situacao === "bloqueado").length) },
      ],
      secoes: [{
        colunas: [
          { chave: "quarto", titulo: "Quarto", tipo: "texto" },
          { chave: "situacao", titulo: "Situação", tipo: "texto" },
          { chave: "servico", titulo: "Serviço", tipo: "texto" },
          { chave: "hospedadoAte", titulo: "Hospedado até", tipo: "data" },
          { chave: "motivo", titulo: "Motivo", tipo: "texto" },
          { chave: "feito", titulo: "Feito", tipo: "em-branco" },
          { chave: "camareira", titulo: "Camareira", tipo: "em-branco" },
        ],
        linhas: itens.map((i) => ({
          quarto: i.numero,
          situacao: SITUACAO[i.situacao],
          servico: i.tarefa === "limpeza_saida" ? "Limpeza de saída" : i.tarefa === "arrumacao" ? "Arrumação" : null,
          hospedadoAte: i.hospedadoAte ?? null,
          motivo: i.motivoBloqueio,
          feito: null,
          camareira: null,
        })),
      }],
    };
  },
});
