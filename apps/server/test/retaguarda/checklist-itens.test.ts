import { beforeEach, describe, expect, test } from "vitest";
import { concluirChecklist, type RespostaEnviada } from "../../src/governanca/checklists.js";
import { criarItem, editarItem, listarItensAdmin, moverItem, obterModelos, type ItemChecklist } from "../../src/governanca/modelos.js";
import { criarApp } from "../../src/http/app.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { criarQuarto, mudarSituacaoQuarto, obterQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { ErroDominio } from "../../src/shared/erros.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let q101: string;
let governanca: UsuarioSessao;
const INICIO = "2026-11-10T14:30:00Z";
const ETAPAS = ["limpeza", "enxoval", "equipamento", "controles"];

const erro = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroDominio) return e;
    throw e;
  }
  throw new Error("esperava ErroDominio");
};
const auditorias = async (acao: string) => (await ctx.db.selectFrom("auditoria").select("id").where("acao", "=", acao).execute()).length;

function respostasOk(itens: ItemChecklist[]): RespostaEnviada[] {
  return itens.map((i): RespostaEnviada =>
    i.etapa === "limpeza" ? { itemId: i.id, simNao: true }
    : i.etapa === "enxoval" ? { itemId: i.id, quantidade: 1 }
    : i.etapa === "equipamento" ? { itemId: i.id, equipamento: "funciona" }
    : { itemId: i.id, presenca: "presente" });
}
async function sujar() {
  await mudarSituacaoQuarto(ctx, q101, "em_manutencao", "u1");
  await mudarSituacaoQuarto(ctx, q101, "sujo", "u1");
}
const concluir = (d: Partial<Parameters<typeof concluirChecklist>[2]> & { respostas: RespostaEnviada[] }) =>
  concluirChecklist(ctx, q101, { tipo: "saida", iniciadoEm: INICIO, resultado: "liberado", ...d }, governanca);

beforeEach(async () => {
  ctx = await criarContextoTeste();
  const std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  q101 = (await criarQuarto(ctx, { numero: "101", categoriaId: std }, "u1")).id;
  await entrarComo(ctx, "governanca");
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "teste-governanca").executeTakeFirstOrThrow();
  governanca = (await carregarUsuarioSessao(ctx, l.id))!;
});

