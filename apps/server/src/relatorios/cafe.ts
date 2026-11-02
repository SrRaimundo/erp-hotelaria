import { dataOuHoje, filtroData, reservasParaRelatorio } from "./consulta.js";
import { dataBR } from "./formato.js";
import { definir } from "./modelo.js";

/** Quem dormiu na noite anterior à data: chegada < data <= saída, hospedadas ou confirmadas. */
export const relatorioCafe = definir({
  id: "cafe",
  permissao: "reservas.gerenciar",
  filtros: filtroData,
  gerar: async (ctx, f) => {
    const data = await dataOuHoje(ctx, f.data);
    const reservas = await reservasParaRelatorio(ctx, ["hospedada", "confirmada"], { chegadaAntes: data, saidaDepoisOuEm: data });
    const adultos = reservas.reduce((t, r) => t + r.adultos, 0);
    const criancas = reservas.reduce((t, r) => t + r.criancas, 0);
    return {
      id: "cafe",
      titulo: "Lista do café da manhã",
      subtitulo: `Café de ${dataBR(data)}`,
      geradoEm: ctx.relogio.agora().toISOString(),
      resumo: [
        { rotulo: "Quartos", valor: String(reservas.length) },
        { rotulo: "Adultos", valor: String(adultos) },
        { rotulo: "Crianças", valor: String(criancas) },
        { rotulo: "Pessoas", valor: String(adultos + criancas) },
      ],
      secoes: [{
        colunas: [
          { chave: "quarto", titulo: "Quarto", tipo: "texto" },
          { chave: "hospede", titulo: "Hóspede", tipo: "texto" },
          { chave: "adultos", titulo: "Adultos", tipo: "numero" },
          { chave: "criancas", titulo: "Crianças", tipo: "numero" },
        ],
        linhas: reservas.map((r) => ({ quarto: r.quarto, hospede: r.hospede, adultos: r.adultos, criancas: r.criancas })),
        totais: { adultos, criancas },
      }],
    };
  },
});
