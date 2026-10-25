import { beforeEach, describe, expect, test } from "vitest";
import { abrirChamado, avisarControleFaltando, cancelarChamado, defeitosAbertos, listarChamados, resolverChamado } from "../../src/governanca/chamados.js";
import { obterModelos } from "../../src/governanca/modelos.js";
import { fazerCheckin } from "../../src/hospedagem/checkin.js";
import { bloquear, liberar } from "../../src/hospedagem/governanca.js";
import { criarReserva } from "../../src/hospedagem/reservas.js";
import { criarApp } from "../../src/http/app.js";
import { alertasAbertos } from "../../src/infra/alertas.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { salvarConfig } from "../../src/nucleo/pousada.js";
import { criarQuarto, mudarSituacaoQuarto, obterQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { emTransacao } from "../../src/shared/contexto.js";
import { salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let std: string;
let q101: string;
let q102: string;
let itemAr: string;
let itemTv: string;
let itemControleTv: string;
let itemLimpeza: string;
let recepcao: UsuarioSessao;
let governanca: UsuarioSessao;

async function usuario(perfil: "recepcao" | "governanca"): Promise<UsuarioSessao> {
  await entrarComo(ctx, perfil);
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", `teste-${perfil}`).executeTakeFirstOrThrow();
  return (await carregarUsuarioSessao(ctx, l.id))!;
}
const abrir = (quartoId: string, itemId: string, u = governanca, observacao?: string) =>
  emTransacao(ctx, (tx) => abrirChamado(tx, { quartoId, itemId, observacao }, u));

async function hospedar(quartoId: string): Promise<string> {
  ctx.relogio.definir("2026-11-10T18:00:00Z");
  const r = await criarReserva(ctx, { titularId: "h1", categoriaId: std, chegada: "2026-11-10", saida: "2026-11-12", adultos: 1, criancasNascimento: [], canal: "Balcão" }, recepcao);
  await fazerCheckin(ctx, { reservaId: r.id, quartoId, acompanhantes: [] }, recepcao);
  return r.id;
}

beforeEach(async () => {
  ctx = await criarContextoTeste();
  std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  q101 = (await criarQuarto(ctx, { numero: "101", categoriaId: std }, "u1")).id;
  q102 = (await criarQuarto(ctx, { numero: "102", categoriaId: std }, "u1")).id;
  await salvarConfig(ctx, { sinal: { exigir: false, tipo: "percentual", percentual: 30, prazoHoras: 24, toleranciaHoras: 2 } }, "u1");
  await salvarHospede(ctx, {
    id: "h1", nome: "Titular", documentoTipo: "passaporte", documento: "doc-h1", nascimento: "1990-01-01", nacionalidade: "BR",
    telefone: "11999990000", endereco: { logradouro: "Rua A", cidade: "Recife", uf: "PE", pais: "BR" },
  }, "u1");
  const m = await obterModelos(ctx);
  itemAr = m.saida.find((i) => i.texto === "Ar-condicionado")!.id;
  itemTv = m.saida.find((i) => i.texto === "TV")!.id;
  itemControleTv = m.saida.find((i) => i.texto === "Controle da TV")!.id;
  itemLimpeza = m.saida[0].id;
  recepcao = await usuario("recepcao");
  governanca = await usuario("governanca");
});

describe("chamados", () => {
  test("equipamento abre defeito; controle abre reposição", async () => {
    const d = await abrir(q101, itemAr, governanca, "  Não gela ");
    expect(d).toMatchObject({ tipo: "defeito", descricao: "Ar-condicionado não funciona", situacao: "aberto", quartoNumero: "101", observacao: "Não gela", abertoPor: governanca.id, abertoPorNome: "Teste governanca", itemId: itemAr });
    const r = await abrir(q101, itemControleTv);
    expect(r).toMatchObject({ tipo: "reposicao", descricao: "Controle da TV faltando", observacao: null });
    expect(await abrir(q101, itemLimpeza).catch((e) => e)).toMatchObject({ codigo: "ITEM_SEM_CHAMADO" });
    expect(await defeitosAbertos(ctx, q101)).toBe(1);
  });

  test("liberar quarto bloqueado com defeito aberto → CHAMADO_ABERTO; com só reposição aberta → libera", async () => {
    await bloquear(ctx, q101, "Ar quebrado", recepcao);
    const defeito = await abrir(q101, itemAr);
    await abrir(q101, itemControleTv);
    const erro = await liberar(ctx, q101, "Pronto", recepcao).catch((e) => e);
    expect(erro).toMatchObject({ codigo: "CHAMADO_ABERTO", message: "Há 1 chamado(s) de defeito aberto(s) neste quarto." });
    expect((await obterQuarto(ctx, q101)).situacao).toBe("bloqueado");
    await resolverChamado(ctx, defeito.id, undefined, recepcao);
    await liberar(ctx, q101, "Pronto", recepcao);
    expect((await obterQuarto(ctx, q101)).situacao).toBe("livre");
    expect(await listarChamados(ctx, { situacao: "aberto" })).toHaveLength(1);
  });

  test("resolver o último defeito de um quarto bloqueado devolve podeLiberar true", async () => {
    await bloquear(ctx, q101, "Defeitos", recepcao);
    const a = await abrir(q101, itemAr);
    const b = await abrir(q101, itemTv);
    expect(await resolverChamado(ctx, a.id, "Trocado o filtro", recepcao)).toEqual({ podeLiberar: false });
    expect(await resolverChamado(ctx, b.id, undefined, recepcao)).toEqual({ podeLiberar: true });
    const ra = (await listarChamados(ctx, { situacao: "resolvido", quartoId: q101 })).find((c) => c.id === a.id);
    expect(ra).toMatchObject({ id: a.id, encerradoPor: recepcao.id, observacaoEncerramento: "Trocado o filtro" });
    expect(await resolverChamado(ctx, a.id, undefined, recepcao).catch((e) => e)).toMatchObject({ codigo: "CHAMADO_ENCERRADO" });
  });

  test("quarto livre: resolver não oferece liberar", async () => {
    const a = await abrir(q102, itemAr);
    expect(await resolverChamado(ctx, a.id, undefined, recepcao)).toEqual({ podeLiberar: false });
  });

  test("só quem abriu cancela, e só enquanto aberto", async () => {
    const c = await abrir(q101, itemAr);
    expect(await cancelarChamado(ctx, c.id, recepcao).catch((e) => e)).toMatchObject({ codigo: "CHAMADO_NAO_CANCELAVEL" });
    await cancelarChamado(ctx, c.id, governanca);
    expect((await listarChamados(ctx, { quartoId: q101 }))[0]).toMatchObject({ situacao: "cancelado", encerradoPor: governanca.id });
    expect(await cancelarChamado(ctx, c.id, governanca).catch((e) => e)).toMatchObject({ codigo: "CHAMADO_NAO_CANCELAVEL" });
    expect(await defeitosAbertos(ctx, q101)).toBe(0);
    const r = await abrir(q101, itemAr);
    await resolverChamado(ctx, r.id, undefined, recepcao);
    expect(await cancelarChamado(ctx, r.id, governanca).catch((e) => e)).toMatchObject({ codigo: "CHAMADO_NAO_CANCELAVEL" });
  });

  test("aviso de controle faltando vira alerta da reserva hospedada", async () => {
    const aviso = (itemId = itemControleTv) => emTransacao(ctx, (tx) => avisarControleFaltando(tx, { quartoId: q101, itemId }, governanca));
    expect(await aviso().catch((e) => e)).toMatchObject({ codigo: "QUARTO_NAO_OCUPADO" });
    const reservaId = await hospedar(q101);
    const id = await aviso();
    const alertas = await alertasAbertos(ctx);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ id, tipo: "controle_faltando", alvoTipo: "reserva", alvoId: reservaId, mensagem: "Controle da TV não encontrado no 101 — conferir com o hóspede" });
    expect(await aviso(itemAr).catch((e) => e)).toMatchObject({ codigo: "ITEM_SEM_CHAMADO" });
  });
});

