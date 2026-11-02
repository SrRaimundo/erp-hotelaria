import { beforeEach, describe, expect, test } from "vitest";
import { lancar } from "../../src/hospedagem/conta.js";
import { criarReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { criarApp } from "../../src/http/app.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { criarQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { salvarCanal, salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>; // dia hoteleiro: 2026-11-10
let app: ReturnType<typeof criarApp>;
let h: { authorization: string };
let recepcao: UsuarioSessao;
let dados: NovaReserva;
let q11: string;
let contador = 0;

/** O nome do hóspede titular vem de `nome`; `extra` ajusta datas, pessoas etc. */
async function reserva(nome: string, extra: Partial<NovaReserva>, estado?: string, quartoId?: string) {
  contador++;
  const titularId = `hh${contador}`;
  await salvarHospede(ctx, { id: titularId, nome, documentoTipo: "passaporte", documento: `P${contador}0000`, nascimento: "1985-01-01", nacionalidade: "BR", telefone: `1199999000${contador}` }, "u1");
  const r = await criarReserva(ctx, { ...dados, titularId, ...extra }, recepcao);
  await ctx.db
    .updateTable("reservas")
    .set({ ...(estado ? { estado: estado as any } : {}), ...(quartoId ? { quarto_id: quartoId } : {}) })
    .where("id", "=", r.id)
    .execute();
  return r;
}

async function gerar(id: string, query = "", cab = h): Promise<{ status: number; corpo: any }> {
  const r = await app.inject({ method: "GET", url: `/api/relatorios/${id}${query}`, headers: cab });
  return { status: r.statusCode, corpo: r.json() };
}
const nomes = (corpo: any): string[] => corpo.secoes[0].linhas.map((l: any) => l.hospede);

beforeEach(async () => {
  ctx = await criarContextoTeste();
  app = criarApp(ctx);
  const std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 2, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  await salvarCanal(ctx, { nome: "Site", percentual: 0, exigeSinal: false }, "u1");
  q11 = (await criarQuarto(ctx, { numero: "11", categoriaId: std }, "u1")).id;
  for (const n of ["12", "13", "14", "15", "16", "17", "18", "19"]) await criarQuarto(ctx, { numero: n, categoriaId: std }, "u1");
  h = await entrarComo(ctx, "recepcao");
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "teste-recepcao").executeTakeFirstOrThrow();
  recepcao = (await carregarUsuarioSessao(ctx, l.id))!;
  dados = { titularId: "x", categoriaId: std, chegada: "2026-11-10", saida: "2026-11-12", adultos: 2, criancasNascimento: [], canal: "Balcão" };
  contador = 0;
});

describe("GET /api/relatorios/:id: erros", () => {
  test("id desconhecido: 404 RELATORIO_NAO_ENCONTRADO", async () => {
    const r = await gerar("nao-existe");
    expect(r.status).toBe(404);
    expect(r.corpo.codigo).toBe("RELATORIO_NAO_ENCONTRADO");
  });

  test("sem permissão reservas.gerenciar: 403", async () => {
    expect((await gerar("check-in", "", await entrarComo(ctx, "governanca"))).status).toBe(403);
  });

  test("sem login: 401", async () => {
    expect((await app.inject({ method: "GET", url: "/api/relatorios/check-in" })).statusCode).toBe(401);
  });

  test("data inválida: 422 com a mensagem do zod", async () => {
    for (const q of ["?data=2026-02-30", "?data=amanha"]) {
      const r = await gerar("check-in", q);
      expect(r.status).toBe(422);
      expect(r.corpo.codigo).toBe("FILTRO_INVALIDO");
      expect(r.corpo.mensagem).toContain("Data inválida");
    }
  });
});

