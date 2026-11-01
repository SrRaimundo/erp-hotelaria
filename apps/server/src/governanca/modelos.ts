import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { listarProdutos, type Produto } from "../nucleo/produtos.js";
import { obterConfig } from "../nucleo/pousada.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";

export type Etapa = "limpeza" | "enxoval" | "equipamento" | "controles";
export type ItemChecklist = { id: string; etapa: Etapa; texto: string; ordem: number };
export type Modelos = {
  saida: ItemChecklist[];
  diaria: ItemChecklist[];
  produtosFrigobar: Produto[];
  camareiraLancaFrigobar: boolean;
};

export const ORDEM_ETAPAS: Etapa[] = ["limpeza", "enxoval", "equipamento", "controles"];

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
    .sort((a, b) => ORDEM_ETAPAS.indexOf(a.etapa) - ORDEM_ETAPAS.indexOf(b.etapa) || a.ordem - b.ordem || a.id.localeCompare(b.id));
}

export async function obterModelos(ctx: Contexto): Promise<Modelos> {
  return {
    saida: await itensDoModelo(ctx, "saida"),
    diaria: await itensDoModelo(ctx, "diaria"),
    produtosFrigobar: await listarProdutos(ctx, "frigobar"),
    camareiraLancaFrigobar: (await obterConfig(ctx)).camareiraLancaFrigobar,
  };
}

export type ItemAdmin = ItemChecklist & { ativo: boolean };
type Tipo = "saida" | "diaria";

const MAX_TEXTO_ITEM = 120;
const TIPOS: Tipo[] = ["saida", "diaria"];

function validarTipo(tipo: unknown): asserts tipo is Tipo {
  if (!TIPOS.includes(tipo as Tipo)) throw new ErroDominio("TIPO_INVALIDO", "Tipo de checklist inválido. Use saída ou diária.");
}

function textoValido(texto: unknown): string {
  const t = typeof texto === "string" ? texto.trim() : "";
  if (t === "") throw new ErroDominio("TEXTO_INVALIDO", "Informe o texto do item.");
  if (t.length > MAX_TEXTO_ITEM) throw new ErroDominio("TEXTO_INVALIDO", `O texto do item pode ter no máximo ${MAX_TEXTO_ITEM} caracteres.`);
  return t;
}

const comoItem = (l: { id: string; etapa: Etapa; texto: string; ordem: number; ativo: number }): ItemAdmin => ({ id: l.id, etapa: l.etapa, texto: l.texto, ordem: l.ordem, ativo: l.ativo === 1 });

/** Todos os itens do modelo, inclusive os desativados, na ordem de uso (etapa e depois `ordem`). */
export async function listarItensAdmin(ctx: Contexto, tipo: Tipo): Promise<ItemAdmin[]> {
  validarTipo(tipo);
  const ls = await ctx.db
    .selectFrom("checklist_itens as i")
    .innerJoin("checklist_modelos as m", "m.id", "i.modelo_id")
    .select(["i.id", "i.etapa", "i.texto", "i.ordem", "i.ativo"])
    .where("m.tipo", "=", tipo)
    .execute();
  return ls.map(comoItem).sort((a, b) => ORDEM_ETAPAS.indexOf(a.etapa) - ORDEM_ETAPAS.indexOf(b.etapa) || a.ordem - b.ordem || a.id.localeCompare(b.id));
}

async function itemOuErro(tx: Contexto, id: string) {
  const l = await tx.db.selectFrom("checklist_itens").select(["id", "modelo_id", "etapa", "texto", "ordem", "ativo"]).where("id", "=", id).executeTakeFirst();
  if (!l) throw new ErroDominio("ITEM_NAO_ENCONTRADO", "Item de checklist não encontrado.");
  return l;
}

