import { z } from "zod";
import { dataOuHoje, reservasParaRelatorio } from "./consulta.js";
import { dataBR } from "./formato.js";
import { definir } from "./modelo.js";

export const relatorioNaCasa = definir({
  id: "na-casa",
  permissao: "reservas.gerenciar",
  filtros: z.object({}),
  gerar: async (ctx) => {
    const reservas = await reservasParaRelatorio(ctx, ["hospedada"], {});
    const adultos = reservas.reduce((t, r) => t + r.adultos, 0);
    const criancas = reservas.reduce((t, r) => t + r.criancas, 0);
    const agora = ctx.relogio.agora();
    return {
      id: "na-casa",
      titulo: "Hóspedes na casa",
      subtitulo: `Situação em ${dataBR(await dataOuHoje(ctx, undefined))}`,
      geradoEm: agora.toISOString(),
      resumo: [
        { rotulo: "Quartos", valor: String(reservas.length) },
        { rotulo: "Pessoas", valor: String(adultos + criancas) },
      ],
      secoes: [{
        colunas: [
          { chave: "quarto", titulo: "Quarto", tipo: "texto" },
          { chave: "hospede", titulo: "Hóspede", tipo: "texto" },
          { chave: "telefone", titulo: "Telefone", tipo: "texto" },
          { chave: "entrada", titulo: "Entrada", tipo: "data" },
          { chave: "saida", titulo: "Saída", tipo: "data" },
          { chave: "adultos", titulo: "Adultos", tipo: "numero" },
          { chave: "criancas", titulo: "Crianças", tipo: "numero" },
        ],
        linhas: reservas.map((r) => ({
          quarto: r.quarto, hospede: r.hospede, telefone: r.telefone, entrada: r.chegada, saida: r.saida, adultos: r.adultos, criancas: r.criancas,
        })),
        totais: { adultos, criancas },
      }],
    };
  },
});
