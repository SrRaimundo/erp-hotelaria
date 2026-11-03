import { z } from "zod";
import { obterConfig } from "../nucleo/pousada.js";
import type { Contexto } from "../shared/contexto.js";
import { formatarBRL } from "../shared/dinheiro.js";
import { calcularComissao } from "../tarifas/comissao.js";
import { diaHoteleiro, diasEntre, somarDias, type Data } from "../shared/tempo.js";
import { filtrosPeriodo } from "./caixa.js";
import { dataBR } from "./formato.js";
import { definir, type Relatorio, type Secao } from "./modelo.js";

export const SEM_CANAL = "Sem canal";

/** Estados que ocupam noites e geram receita; cancelada e no_show só entram nas colunas próprias. */
export const VENDIDAS = ["pre_reserva", "confirmada", "hospedada", "finalizada"] as const;

const nomeDoCanal = (c: string | null | undefined) => c?.trim() || SEM_CANAL;
const pct = (parte: number, total: number) => (total > 0 ? `${((parte / total) * 100).toFixed(1).replace(".", ",")}%` : "0,0%");
const porNome = (a: string, b: string) => a.localeCompare(b, "pt-BR");

/** Período pedido; sem datas vale o mês atual do dia hoteleiro. Só o início (ou só o fim) vale um dia, como no caixa. */
export async function periodoDoMes(ctx: Contexto, f: { inicio?: Data; fim?: Data }): Promise<{ de: Data; ate: Data }> {
  if (f.inicio || f.fim) return { de: f.inicio ?? f.fim!, ate: f.fim ?? f.inicio! };
  const config = await obterConfig(ctx);
  const hoje = diaHoteleiro(ctx.relogio.agora(), config.fuso, config.viradaDia);
  const de = `${hoje.slice(0, 8)}01`;
  const [a, m] = hoje.split("-").map(Number);
  const proximo = m === 12 ? `${a! + 1}-01-01` : `${a}-${String(m! + 1).padStart(2, "0")}-01`;
  return { de, ate: somarDias(proximo, -1) };
}

type Acumulado = { reservas: number; noites: number; receita: number; comissao: number; cancelamentos: number; noShows: number };

const ROTULO_TIPO: Record<string, string> = { direta: "Direta", ota: "OTA", agencia: "Agência", passante: "Passante" };
const SEM_TIPO = "—";

