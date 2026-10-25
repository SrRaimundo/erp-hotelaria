import { listarProdutos, type Produto } from "../nucleo/produtos.js";
import { obterConfig } from "../nucleo/pousada.js";
import type { Contexto } from "../shared/contexto.js";

export type Etapa = "limpeza" | "enxoval" | "equipamento" | "controles";
export type ItemChecklist = { id: string; etapa: Etapa; texto: string; ordem: number };
export type Modelos = {
  saida: ItemChecklist[];
  diaria: ItemChecklist[];
  produtosFrigobar: Produto[];
  camareiraLancaFrigobar: boolean;
};

const ORDEM_ETAPAS: Etapa[] = ["limpeza", "enxoval", "equipamento", "controles"];

async function itensDoModelo(ctx: Contexto, tipo: "saida" | "diaria"): Promise<ItemChecklist[]> {
  const ls = await ctx.db
    .selectFrom("checklist_itens as i")
    .innerJoin("checklist_modelos as m", "m.id", "i.modelo_id")
    .select(["i.id", "i.etapa", "i.texto", "i.ordem"])
    .where("m.tipo", "=", tipo)
    .where("i.ativo", "=", 1)
    .execute();
  return ls
    .map((l): ItemChecklist => ({ id: l.id, etapa: l.etapa, texto: l.texto, ordem: l.ordem }))
    .sort((a, b) => ORDEM_ETAPAS.indexOf(a.etapa) - ORDEM_ETAPAS.indexOf(b.etapa) || a.ordem - b.ordem);
}

export async function obterModelos(ctx: Contexto): Promise<Modelos> {
  return {
    saida: await itensDoModelo(ctx, "saida"),
    diaria: await itensDoModelo(ctx, "diaria"),
    produtosFrigobar: await listarProdutos(ctx, "frigobar"),
    camareiraLancaFrigobar: (await obterConfig(ctx)).camareiraLancaFrigobar,
  };
}
