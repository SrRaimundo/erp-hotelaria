import type { Contexto } from "../shared/contexto.js";
import { noites, type Data } from "../shared/tempo.js";

export type Violacao = {
  codigo: "MIN_NOITES" | "FECHADO_CHEGADA" | "FECHADO_SAIDA" | "FECHADO_VENDA";
  data: Data;
  mensagem: string;
};

const dataBr = (d: Data) => d.split("-").reverse().join("/");

/** Mínimo de noites e fechado-para-chegada valem na data de chegada; fechado-para-saída na de saída; fechado-para-venda em qualquer noite. */
export async function verificarRestricoes(
  ctx: Contexto,
  categoriaId: string,
  chegada: Data,
  saida: Data,
): Promise<Violacao[]> {
  const ls = await ctx.db
    .selectFrom("restricoes")
    .selectAll()
    .where("categoria_id", "=", categoriaId)
    .where("data", ">=", chegada)
    .where("data", "<=", saida)
    .orderBy("data")
    .execute();
  const porData = new Map(ls.map((l) => [l.data, l]));
  const total = noites(chegada, saida).length;
  const v: Violacao[] = [];

  const c = porData.get(chegada);
  if (c?.min_noites != null && total < c.min_noites) {
    v.push({
      codigo: "MIN_NOITES", data: chegada,
      mensagem: `Para chegar em ${dataBr(chegada)} a estadia mínima é de ${c.min_noites} noites.`,
    });
  }
  if (c?.fechado_chegada) {
    v.push({ codigo: "FECHADO_CHEGADA", data: chegada, mensagem: `Não há chegadas em ${dataBr(chegada)} para esta categoria.` });
  }
  for (const d of noites(chegada, saida)) {
    if (porData.get(d)?.fechado_venda) {
      v.push({ codigo: "FECHADO_VENDA", data: d, mensagem: `A categoria está fechada para venda na noite de ${dataBr(d)}.` });
    }
  }
  if (porData.get(saida)?.fechado_saida) {
    v.push({ codigo: "FECHADO_SAIDA", data: saida, mensagem: `Não há saídas em ${dataBr(saida)} para esta categoria.` });
  }
  return v;
}