describe("check-in", () => {
  test("usa o dia hoteleiro por padrão; ativas entram, canceladas, no-show e finalizadas ficam de fora", async () => {
    await reserva("Ativa Pre", {}, "pre_reserva");
    await reserva("Ativa Conf", {}, "confirmada");
    await reserva("Ja Hospedada", {}, "hospedada", q11);
    await reserva("Cancelada", {}, "cancelada");
    await reserva("Faltou", {}, "no_show");
    await reserva("Finalizada", {}, "finalizada");
    await reserva("Outro dia", { chegada: "2026-11-11", saida: "2026-11-12" }, "confirmada");
    const r = await gerar("check-in");
    expect(r.status).toBe(200);
    expect(r.corpo.id).toBe("check-in");
    expect(r.corpo.subtitulo).toContain("10/11/2026");
    expect(nomes(r.corpo)).toEqual(["Ja Hospedada", "Ativa Conf", "Ativa Pre"]); // quarto atribuído primeiro; "a definir" por nome
    expect(r.corpo.resumo).toEqual([{ rotulo: "Chegadas", valor: "3" }, { rotulo: "Pessoas", valor: "6" }]);
  });

  test("filtra por data; colunas, 'a definir', saldo em centavos e situação", async () => {
    const x = await reserva("Sem Quarto", { chegada: "2026-11-15", saida: "2026-11-18", criancasNascimento: ["2020-01-01"] }, "confirmada");
    const conta = (await ctx.db.selectFrom("reservas").select("conta_id").where("id", "=", x.id).executeTakeFirstOrThrow()).conta_id;
    await lancar(ctx, { contaId: conta, tipo: "extra", origem: "hospedagem", descricao: "Lavanderia", quantidade: 2, valorUnitario: 1500, setor: "recepcao" }, "u1");
    const r = await gerar("check-in", "?data=2026-11-15");
    const s = r.corpo.secoes[0];
    expect(s.colunas.map((c: any) => c.chave)).toEqual(["codigo", "hospede", "telefone", "quarto", "categoria", "pessoas", "noites", "saldo", "situacao"]);
    expect(s.colunas.find((c: any) => c.chave === "saldo").tipo).toBe("dinheiro");
    expect(s.linhas).toEqual([
      expect.objectContaining({ hospede: "Sem Quarto", telefone: "11999990001", quarto: "a definir", categoria: "Standard", pessoas: 3, noites: 3, saldo: 3000, situacao: "Confirmada" }),
    ]);
  });

  test("não trunca em 100 reservas (listarReservas pagina)", async () => {
    const modelo = await reserva("Modelo", { chegada: "2026-12-01", saida: "2026-12-02" }, "confirmada");
    const base = await ctx.db.selectFrom("reservas").selectAll().where("id", "=", modelo.id).executeTakeFirstOrThrow();
    for (let i = 1; i < 130; i++) {
      await ctx.db.insertInto("reservas").values({ ...base, id: `copia${i}`, codigo: 5000 + i }).execute();
    }
    const r = await gerar("check-in", "?data=2026-12-01");
    expect(r.corpo.secoes[0].linhas).toHaveLength(130);
  });

  test("vazio: 200 com linhas vazias", async () => {
    const r = await gerar("check-in", "?data=2030-01-01");
    expect(r.status).toBe(200);
    expect(r.corpo.secoes[0].linhas).toEqual([]);
    expect(r.corpo.resumo[0]).toEqual({ rotulo: "Chegadas", valor: "0" });
  });
});

describe("check-out", () => {
  test("inclui as já finalizadas no dia como 'Saiu', depois das pendentes", async () => {
    await reserva("Ja Saiu", { chegada: "2026-11-08", saida: "2026-11-10" }, "finalizada", q11);
    await reserva("Ainda Aqui", { chegada: "2026-11-08", saida: "2026-11-10" }, "hospedada");
    await reserva("Finalizada Outro Dia", { chegada: "2026-11-07", saida: "2026-11-09" }, "finalizada");
    const r = await gerar("check-out");
    expect(nomes(r.corpo)).toEqual(["Ainda Aqui", "Ja Saiu"]);
    expect(r.corpo.secoes[0].linhas.map((l: any) => l.situacao)).toEqual(["Hospedada", "Saiu"]);
    expect(r.corpo.resumo[0]).toEqual({ rotulo: "Saídas", valor: "2" });
    // check-in não inclui finalizadas
    expect(nomes((await gerar("check-in", "?data=2026-11-08")).corpo)).toEqual(["Ainda Aqui"]);
  });

  test("saídas da data entre as ativas; quarto desativado continua aparecendo", async () => {
    await reserva("Sai Hoje", { chegada: "2026-11-08", saida: "2026-11-10" }, "hospedada", q11);
    await reserva("Sai Amanha", { chegada: "2026-11-08", saida: "2026-11-11" }, "hospedada");
    await reserva("Cancelada", { chegada: "2026-11-08", saida: "2026-11-10" }, "cancelada");
    await reserva("Faltou", { chegada: "2026-11-08", saida: "2026-11-10" }, "no_show");
    await ctx.db.updateTable("quartos").set({ ativo: 0 }).where("id", "=", q11).execute();
    const r = await gerar("check-out");
    expect(r.corpo.titulo).toBe("Lista de check-out");
    expect(nomes(r.corpo)).toEqual(["Sai Hoje"]);
    expect(r.corpo.secoes[0].linhas[0].quarto).toBe("11");
    expect(nomes((await gerar("check-out", "?data=2026-11-11")).corpo)).toEqual(["Sai Amanha"]);
  });
});

