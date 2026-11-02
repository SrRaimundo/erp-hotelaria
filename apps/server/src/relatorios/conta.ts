import { z } from "zod";
import { extrato, saldo } from "../hospedagem/conta.js";
import type { EstadoReserva } from "../hospedagem/estados.js";
import { formatarBRL } from "../shared/dinheiro.js";
import { ErroDominio } from "../shared/erros.js";
import { reservasParaRelatorio, rotuloEstado } from "./consulta.js";
import { definir } from "./modelo.js";

const TODOS: EstadoReserva[] = ["pre_reserva", "confirmada", "hospedada", "finalizada", "cancelada", "no_show"];

/** Conta de uma reserva (qualquer estado: a conta de uma estadia cancelada também pode ser conferida). */
export const relatorioConta = definir({
  id: "conta",
  permissao: "reservas.gerenciar",
  filtros: z.object({ reserva: z.string({ error: "Informe a reserva." }).min(1, "Informe a reserva.") }),
  gerar: async (ctx, f) => {
    const [r] = await reservasParaRelatorio(ctx, TODOS, { reservaId: f.reserva });
    if (!r) throw new ErroDominio("RESERVA_NAO_ENCONTRADA", "Reserva não encontrada. Confira o número informado.", { id: f.reserva });
    const linhas = await extrato(ctx, r.contaId);
    const total = await saldo(ctx, r.contaId);
    return {
      id: "conta",
      titulo: "Conta do hóspede",
      subtitulo: `Reserva #${r.codigo} · ${r.hospede}`,
      geradoEm: ctx.relogio.agora().toISOString(),
      resumo: [
        { rotulo: "Débitos", valor: formatarBRL(total.debitos) },
        { rotulo: "Créditos", valor: formatarBRL(total.creditos) },
        { rotulo: "Saldo", valor: formatarBRL(total.saldo) },
      ],
      secoes: [
        {
          titulo: "Estadia",
          colunas: [
            { chave: "codigo", titulo: "Reserva", tipo: "numero" },
            { chave: "hospede", titulo: "Hóspede", tipo: "texto" },
            { chave: "quarto", titulo: "Quarto", tipo: "texto" },
            { chave: "categoria", titulo: "Categoria", tipo: "texto" },
            { chave: "chegada", titulo: "Chegada", tipo: "data" },
            { chave: "saida", titulo: "Saída", tipo: "data" },
            { chave: "noites", titulo: "Noites", tipo: "numero" },
            { chave: "pessoas", titulo: "Pessoas", tipo: "numero" },
            { chave: "situacao", titulo: "Situação", tipo: "texto" },
          ],
          linhas: [{
            codigo: r.codigo, hospede: r.hospede, quarto: r.quarto, categoria: r.categoria, chegada: r.chegada, saida: r.saida,
            noites: r.noites, pessoas: r.adultos + r.criancas, situacao: rotuloEstado(r.estado),
          }],
        },
        {
          titulo: "Extrato",
          colunas: [
            { chave: "data", titulo: "Data", tipo: "data" },
            { chave: "descricao", titulo: "Descrição", tipo: "texto" },
            { chave: "debito", titulo: "Débito", tipo: "dinheiro" },
            { chave: "credito", titulo: "Crédito", tipo: "dinheiro" },
          ],
          linhas: linhas.map((l) => ({
            data: l.data,
            descricao: l.estornaId ? `Estorno: ${l.descricao}` : l.descricao,
            debito: l.natureza === "debito" ? l.valor : null,
            credito: l.natureza === "credito" ? l.valor : null,
          })),
          totais: { debito: total.debitos, credito: total.creditos },
        },
      ],
    };
  },
});
