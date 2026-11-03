import { beforeEach, describe, expect, test } from "vitest";
import { alterarReserva } from "../../src/hospedagem/alteracao.js";
import { criarReserva, obterReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { criarApp } from "../../src/http/app.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { criarQuarto } from "../../src/nucleo/quartos.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { calcularComissao } from "../../src/tarifas/comissao.js";
import { previaAlteracao } from "../../src/hospedagem/alteracao.js";
import { listarCanais, listarTemporadas, salvarCanal, salvarTabelaBase, salvarTemporada } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let app: ReturnType<typeof criarApp>;
let adm: { authorization: string };
let usuario: UsuarioSessao;
let dados: NovaReserva;

beforeEach(async () => {
  ctx = await criarContextoTeste();
  app = criarApp(ctx);
  const std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  for (const n of ["11", "12"]) await criarQuarto(ctx, { numero: n, categoriaId: std }, "u1");
  await salvarHospede(ctx, { id: "h1", nome: "Titular", documentoTipo: "passaporte", documento: "P1", nascimento: "1985-01-01", nacionalidade: "BR", telefone: "11999990001" }, "u1");
  adm = await entrarComo(ctx, "admin");
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "admin").executeTakeFirstOrThrow();
  usuario = (await carregarUsuarioSessao(ctx, l.id))!;
  dados = { titularId: "h1", categoriaId: std, chegada: "2026-11-12", saida: "2026-11-14", adultos: 2, criancasNascimento: [], canal: "Balcão" };
});

const put = (payload: object) => app.inject({ method: "PUT", url: "/api/tarifas/canais", headers: adm, payload });

describe("canais: tipo e comissão", () => {
  test("migração: Balcão nasce direta com comissão 0 e reserva sem comissão guardada vale 0", async () => {
    const [b] = await listarCanais(ctx);
    expect(b).toMatchObject({ nome: "Balcão", tipo: "direta", comissaoPercentual: 0 });
    await ctx.db.insertInto("contas").values({ id: "c1", titular_id: "h1", situacao: "aberta" }).execute();
    await ctx.db.insertInto("reservas").values({
      id: "r1", codigo: 1, estado: "confirmada", titular_id: "h1", categoria_id: dados.categoriaId, chegada: "2026-11-12", saida: "2026-11-13",
      adultos: 2, criancas: "[]", canal: "Balcão", conta_id: "c1", criada_em: "2026-11-10T15:00:00Z",
    }).execute();
    expect((await obterReserva(ctx, "r1")).comissaoPercentual).toBe(0);
  });

  test("PUT guarda tipo e comissão; omitidos mantêm o valor atual; GET devolve", async () => {
    const r = await put({ nome: "Booking", percentual: 10, exigeSinal: false, tipo: "ota", comissaoPercentual: 15.5 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ tipo: "ota", comissaoPercentual: 15.5 });
    await put({ nome: "Booking", percentual: 12, exigeSinal: false });
    const lista = (await app.inject({ method: "GET", url: "/api/tarifas/canais", headers: adm })).json();
    expect(lista.find((c: any) => c.nome === "Booking")).toMatchObject({ percentual: 12, tipo: "ota", comissaoPercentual: 15.5 });
  });

  test("valida tipo e comissão (0 a 100, duas casas)", async () => {
    const base = { nome: "X", percentual: 0, exigeSinal: false };
    expect((await put({ ...base, tipo: "outro" })).statusCode).toBe(400);
    expect((await put({ ...base, comissaoPercentual: -1 })).statusCode).toBe(400);
    expect((await put({ ...base, comissaoPercentual: 100.01 })).statusCode).toBe(400);
    expect((await put({ ...base, comissaoPercentual: 12.345 })).statusCode).toBe(400);
    expect((await put({ ...base, comissaoPercentual: 100 })).statusCode).toBe(200);
  });

  test("comissão em centavos inteiros, meio arredonda para longe do zero", () => {
    expect(calcularComissao(60000, 15)).toBe(9000);
    expect(calcularComissao(10001, 12.5)).toBe(1250); // 1250,125 -> 1250
    expect(calcularComissao(10, 15)).toBe(2); // 1,5 -> 2
    expect(calcularComissao(33333, 0)).toBe(0);
  });
});

