import { beforeEach, describe, expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { criarQuarto } from "../../src/nucleo/quartos.js";
import { ErroDominio } from "../../src/shared/erros.js";
import { cotar } from "../../src/tarifas/cotacao.js";
import { ocupacaoCategoria } from "../../src/tarifas/ocupacao.js";
import {
  salvarCanal, salvarFaixasOcupacao, salvarPacote, salvarPercentualDiaSemana,
  salvarRestricao, salvarTabelaBase, salvarTemporada,
} from "../../src/tarifas/regras.js";
import { verificarRestricoes } from "../../src/tarifas/restricoes.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

const casal = { adultos: 2, criancasNascimento: [] as string[] };
let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let std: string;
let seq = 0;

async function reservar(categoriaId: string, chegada: string, saida: string, estado = "confirmada") {
  seq++;
  await ctx.db
    .insertInto("reservas")
    .values({
      id: `r${seq}`, codigo: seq, estado, titular_id: "h1", categoria_id: categoriaId, chegada, saida,
      adultos: 2, criancas: "[]", canal: "Balcão", conta_id: "c1", criada_em: "2026-11-10T15:00:00Z",
    })
    .execute();
}

beforeEach(async () => {
  seq = 0;
  ctx = await criarContextoTeste();
  std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  await ctx.db.insertInto("hospedes").values({
    id: "h1", nome: "Titular", nome_busca: "titular", documento_tipo: "cpf", documento: "1", nacionalidade: "BR",
  }).execute();
  await ctx.db.insertInto("contas").values({ id: "c1", titular_id: "h1", situacao: "aberta" }).execute();
});

async function criarQuartos(n: number) {
  for (let i = 0; i < n; i++) await criarQuarto(ctx, { numero: String(100 + i), categoriaId: std }, "u1");
}

describe("cotação", () => {
  test("estadia atravessando temporada precifica cada noite pela sua data", async () => {
    await salvarTemporada(ctx, { nome: "Alta", inicio: "2026-12-20", fim: "2027-01-10", prioridade: 1, percentual: 20 }, "u1");
    const c = await cotar(ctx, { categoriaId: std, chegada: "2026-12-18", saida: "2026-12-22", hospedes: casal, canal: "Balcão" });
    expect(c.noites.map((n) => n.valor)).toEqual([30000, 30000, 36000, 36000]);
    expect(c.total).toBe(132000);
    expect(c.violacoes).toEqual([]);
  });

  test("temporadas sobrepostas: vale a de maior prioridade", async () => {
    await salvarTemporada(ctx, { nome: "Alta", inicio: "2026-12-20", fim: "2027-01-10", prioridade: 1, percentual: 20 }, "u1");
    await salvarTemporada(ctx, { nome: "Réveillon", inicio: "2026-12-31", fim: "2026-12-31", prioridade: 2, percentual: 50 }, "u1");
    const c = await cotar(ctx, { categoriaId: std, chegada: "2026-12-31", saida: "2027-01-01", hospedes: casal, canal: "Balcão" });
    expect(c.noites[0]!.valor).toBe(45000);
  });

  test("temporada com tabela própria da categoria substitui a base", async () => {
    await salvarTemporada(ctx, {
      nome: "Festival", inicio: "2026-12-01", fim: "2026-12-05", prioridade: 1,
      tabelas: [{ categoriaId: std, porAdultos: { 1: 50000, 2: 60000, 3: 70000 }, adultoExtra: 10000 }],
    }, "u1");
    const c = await cotar(ctx, { categoriaId: std, chegada: "2026-12-02", saida: "2026-12-03", hospedes: casal, canal: "Balcão" });
    expect(c.total).toBe(60000);
  });

  test("dia da semana, canal, piso e tabela ausente", async () => {
    await salvarPercentualDiaSemana(ctx, { dia: 6, percentual: 10 }, "u1"); // sábado
    await salvarCanal(ctx, { nome: "Booking", percentual: -15, exigeSinal: false }, "u1");
    const c = await cotar(ctx, { categoriaId: std, chegada: "2026-11-14", saida: "2026-11-15", hospedes: casal, canal: "Booking" });
    expect(c.total).toBe(28050); // 30000 * 1,10 * 0,85
    const e1 = await cotar(ctx, { categoriaId: std, chegada: "2026-11-14", saida: "2026-11-15", hospedes: casal, canal: "Nenhum" }).catch((e) => e);
    expect((e1 as ErroDominio).codigo).toBe("CANAL_INEXISTENTE");
    const outra = await criarCategoria(ctx, { nome: "Luxo", maxAdultos: 2, maxCriancas: 0, comodidades: [] }, "u1");
    const e2 = await cotar(ctx, { categoriaId: outra.id, chegada: "2026-11-14", saida: "2026-11-15", hospedes: casal, canal: "Balcão" }).catch((e) => e);
    expect((e2 as ErroDominio).codigo).toBe("TABELA_BASE_AUSENTE");
    await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000, piso: 32000 }, "u1");
    expect((await cotar(ctx, { categoriaId: std, chegada: "2026-11-11", saida: "2026-11-12", hospedes: casal, canal: "Balcão" })).total).toBe(32000);
  });

  test("criança usa as faixas semeadas (6–11 paga 50% do adulto extra)", async () => {
    const c = await cotar(ctx, { categoriaId: std, chegada: "2026-11-11", saida: "2026-11-12", hospedes: { adultos: 2, criancasNascimento: ["2018-01-01", "2024-01-01"] }, canal: "Balcão" });
    expect(c.total).toBe(34000); // 30000 + 50% de 8000; a de 2 anos é grátis
  });

  test("pacote só nas noites cobertas e só com mínimo de noites", async () => {
    await salvarTemporada(ctx, { nome: "Alta", inicio: "2026-12-20", fim: "2027-01-10", prioridade: 1, percentual: 20 }, "u1");
    await salvarPacote(ctx, { nome: "Réveillon", categoriaId: std, inicio: "2026-12-29", fim: "2027-01-01", minNoites: 3, valorNoite: { 1: 40000, 2: 50000, 3: 60000 }, ativo: true }, "u1");
    const a = await cotar(ctx, { categoriaId: std, chegada: "2026-12-28", saida: "2027-01-02", hospedes: casal, canal: "Balcão" });
    expect(a.noites.map((n) => n.valor)).toEqual([36000, 50000, 50000, 50000, 50000]);
    const b = await cotar(ctx, { categoriaId: std, chegada: "2026-12-30", saida: "2027-01-01", hospedes: casal, canal: "Balcão" });
    expect(b.noites.map((n) => n.valor)).toEqual([36000, 36000]);
  });
});