describe("itens de checklist (administração)", () => {
  test("incluir, renomear, reordenar e desativar itens", async () => {
    const antes = await listarItensAdmin(ctx, "saida");
    expect(antes.every((i) => i.ativo)).toBe(true);
    const limpeza = antes.filter((i) => i.etapa === "limpeza");

    const novo = await criarItem(ctx, { tipo: "saida", etapa: "limpeza", texto: "  Janelas limpas  " }, "usuario-admin");
    expect(novo).toMatchObject({ etapa: "limpeza", texto: "Janelas limpas", ativo: true });
    let l = await listarItensAdmin(ctx, "saida");
    expect(l.filter((i) => i.etapa === "limpeza").map((i) => i.texto)).toEqual([...limpeza.map((i) => i.texto), "Janelas limpas"]);
    expect(l).toHaveLength(antes.length + 1);

    await editarItem(ctx, novo.id, { texto: "Janelas e vidros" }, "usuario-admin");
    expect((await listarItensAdmin(ctx, "saida")).find((i) => i.id === novo.id)!.texto).toBe("Janelas e vidros");

    await moverItem(ctx, novo.id, "acima", "usuario-admin");
    l = await listarItensAdmin(ctx, "saida");
    const nomes = l.filter((i) => i.etapa === "limpeza").map((i) => i.texto);
    expect(nomes[nomes.length - 2]).toBe("Janelas e vidros");

    // no limite não faz nada (e não audita)
    const ids = l.filter((i) => i.etapa === "limpeza").map((i) => i.id);
    const movs = await auditorias("checklist_item.mover");
    await moverItem(ctx, ids[0], "acima", "usuario-admin");
    await moverItem(ctx, ids[ids.length - 1], "abaixo", "usuario-admin");
    expect(await auditorias("checklist_item.mover")).toBe(movs);
    expect((await listarItensAdmin(ctx, "saida")).filter((i) => i.etapa === "limpeza").map((i) => i.id)).toEqual(ids);

    // mover para baixo traz de volta; etapas não se misturam
    await moverItem(ctx, novo.id, "abaixo", "usuario-admin");
    l = await listarItensAdmin(ctx, "saida");
    expect(l.filter((i) => i.etapa === "limpeza").at(-1)!.id).toBe(novo.id);
    const posicoes = l.map((i) => ETAPAS.indexOf(i.etapa));
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));

    await editarItem(ctx, novo.id, { ativo: false }, "usuario-admin");
    expect((await listarItensAdmin(ctx, "saida")).find((i) => i.id === novo.id)!.ativo).toBe(false);
    expect((await obterModelos(ctx)).saida.find((i) => i.id === novo.id)).toBeUndefined();
    await editarItem(ctx, novo.id, { ativo: true }, "usuario-admin");
    expect((await obterModelos(ctx)).saida.find((i) => i.id === novo.id)).toBeDefined();

    expect(await auditorias("checklist_item.criar")).toBe(1);
    expect(await auditorias("checklist_item.editar")).toBe(1);
    expect(await auditorias("checklist_item.mover")).toBe(2);
    expect(await auditorias("checklist_item.desativar")).toBe(1);
    expect(await auditorias("checklist_item.reativar")).toBe(1);
  });

  test("itens com a mesma ordem saem em ordem estável (por id)", async () => {
    const l = (await listarItensAdmin(ctx, "saida")).filter((i) => i.etapa === "limpeza");
    const [a, b] = l;
    await ctx.db.updateTable("checklist_itens").set({ ordem: 99 }).where("id", "in", [a.id, b.id]).execute();
    const depois = (await listarItensAdmin(ctx, "saida")).filter((i) => i.ordem === 99).map((i) => i.id);
    expect(depois).toEqual([a.id, b.id].sort());
  });

  test("valida texto, etapa, tipo e item inexistente", async () => {
    for (const texto of ["", "   ", "x".repeat(121)]) {
      expect((await erro(criarItem(ctx, { tipo: "saida", etapa: "limpeza", texto }, "usuario-admin"))).codigo).toBe("TEXTO_INVALIDO");
    }
    expect((await erro(criarItem(ctx, { tipo: "saida", etapa: "outra" as never, texto: "Algo" }, "usuario-admin"))).codigo).toBe("ETAPA_INVALIDA");
    expect((await erro(criarItem(ctx, { tipo: "xx" as never, etapa: "limpeza", texto: "Algo" }, "usuario-admin"))).codigo).toBe("TIPO_INVALIDO");
    const [i] = await listarItensAdmin(ctx, "saida");
    expect((await erro(editarItem(ctx, i.id, { texto: " " }, "usuario-admin"))).codigo).toBe("TEXTO_INVALIDO");
    expect((await erro(editarItem(ctx, "nao-existe", { texto: "A" }, "usuario-admin"))).codigo).toBe("ITEM_NAO_ENCONTRADO");
    expect((await erro(moverItem(ctx, "nao-existe", "acima", "usuario-admin"))).codigo).toBe("ITEM_NAO_ENCONTRADO");
    expect(await auditorias("checklist_item.criar")).toBe(0);
    expect(await auditorias("checklist_item.editar")).toBe(0);
  });

  test("renomear não altera checklists já feitos", async () => {
    await sujar();
    const itens = (await obterModelos(ctx)).saida;
    const r = await concluir({ respostas: respostasOk(itens) });
    await editarItem(ctx, itens[0].id, { texto: "Outro nome" }, "usuario-admin");
    const resp = await ctx.db.selectFrom("checklist_respostas").select("texto_item").where("execucao_id", "=", r.execucaoId).where("item_id", "=", itens[0].id).executeTakeFirstOrThrow();
    expect(resp.texto_item).toBe(itens[0].texto);
  });

  test("item desativado durante o preenchimento não bloqueia a conclusão", async () => {
    await sujar();
    const itens = (await obterModelos(ctx)).saida;
    const respostas = respostasOk(itens);
    const desativado = itens[0];
    await editarItem(ctx, desativado.id, { ativo: false }, "usuario-admin");
    const r = await concluir({ respostas, itensExibidos: itens.map((i) => i.id) });
    const gravadas = await ctx.db.selectFrom("checklist_respostas").select("item_id").where("execucao_id", "=", r.execucaoId).execute();
    expect(gravadas).toHaveLength(itens.length - 1);
    expect(gravadas.some((g) => g.item_id === desativado.id)).toBe(false);
    expect((await obterQuarto(ctx, q101)).situacao).toBe("livre");
  });

  test("item desativado e sem itensExibidos: mantém o comportamento atual (resposta recusada)", async () => {
    await sujar();
    const itens = (await obterModelos(ctx)).saida;
    await editarItem(ctx, itens[0].id, { ativo: false }, "usuario-admin");
    expect((await erro(concluir({ respostas: respostasOk(itens) }))).codigo).toBe("RESPOSTA_INVALIDA");
  });

  test("item criado depois do início não é exigido quando itensExibidos é enviado", async () => {
    await sujar();
    const itens = (await obterModelos(ctx)).saida;
    await criarItem(ctx, { tipo: "saida", etapa: "limpeza", texto: "Item novo" }, "usuario-admin");
    expect((await erro(concluir({ respostas: respostasOk(itens) }))).codigo).toBe("RESPOSTA_FALTANDO");
    await concluir({ respostas: respostasOk(itens), itensExibidos: itens.map((i) => i.id) });
    expect((await obterQuarto(ctx, q101)).situacao).toBe("livre");
  });

  test("itensExibidos continua exigindo os exibidos e recusando respostas fora da lista", async () => {
    await sujar();
    const { saida: itens, diaria } = await obterModelos(ctx);
    const parcial = itens.slice(1);
    expect((await erro(concluir({ respostas: respostasOk(itens), itensExibidos: parcial.map((i) => i.id) }))).codigo).toBe("RESPOSTA_INVALIDA");
    expect((await erro(concluir({ respostas: respostasOk(parcial), itensExibidos: itens.map((i) => i.id) }))).codigo).toBe("RESPOSTA_FALTANDO");
    // ids de outro modelo na lista são ignorados
    await concluir({ respostas: respostasOk(itens), itensExibidos: [...itens.map((i) => i.id), diaria[0].id] });
  });

  test("API: governança não administra itens (403); admin sim", async () => {
    const app = criarApp(ctx);
    const gov = await entrarComo(ctx, "governanca");
    const adm = await entrarComo(ctx, "admin");
    expect((await app.inject({ method: "GET", url: "/api/checklists/itens?tipo=saida", headers: gov })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/checklists/itens", headers: gov, payload: { tipo: "saida", etapa: "limpeza", texto: "X" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/api/checklists/itens/item-saida-1", headers: gov, payload: { ativo: false } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/checklists/itens/item-saida-1/mover", headers: gov, payload: { direcao: "abaixo" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/checklists/modelos", headers: gov })).statusCode).toBe(200);

    expect((await app.inject({ method: "GET", url: "/api/checklists/itens", headers: adm })).statusCode).toBe(400);
    const lista = await app.inject({ method: "GET", url: "/api/checklists/itens?tipo=saida", headers: adm });
    expect(lista.statusCode).toBe(200);
    expect(lista.json()[0]).toMatchObject({ id: "item-saida-1", ativo: true });
    const c = await app.inject({ method: "POST", url: "/api/checklists/itens", headers: adm, payload: { tipo: "saida", etapa: "limpeza", texto: "Via API" } });
    expect(c.statusCode).toBeLessThan(300);
    const id = c.json().id;
    expect((await app.inject({ method: "POST", url: "/api/checklists/itens", headers: adm, payload: { tipo: "saida", etapa: "limpeza", texto: "  " } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: `/api/checklists/itens/${id}`, headers: adm, payload: { texto: "Renomeado", ativo: false } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/checklists/itens/${id}/mover`, headers: adm, payload: { direcao: "acima" } })).statusCode).toBeLessThan(300);
    expect((await app.inject({ method: "POST", url: `/api/checklists/itens/${id}/mover`, headers: adm, payload: { direcao: "lado" } })).statusCode).toBe(400);
    const dep = (await app.inject({ method: "GET", url: "/api/checklists/itens?tipo=saida", headers: adm })).json();
    expect(dep.find((i: { id: string }) => i.id === id)).toMatchObject({ texto: "Renomeado", ativo: false });
  });

  test("API: conclusão aceita itensExibidos", async () => {
    const app = criarApp(ctx);
    const gov = await entrarComo(ctx, "governanca");
    await sujar();
    const itens = (await obterModelos(ctx)).saida;
    await criarItem(ctx, { tipo: "saida", etapa: "controles", texto: "Novo controle" }, "usuario-admin");
    const r = await app.inject({ method: "POST", url: `/api/quartos/${q101}/checklists`, headers: gov, payload: { tipo: "saida", iniciadoEm: INICIO, resultado: "liberado", respostas: respostasOk(itens), itensExibidos: itens.map((i) => i.id) } });
    expect(r.statusCode).toBe(200);
  });
});