describe("comissão na reserva", () => {
  test("criação guarda o percentual do canal; mudar o canal depois não altera o passado", async () => {
    await salvarCanal(ctx, { nome: "Booking", percentual: 0, exigeSinal: false, tipo: "ota", comissaoPercentual: 15 }, "u1");
    const r = await criarReserva(ctx, { ...dados, canal: "Booking" }, usuario);
    expect(r.comissaoPercentual).toBe(15);
    await salvarCanal(ctx, { nome: "Booking", percentual: 0, exigeSinal: false, comissaoPercentual: 20 }, "u1");
    expect((await obterReserva(ctx, r.id)).comissaoPercentual).toBe(15);
    const nova = await criarReserva(ctx, { ...dados, canal: "Booking", chegada: "2026-11-20", saida: "2026-11-21" }, usuario);
    expect(nova.comissaoPercentual).toBe(20);
  });

  test("reserva de grupo também guarda a comissão", async () => {
    await salvarCanal(ctx, { nome: "Agência", percentual: 0, exigeSinal: false, tipo: "agencia", comissaoPercentual: 8 }, "u1");
    await ctx.db.insertInto("grupos").values({ id: "g1", titular_id: "h1", cobranca: "separada" }).execute();
    const r = await criarReserva(ctx, { ...dados, canal: "Agência", grupoId: "g1" }, usuario);
    expect(r.comissaoPercentual).toBe(8);
  });

  test("trocar o canal recalcula com o percentual atual do novo canal; sem trocar, mantém", async () => {
    await salvarCanal(ctx, { nome: "Booking", percentual: 0, exigeSinal: false, tipo: "ota", comissaoPercentual: 15 }, "u1");
    await salvarCanal(ctx, { nome: "Site", percentual: 0, exigeSinal: false, comissaoPercentual: 3 }, "u1");
    const r = await criarReserva(ctx, { ...dados, canal: "Booking" }, usuario);
    await salvarCanal(ctx, { nome: "Booking", percentual: 0, exigeSinal: false, comissaoPercentual: 18 }, "u1");
    const mesmo = await alterarReserva(ctx, r.id, { adultos: 1 }, usuario);
    expect(mesmo.comissaoPercentual).toBe(15);
    const troca = await alterarReserva(ctx, r.id, { canal: "Site" }, usuario);
    expect(troca).toMatchObject({ canal: "Site", comissaoPercentual: 3 });
    const volta = await alterarReserva(ctx, r.id, { canal: "Booking" }, usuario);
    expect(volta.comissaoPercentual).toBe(18);
    await expect(alterarReserva(ctx, r.id, { canal: "Nenhum" }, usuario)).rejects.toMatchObject({ codigo: "CANAL_INEXISTENTE" });
  });
});

describe("canal em uso", () => {
  test("canal com reserva não pode ser renomeado nem removido; sem reserva pode", async () => {
    const booking = await salvarCanal(ctx, { nome: "Booking", percentual: 0, exigeSinal: false }, "u1");
    await salvarCanal(ctx, { nome: "Livre", percentual: 0, exigeSinal: false }, "u1");
    await criarReserva(ctx, { ...dados, canal: "Booking" }, usuario);

    const ren = await put({ id: booking.id, nome: "Booking.com", percentual: 0, exigeSinal: false });
    expect(ren.statusCode).toBe(422);
    expect(ren.json()).toMatchObject({ codigo: "CANAL_EM_USO", detalhes: { canais: ["Booking"] } });
    // mudar comissão sem renomear continua permitido
    expect((await put({ id: booking.id, nome: "Booking", percentual: 0, exigeSinal: false, comissaoPercentual: 9 })).statusCode).toBe(200);

    const del = await app.inject({ method: "DELETE", url: `/api/tarifas/canais/${booking.id}`, headers: adm });
    expect(del.statusCode).toBe(422);
    expect(del.json()).toMatchObject({ codigo: "CANAL_EM_USO", detalhes: { canais: ["Booking"] } });

    const livre = (await listarCanais(ctx)).find((c) => c.nome === "Livre")!;
    expect((await app.inject({ method: "DELETE", url: `/api/tarifas/canais/${livre.id}`, headers: adm })).statusCode).toBe(200);
    expect((await listarCanais(ctx)).map((c) => c.nome)).not.toContain("Livre");
  });

  test("Balcão não pode ser removido nem renomeado, mesmo sem reservas", async () => {
    const [b] = await listarCanais(ctx);
    const del = await app.inject({ method: "DELETE", url: `/api/tarifas/canais/${b!.id}`, headers: adm });
    expect(del.json()).toMatchObject({ codigo: "CANAL_BALCAO_FIXO" });
    expect(del.statusCode).toBe(422);
    expect((await put({ id: b!.id, nome: "Loja", percentual: 0, exigeSinal: true })).json().codigo).toBe("CANAL_BALCAO_FIXO");
  });

  test("remover exige tarifas.gerenciar", async () => {
    const rec = await entrarComo(ctx, "recepcao");
    expect((await app.inject({ method: "DELETE", url: "/api/tarifas/canais/x", headers: rec })).statusCode).toBe(403);
  });
});