describe("ocupação", () => {
  test("ocupação dinâmica usa reservas da categoria na data", async () => {
    await criarQuartos(10);
    await salvarFaixasOcupacao(ctx, [{ acimaDe: 70, percentual: 10 }, { acimaDe: 90, percentual: 25 }], "u1");
    for (let i = 0; i < 8; i++) await reservar(std, "2026-11-20", "2026-11-22");
    expect(await ocupacaoCategoria(ctx, std, "2026-11-21")).toBe(80);
    expect(await ocupacaoCategoria(ctx, std, "2026-11-22")).toBe(0); // saída é exclusiva
    const c = await cotar(ctx, { categoriaId: std, chegada: "2026-11-21", saida: "2026-11-22", hospedes: casal, canal: "Balcão" });
    expect(c.total).toBe(33000);
  });

  test("estados cancelados e a própria reserva ignorada não contam", async () => {
    await criarQuartos(2);
    await reservar(std, "2026-11-20", "2026-11-22", "cancelada");
    await reservar(std, "2026-11-20", "2026-11-22", "hospedada");
    await reservar(std, "2026-11-20", "2026-11-22", "pre_reserva");
    expect(await ocupacaoCategoria(ctx, std, "2026-11-20")).toBe(100);
    expect(await ocupacaoCategoria(ctx, std, "2026-11-20", "r3")).toBe(50);
  });

  test("quarto em manutenção sai do denominador da ocupação", async () => {
    await criarQuartos(4);
    await ctx.db.updateTable("quartos").set({ situacao: "em_manutencao" }).where("numero", "=", "100").execute();
    await ctx.db.updateTable("quartos").set({ situacao: "bloqueado" }).where("numero", "=", "101").execute();
    await reservar(std, "2026-11-20", "2026-11-21");
    expect(await ocupacaoCategoria(ctx, std, "2026-11-20")).toBe(50);
  });

  test("sem quartos disponíveis a ocupação é 100", async () => {
    expect(await ocupacaoCategoria(ctx, std, "2026-11-20")).toBe(100);
  });
});

