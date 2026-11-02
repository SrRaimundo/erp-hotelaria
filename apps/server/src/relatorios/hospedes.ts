import { z } from "zod";
import { auditar } from "../infra/auditoria.js";
import { buscarHospedes } from "../nucleo/hospedes.js";
import { emTransacao } from "../shared/contexto.js";
import { definir } from "./modelo.js";

/** Cadastro de hóspedes com dados pessoais: cada geração fica na auditoria (quem, se houve filtro e quantas linhas; nunca o termo buscado). */
export const relatorioHospedes = definir({
  id: "hospedes",
  permissao: "reservas.gerenciar",
  filtros: z.object({ busca: z.string().trim().max(100, "A busca aceita até 100 caracteres.").optional() }),
  gerar: async (ctx, f, usuario) => {
    const busca = f.busca || undefined;
    const hospedes = busca
      ? await buscarHospedes(ctx, busca)
      : (await ctx.db.selectFrom("hospedes").selectAll().orderBy("nome_busca").orderBy("id").execute()).map((l) => ({
          id: l.id, nome: l.nome, documento: l.documento, telefone: l.telefone ?? undefined, email: l.email ?? undefined,
        }));
    const estadias = await ctx.db
      .selectFrom("reservas")
      .select(["titular_id", (eb) => eb.fn.countAll<number>().as("n"), (eb) => eb.fn.max("saida").as("ultima")])
      .where("estado", "=", "finalizada")
      .groupBy("titular_id")
      .execute();
    const porHospede = new Map(estadias.map((e) => [e.titular_id, { n: Number(e.n), ultima: e.ultima as string }]));
    const linhas = hospedes.map((h) => ({
      nome: h.nome,
      documento: h.documento ?? null,
      telefone: h.telefone ?? null,
      email: h.email ?? null,
      estadias: porHospede.get(h.id)?.n ?? 0,
      ultimaSaida: porHospede.get(h.id)?.ultima ?? null,
    }));
    await emTransacao(ctx, (tx) =>
      auditar(tx, { ator: usuario.id, acao: "relatorio.hospedes", alvoTipo: "relatorio", alvoId: "hospedes", dados: { comFiltro: busca !== undefined, total: linhas.length } }),
    );
    return {
      id: "hospedes",
      titulo: "Hóspedes cadastrados",
      subtitulo: busca ? `Busca: ${busca}` : "Todos os hóspedes",
      geradoEm: ctx.relogio.agora().toISOString(),
      resumo: [{ rotulo: "Hóspedes", valor: String(linhas.length) }],
      secoes: [{
        colunas: [
          { chave: "nome", titulo: "Nome", tipo: "texto" },
          { chave: "documento", titulo: "Documento", tipo: "texto" },
          { chave: "telefone", titulo: "Telefone", tipo: "texto" },
          { chave: "email", titulo: "E-mail", tipo: "texto" },
          { chave: "estadias", titulo: "Estadias", tipo: "numero" },
          { chave: "ultimaSaida", titulo: "Última saída", tipo: "data" },
        ],
        linhas,
      }],
    };
  },
});