export const relatorioCanais = definir({
  id: "canais",
  permissao: "reservas.gerenciar",
  filtros: filtrosPeriodo.and(z.object({})),
  gerar: async (ctx, f): Promise<Relatorio> => {
    const { de, ate } = await periodoDoMes(ctx, f);

    // (a) Hospedados agora: um quarto por reserva hospedada.
    const hospedadas = await ctx.db.selectFrom("reservas").select(["canal", "adultos", "criancas"]).where("estado", "=", "hospedada").execute();
    const agora = new Map<string, { quartos: number; pessoas: number }>();
    for (const h of hospedadas) {
      const a = agora.get(nomeDoCanal(h.canal)) ?? { quartos: 0, pessoas: 0 };
      a.quartos += 1;
      a.pessoas += h.adultos + (JSON.parse(h.criancas) as unknown[]).length;
      agora.set(nomeDoCanal(h.canal), a);
    }
    const linhasAgora = [...agora].sort((a, b) => b[1].quartos - a[1].quartos || porNome(a[0], b[0]));
    const totalQuartos = hospedadas.length;
    const totalPessoas = linhasAgora.reduce((t, [, x]) => t + x.pessoas, 0);

    // (b) No período: estadia que se sobrepõe ao período (chegada <= fim e saída > início).
    const reservas = await ctx.db
      .selectFrom("reservas")
      .select(["id", "canal", "estado", "chegada", "saida", "comissao_percentual"])
      .where("chegada", "<=", ate)
      .where("saida", ">", de)
      .execute();
    const noitesDaReserva = await ctx.db
      .selectFrom("reserva_noites as n")
      .innerJoin("reservas as r", "r.id", "n.reserva_id")
      .select(["r.id as reservaId", "n.valor"])
      .where("n.data", ">=", de)
      .where("n.data", "<=", ate)
      .where("r.chegada", "<=", ate)
      .where("r.saida", ">", de)
      .where("r.estado", "in", [...VENDIDAS])
      .execute();
    const receitaPorReserva = new Map<string, number>();
    for (const n of noitesDaReserva) receitaPorReserva.set(n.reservaId, (receitaPorReserva.get(n.reservaId) ?? 0) + n.valor);

    const tipos = new Map((await ctx.db.selectFrom("canais").select(["nome", "tipo"]).execute()).map((c) => [c.nome, ROTULO_TIPO[c.tipo] ?? c.tipo]));

    const periodo = new Map<string, Acumulado>();
    const fim1 = somarDias(ate, 1);
    for (const r of reservas) {
      const c = nomeDoCanal(r.canal);
      const a = periodo.get(c) ?? { reservas: 0, noites: 0, receita: 0, comissao: 0, cancelamentos: 0, noShows: 0 };
      periodo.set(c, a);
      if (r.estado === "cancelada") a.cancelamentos += 1;
      else if (r.estado === "no_show") a.noShows += 1;
      else {
        a.reservas += 1;
        // só as noites dentro do período: de max(chegada, início) até min(saída, fim + 1), saída exclusiva
        a.noites += Math.max(0, diasEntre(r.chegada > de ? r.chegada : de, r.saida < fim1 ? r.saida : fim1));
        const receita = receitaPorReserva.get(r.id) ?? 0;
        a.receita += receita;
        // comissão guardada na reserva sobre a receita de hospedagem das noites do período, por reserva e em centavos inteiros
        a.comissao += calcularComissao(receita, r.comissao_percentual);
      }
    }
    const linhasPeriodo = [...periodo].sort((a, b) => b[1].noites - a[1].noites || b[1].reservas - a[1].reservas || porNome(a[0], b[0]));
    const soma = (k: keyof Acumulado) => linhasPeriodo.reduce((t, [, x]) => t + x[k], 0);
    const totalNoites = soma("noites");
    const liquida = (x: Acumulado) => x.receita - x.comissao;
    const comissaoPorTipo = new Map<string, number>();
    for (const [canal, x] of linhasPeriodo) {
      const t = tipos.get(canal) ?? SEM_TIPO;
      comissaoPorTipo.set(t, (comissaoPorTipo.get(t) ?? 0) + x.comissao);
    }

    const secaoAgora: Secao = {
      titulo: "Hospedados agora",
      colunas: [
        { chave: "canal", titulo: "Canal", tipo: "texto" },
        { chave: "quartos", titulo: "Quartos", tipo: "numero" },
        { chave: "pessoas", titulo: "Pessoas", tipo: "numero" },
        { chave: "pct", titulo: "% dos quartos", tipo: "numero" },
      ],
      linhas: linhasAgora.map(([canal, x]) => ({ canal, quartos: x.quartos, pessoas: x.pessoas, pct: pct(x.quartos, totalQuartos) })),
      totais: { quartos: totalQuartos, pessoas: totalPessoas, pct: totalQuartos > 0 ? "100,0%" : "0,0%" },
    };
    const secaoPeriodo: Secao = {
      titulo: "No período",
      colunas: [
        { chave: "canal", titulo: "Canal", tipo: "texto" },
        { chave: "reservas", titulo: "Reservas", tipo: "numero" },
        { chave: "noites", titulo: "Noites", tipo: "numero" },
        { chave: "tipo", titulo: "Tipo", tipo: "texto" },
        { chave: "receita", titulo: "Receita de hospedagem", tipo: "dinheiro" },
        { chave: "comissao", titulo: "Comissão", tipo: "dinheiro" },
        { chave: "liquida", titulo: "Receita líquida", tipo: "dinheiro" },
        { chave: "cancelamentos", titulo: "Cancelamentos", tipo: "numero" },
        { chave: "noShows", titulo: "No-shows", tipo: "numero" },
        { chave: "pct", titulo: "% das noites", tipo: "numero" },
      ],
      linhas: linhasPeriodo.map(([canal, x]) => ({ canal, tipo: tipos.get(canal) ?? SEM_TIPO, ...x, liquida: liquida(x), pct: pct(x.noites, totalNoites) })),
      totais: {
        reservas: soma("reservas"), noites: totalNoites, receita: soma("receita"), comissao: soma("comissao"), liquida: soma("receita") - soma("comissao"), cancelamentos: soma("cancelamentos"), noShows: soma("noShows"),
        pct: totalNoites > 0 ? "100,0%" : "0,0%",
      },
    };

    return {
      id: "canais",
      titulo: "Reservas por canal",
      subtitulo: `Período de ${dataBR(de)} a ${dataBR(ate)}`,
      geradoEm: ctx.relogio.agora().toISOString(),
      resumo: [
        { rotulo: "Hospedados agora", valor: `${totalQuartos} ${totalQuartos === 1 ? "quarto" : "quartos"}` },
        { rotulo: "Reservas no período", valor: String(soma("reservas")) },
        { rotulo: "Noites", valor: String(totalNoites) },
        { rotulo: "Receita de hospedagem", valor: formatarBRL(soma("receita")) },
        { rotulo: "Comissão", valor: formatarBRL(soma("comissao")) },
        { rotulo: "Receita líquida", valor: formatarBRL(soma("receita") - soma("comissao")) },
        ...[...comissaoPorTipo].sort((a, b) => porNome(a[0], b[0])).map(([t, v]) => ({ rotulo: `Comissão (${t})`, valor: formatarBRL(v) })),
      ],
      secoes: [secaoAgora, secaoPeriodo],
    };
  },
});