describe("rotas", () => {
  test("rota antiga /limpo responde CHECKLIST_OBRIGATORIO", async () => {
    const app = criarApp(ctx);
    await mudarSituacaoQuarto(ctx, q101, "em_manutencao", "u1");
    await mudarSituacaoQuarto(ctx, q101, "sujo", "u1");
    const res = await app.inject({ method: "POST", url: `/api/quartos/${q101}/limpo`, headers: await entrarComo(ctx, "governanca") });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ codigo: "CHECKLIST_OBRIGATORIO", mensagem: "Use o checklist para liberar o quarto." });
    expect((await obterQuarto(ctx, q101)).situacao).toBe("sujo");
  });

  test("governança abre e cancela, mas não resolve nem lista (403); recepção resolve", async () => {
    const app = criarApp(ctx);
    const gov = await entrarComo(ctx, "governanca");
    const rec = await entrarComo(ctx, "recepcao");
    const aberto = await app.inject({ method: "POST", url: `/api/quartos/${q101}/chamados`, headers: gov, payload: { itemId: itemAr, observacao: "Pinga" } });
    expect(aberto.statusCode).toBe(200);
    const c = aberto.json();
    expect(c).toMatchObject({ tipo: "defeito", observacao: "Pinga" });
    expect((await app.inject({ method: "POST", url: `/api/chamados/${c.id}/resolver`, headers: gov, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/chamados", headers: gov })).statusCode).toBe(403);
    const lista = await app.inject({ method: "GET", url: `/api/chamados?situacao=aberto&quartoId=${q101}`, headers: rec });
    expect(lista.json()).toHaveLength(1);
    const res = await app.inject({ method: "POST", url: `/api/chamados/${c.id}/resolver`, headers: rec, payload: { observacao: "ok" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ podeLiberar: false });
    const c2 = (await app.inject({ method: "POST", url: `/api/quartos/${q101}/chamados`, headers: gov, payload: { itemId: itemControleTv } })).json();
    expect((await app.inject({ method: "POST", url: `/api/chamados/${c2.id}/cancelar`, headers: rec })).json()).toMatchObject({ codigo: "CHAMADO_NAO_CANCELAVEL" });
    expect((await app.inject({ method: "POST", url: `/api/chamados/${c2.id}/cancelar`, headers: gov })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/chamados?situacao=aberto", headers: rec })).json()).toHaveLength(0);
  });

  test("aviso de controle: criar e cancelar pela rota", async () => {
    const app = criarApp(ctx);
    const gov = await entrarComo(ctx, "governanca");
    const reservaId = await hospedar(q101);
    const res = await app.inject({ method: "POST", url: `/api/quartos/${q101}/avisos-controle`, headers: gov, payload: { itemId: itemControleTv } });
    expect(res.statusCode).toBe(200);
    const { alertaId } = res.json();
    expect(await alertasAbertos(ctx)).toHaveLength(1);
    const cancelar = (id: string) => app.inject({ method: "POST", url: `/api/avisos-controle/${id}/cancelar`, headers: gov });
    expect((await cancelar(alertaId)).statusCode).toBe(200);
    expect(await alertasAbertos(ctx)).toHaveLength(0);
    const al = await ctx.db.selectFrom("alertas").select("resolvido_por").where("id", "=", alertaId).executeTakeFirstOrThrow();
    expect(al.resolvido_por).toBe(governanca.id);
    const repetido = await cancelar(alertaId);
    expect(repetido.statusCode).toBe(422);
    expect(repetido.json()).toMatchObject({ codigo: "AVISO_NAO_ENCONTRADO" });
    expect((await cancelar("inexistente")).json()).toMatchObject({ codigo: "AVISO_NAO_ENCONTRADO" });
    await ctx.db.insertInto("alertas").values({ id: "a-outro", tipo: "sinal_vencendo", alvo_tipo: "reserva", alvo_id: reservaId, mensagem: "x", criado_em: "2026-11-10T18:00:00Z", resolvido_em: null, resolvido_por: null }).execute();
    expect((await cancelar("a-outro")).json()).toMatchObject({ codigo: "AVISO_NAO_ENCONTRADO" });
    expect(await alertasAbertos(ctx)).toHaveLength(1);
  });
});