describe("restrições", () => {
  test("mínimo de noites (da data de chegada) e fechado para chegada", async () => {
    await salvarRestricao(ctx, { categoriaId: std, data: "2026-12-31", minNoites: 3, fechadoChegada: true, fechadoSaida: false, fechadoVenda: false }, "u1");
    const v = await verificarRestricoes(ctx, std, "2026-12-31", "2027-01-02");
    expect(v.map((x) => x.codigo).sort()).toEqual(["FECHADO_CHEGADA", "MIN_NOITES"]);
    expect(v.every((x) => x.data === "2026-12-31" && x.mensagem.length > 0)).toBe(true);
    const c = await cotar(ctx, { categoriaId: std, chegada: "2026-12-31", saida: "2027-01-02", hospedes: casal, canal: "Balcão" });
    expect(c.violacoes).toHaveLength(2);
  });

  test("fechado para saída na data de saída e fechado para venda em qualquer noite", async () => {
    await salvarRestricao(ctx, { categoriaId: std, data: "2026-12-03", minNoites: null, fechadoChegada: false, fechadoSaida: true, fechadoVenda: false }, "u1");
    await salvarRestricao(ctx, { categoriaId: std, data: "2026-12-02", minNoites: null, fechadoChegada: false, fechadoSaida: false, fechadoVenda: true }, "u1");
    const v = await verificarRestricoes(ctx, std, "2026-12-01", "2026-12-03");
    expect(v.map((x) => [x.codigo, x.data])).toEqual([["FECHADO_VENDA", "2026-12-02"], ["FECHADO_SAIDA", "2026-12-03"]]);
    expect(await verificarRestricoes(ctx, std, "2026-12-10", "2026-12-12")).toEqual([]);
  });

  test("salvarRestricao substitui a anterior da mesma data", async () => {
    await salvarRestricao(ctx, { categoriaId: std, data: "2026-12-31", minNoites: 3, fechadoChegada: false, fechadoSaida: false, fechadoVenda: false }, "u1");
    await salvarRestricao(ctx, { categoriaId: std, data: "2026-12-31", minNoites: null, fechadoChegada: false, fechadoSaida: false, fechadoVenda: false }, "u1");
    expect(await verificarRestricoes(ctx, std, "2026-12-31", "2027-01-01")).toEqual([]);
  });
});

describe("rotas", () => {
  test("simulador via HTTP retorna detalhamento", async () => {
    const app = criarApp(ctx);
    const h = await entrarComo(ctx, "recepcao");
    const r = await app.inject({
      method: "POST", url: "/api/tarifas/simular", headers: h,
      payload: { categoriaId: std, chegada: "2026-11-11", saida: "2026-11-12", hospedes: casal, canal: "Balcão" },
    });
    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.noites[0].passos[0].rotulo).toBe("Base");
    expect(corpo.total).toBe(30000);
  });

  test("CRUD exige tarifas.gerenciar e valida valores", async () => {
    const app = criarApp(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    const adm = await entrarComo(ctx, "admin");
    const corpo = { categoriaId: std, porAdultos: { 1: 1, 2: 2, 3: 3 }, adultoExtra: 5 };
    expect((await app.inject({ method: "PUT", url: "/api/tarifas/tabelas-base", headers: rec, payload: corpo })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/api/tarifas/tabelas-base", headers: adm, payload: { ...corpo, adultoExtra: 5.5 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/tarifas/tabelas-base", headers: adm, payload: corpo })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/tarifas/tabelas-base", headers: adm })).json()).toHaveLength(1);
    const canais = (await app.inject({ method: "GET", url: "/api/tarifas/canais", headers: adm })).json();
    expect(canais.map((c: any) => c.nome)).toContain("Balcão");
  });
});