describe("trocar o canal não mexe nos preços", () => {
  test("noites negociadas ficam como estão, a prévia avisa e a auditoria guarda canal e comissão antigos e novos", async () => {
    await salvarCanal(ctx, { nome: "Booking", percentual: 0, exigeSinal: false, tipo: "ota", comissaoPercentual: 15 }, "u1");
    await salvarCanal(ctx, { nome: "Site", percentual: 20, exigeSinal: false, comissaoPercentual: 3 }, "u1");
    const r = await criarReserva(ctx, { ...dados, canal: "Booking" }, usuario);
    // Preço negociado na criação (desconto, ajuste manual...): fica nas noites guardadas.
    await ctx.db.updateTable("reserva_noites").set({ valor: 12345 }).where("reserva_id", "=", r.id).execute();

    const previa = await previaAlteracao(ctx, r.id, { canal: "Site" });
    expect(previa.valorNovo).toBe(previa.valorAntigo);
    expect(previa.noites.map((n) => n.valor)).toEqual([12345, 12345]);
    expect(previa.trocaCanal).toMatchObject({ de: "Booking", para: "Site", comissaoAntiga: 15, comissaoNova: 3 });
    expect(previa.trocaCanal!.mensagem).toBe("Trocar o canal não muda os preços da reserva: só o canal e a comissão guardada (de 15% para 3%).");
    expect((await previaAlteracao(ctx, r.id, { adultos: 1 })).trocaCanal).toBeUndefined();

    await alterarReserva(ctx, r.id, { canal: "Site" }, usuario);
    const depois = await obterReserva(ctx, r.id);
    expect(depois).toMatchObject({ canal: "Site", comissaoPercentual: 3, total: 24690 });
    expect(depois.noites.map((n) => n.valor)).toEqual([12345, 12345]);

    const aud = await ctx.db.selectFrom("auditoria").select("dados").where("acao", "=", "reserva.alterar").where("alvo_id", "=", r.id).executeTakeFirstOrThrow();
    const dadosAud = JSON.parse(aud.dados);
    expect(dadosAud.antes).toMatchObject({ canal: "Booking", comissaoPercentual: 15 });
    expect(dadosAud.depois).toMatchObject({ canal: "Site", comissaoPercentual: 3 });
  });
});

describe("remover temporada", () => {
  test("DELETE remove a temporada com auditoria, exige tarifas.gerenciar e não mexe em reservas existentes", async () => {
    const t = await salvarTemporada(ctx, { nome: "Alta", inicio: "2026-11-01", fim: "2026-11-30", prioridade: 1, percentual: 50 }, "u1");
    const r = await criarReserva(ctx, dados, usuario);
    const antes = (await obterReserva(ctx, r.id)).noites.map((n) => n.valor);
    expect(antes).toEqual([45000, 45000]);
    const rec = await entrarComo(ctx, "recepcao");
    expect((await app.inject({ method: "DELETE", url: `/api/tarifas/temporadas/${t.id}`, headers: rec })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/tarifas/temporadas/${t.id}`, headers: adm })).statusCode).toBe(200);
    expect(await listarTemporadas(ctx)).toEqual([]);
    expect((await obterReserva(ctx, r.id)).noites.map((n) => n.valor)).toEqual(antes);
    const aud = await ctx.db.selectFrom("auditoria").select("alvo_id").where("acao", "=", "tarifas.temporada_removida").execute();
    expect(aud).toEqual([{ alvo_id: t.id }]);
    const de_novo = await app.inject({ method: "DELETE", url: `/api/tarifas/temporadas/${t.id}`, headers: adm });
    expect(de_novo.statusCode).toBe(422);
    expect(de_novo.json()).toMatchObject({ codigo: "TEMPORADA_NAO_ENCONTRADA" });
  });
});

describe("nome de canal e simulação", () => {
  test("nome repetido (inclusive só em caixa diferente) vira CANAL_DUPLICADO, em criação e em renomeação", async () => {
    await salvarCanal(ctx, { nome: "Booking", percentual: 0, exigeSinal: false }, "u1");
    const site = await salvarCanal(ctx, { nome: "Site", percentual: 0, exigeSinal: false }, "u1");
    const novo = await put({ nome: "booking", percentual: 0, exigeSinal: false });
    expect(novo.statusCode).toBe(422);
    expect(novo.json()).toMatchObject({ codigo: "CANAL_DUPLICADO" });
    const renomear = await put({ id: site.id, nome: "Booking", percentual: 0, exigeSinal: false });
    expect(renomear.statusCode).toBe(422);
    expect(renomear.json()).toMatchObject({ codigo: "CANAL_DUPLICADO" });
    expect((await listarCanais(ctx)).map((c) => c.nome)).toEqual(["Balcão", "Booking", "Site"]);
  });

  test("simular exige reservas.gerenciar", async () => {
    const gov = await entrarComo(ctx, "governanca");
    const r = await app.inject({
      method: "POST", url: "/api/tarifas/simular", headers: gov,
      payload: { categoriaId: dados.categoriaId, chegada: "2026-11-12", saida: "2026-11-13", hospedes: { adultos: 2 }, canal: "Balcão" },
    });
    expect(r.statusCode).toBe(403);
  });
});