describe("na-casa", () => {
  test("só hospedadas, com totais de quartos e pessoas", async () => {
    await reserva("A", { chegada: "2026-11-08", saida: "2026-11-12", criancasNascimento: ["2020-01-01"] }, "hospedada", q11);
    await reserva("B", { chegada: "2026-11-09", saida: "2026-11-11", adultos: 1 }, "hospedada");
    await reserva("Confirmada", { chegada: "2026-11-09", saida: "2026-11-11" }, "confirmada");
    await reserva("Finalizada", { chegada: "2026-11-01", saida: "2026-11-05" }, "finalizada");
    const r = await gerar("na-casa");
    expect(r.status).toBe(200);
    expect(nomes(r.corpo)).toEqual(["A", "B"]);
    const s = r.corpo.secoes[0];
    expect(s.colunas.map((c: any) => c.chave)).toEqual(["quarto", "hospede", "telefone", "entrada", "saida", "adultos", "criancas"]);
    expect(s.linhas[0]).toEqual(expect.objectContaining({ quarto: "11", entrada: "2026-11-08", saida: "2026-11-12", adultos: 2, criancas: 1 }));
    expect(s.linhas[1].quarto).toBe("a definir");
    expect(s.totais).toEqual({ adultos: 3, criancas: 1 });
    expect(r.corpo.resumo).toEqual([{ rotulo: "Quartos", valor: "2" }, { rotulo: "Pessoas", valor: "4" }]);
  });
});

describe("café da manhã", () => {
  beforeEach(async () => {
    await reserva("Dormiu e sai hoje", { chegada: "2026-11-08", saida: "2026-11-10" }, "hospedada", q11);
    await reserva("Dormiu e fica", { chegada: "2026-11-09", saida: "2026-11-12" }, "hospedada");
    await reserva("Chega hoje", { chegada: "2026-11-10", saida: "2026-11-12" }, "confirmada");
    await reserva("Saiu ontem", { chegada: "2026-11-07", saida: "2026-11-09" }, "hospedada");
    await reserva("Confirmada atrasada", { chegada: "2026-11-09", saida: "2026-11-11" }, "confirmada");
    await reserva("Pre", { chegada: "2026-11-09", saida: "2026-11-11" }, "pre_reserva");
    await reserva("Cancelada", { chegada: "2026-11-09", saida: "2026-11-11" }, "cancelada");
    await reserva("Faltou", { chegada: "2026-11-09", saida: "2026-11-11" }, "no_show");
  });

  test("chegada < data <= saída, só hospedadas e confirmadas", async () => {
    const r = await gerar("cafe");
    expect(nomes(r.corpo)).toEqual(["Dormiu e sai hoje", "Confirmada atrasada", "Dormiu e fica"]);
    const s = r.corpo.secoes[0];
    expect(s.colunas.map((c: any) => c.chave)).toEqual(["quarto", "hospede", "adultos", "criancas"]);
    expect(s.totais).toEqual({ adultos: 6, criancas: 0 });
    expect(r.corpo.resumo).toContainEqual({ rotulo: "Pessoas", valor: "6" });
  });

  test("limites: quem sai na data entra; quem chega na data não", async () => {
    expect(nomes((await gerar("cafe", "?data=2026-11-09")).corpo)).toEqual(["Dormiu e sai hoje", "Saiu ontem"]);
    expect(nomes((await gerar("cafe", "?data=2026-11-08")).corpo)).toEqual(["Saiu ontem"]);
    expect(nomes((await gerar("cafe", "?data=2026-11-07")).corpo)).toEqual([]);
  });
});