/** O item novo vai para o fim da etapa. */
export async function criarItem(ctx: Contexto, d: { tipo: Tipo; etapa: Etapa; texto: string }, ator: string): Promise<ItemAdmin> {
  validarTipo(d.tipo);
  if (!ORDEM_ETAPAS.includes(d.etapa)) throw new ErroDominio("ETAPA_INVALIDA", "Etapa inválida.");
  const texto = textoValido(d.texto);
  return emTransacao(ctx, async (tx) => {
    const modelo = await tx.db.selectFrom("checklist_modelos").select("id").where("tipo", "=", d.tipo).executeTakeFirstOrThrow();
    const max = await tx.db.selectFrom("checklist_itens").select((eb) => eb.fn.max<number>("ordem").as("m")).where("modelo_id", "=", modelo.id).executeTakeFirst();
    const item: ItemAdmin = { id: novoId(), etapa: d.etapa, texto, ordem: Number(max?.m ?? 0) + 1, ativo: true };
    await tx.db.insertInto("checklist_itens").values({ id: item.id, modelo_id: modelo.id, etapa: item.etapa, texto, ordem: item.ordem, ativo: 1 }).execute();
    await auditar(tx, { ator, acao: "checklist_item.criar", alvoTipo: "checklist_item", alvoId: item.id, dados: { tipo: d.tipo, etapa: item.etapa, texto } });
    await registrarEvento(tx, "governanca.ChecklistItemCriado", { itemId: item.id, tipo: d.tipo });
    return item;
  });
}

export async function editarItem(ctx: Contexto, id: string, d: { texto?: string; ativo?: boolean }, ator: string): Promise<ItemAdmin> {
  const texto = d.texto === undefined ? undefined : textoValido(d.texto);
  return emTransacao(ctx, async (tx) => {
    const antes = await itemOuErro(tx, id);
    if (texto !== undefined && texto !== antes.texto) {
      await tx.db.updateTable("checklist_itens").set({ texto }).where("id", "=", id).execute();
      await auditar(tx, { ator, acao: "checklist_item.editar", alvoTipo: "checklist_item", alvoId: id, dados: { antes: antes.texto, depois: texto } });
      await registrarEvento(tx, "governanca.ChecklistItemEditado", { itemId: id });
    }
    if (d.ativo !== undefined && (d.ativo ? 1 : 0) !== antes.ativo) {
      await tx.db.updateTable("checklist_itens").set({ ativo: d.ativo ? 1 : 0 }).where("id", "=", id).execute();
      await auditar(tx, { ator, acao: d.ativo ? "checklist_item.reativar" : "checklist_item.desativar", alvoTipo: "checklist_item", alvoId: id });
      await registrarEvento(tx, d.ativo ? "governanca.ChecklistItemReativado" : "governanca.ChecklistItemDesativado", { itemId: id });
    }
    return comoItem(await itemOuErro(tx, id));
  });
}

/** Troca a `ordem` com o vizinho da mesma etapa (inclusive desativados, como na lista de administração); no limite não faz nada. */
export async function moverItem(ctx: Contexto, id: string, direcao: "acima" | "abaixo", ator: string): Promise<void> {
  await emTransacao(ctx, async (tx) => {
    const item = await itemOuErro(tx, id);
    const irmaos = await tx.db.selectFrom("checklist_itens").select(["id", "ordem"]).where("modelo_id", "=", item.modelo_id).where("etapa", "=", item.etapa).orderBy("ordem").orderBy("id").execute();
    const pos = irmaos.findIndex((i) => i.id === id);
    const vizinho = irmaos[direcao === "acima" ? pos - 1 : pos + 1];
    if (!vizinho) return;
    await tx.db.updateTable("checklist_itens").set({ ordem: vizinho.ordem }).where("id", "=", id).execute();
    await tx.db.updateTable("checklist_itens").set({ ordem: item.ordem }).where("id", "=", vizinho.id).execute();
    await auditar(tx, { ator, acao: "checklist_item.mover", alvoTipo: "checklist_item", alvoId: id, dados: { direcao, trocouCom: vizinho.id } });
    await registrarEvento(tx, "governanca.ChecklistItemMovido", { itemId: id, direcao });
  });
}
