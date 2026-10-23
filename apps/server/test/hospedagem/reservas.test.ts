import { beforeEach, describe, expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { transicionar } from "../../src/hospedagem/estados.js";
import { criarGrupo, criarReserva, obterReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { verificarDisponibilidade } from "../../src/hospedagem/disponibilidade.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { salvarConfig } from "../../src/nucleo/pousada.js";
import { criarQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { salvarCanal, salvarRestricao, salvarTabelaBase } from "../../src/tarifas/regras.js";
import { alterarReserva } from "../../src/hospedagem/alteracao.js";
import { somarDias } from "../../src/shared/tempo.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let std: string;
let q12: string;
let recepcao: UsuarioSessao;
let dados: NovaReserva;
const admin = { login: "admin", senha: "admin" };
const SINAL = { exigir: true, tipo: "percentual" as const, percentual: 30, prazoHoras: 48, toleranciaHoras: 12 };

async function usuario(perfil: "recepcao" | "admin"): Promise<UsuarioSessao> {
  await entrarComo(ctx, perfil);
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", perfil === "admin" ? "admin" : "teste-recepcao").executeTakeFirstOrThrow();
  return (await carregarUsuarioSessao(ctx, l.id))!;
}

beforeEach(async () => {
  ctx = await criarContextoTeste();
  std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  q12 = (await criarQuarto(ctx, { numero: "12", categoriaId: std }, "u1")).id;
  await ctx.db.insertInto("hospedes").values({
    id: "h1", nome: "Titular", nome_busca: "titular", documento_tipo: "cpf", documento: "1", nacionalidade: "BR",
  }).execute();
  recepcao = await usuario("recepcao");
  dados = { titularId: "h1", categoriaId: std, chegada: "2026-11-20", saida: "2026-11-23", adultos: 2, criancasNascimento: [], canal: "Balcão" };
});

describe("criação", () => {
  test("reserva com sinal nasce pre_reserva com valor e prazo", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    expect(r.estado).toBe("pre_reserva");
    expect(r.codigo).toBe(1);
    expect(r.valorSinal).toBe(27000); // 30% de 90000
    expect(r.prazoSinal).toBe("2026-11-12T15:00:00.000Z"); // agora + 48h
    const conta = await ctx.db.selectFrom("contas").selectAll().where("id", "=", r.contaId).executeTakeFirstOrThrow();
    expect(conta).toMatchObject({ titular_id: "h1", situacao: "aberta" });
    const aud = await ctx.db.selectFrom("auditoria").selectAll().where("alvo_id", "=", r.id).execute();
    expect(aud.map((a) => a.acao)).toContain("reserva.criar");
    const ev = await ctx.db.selectFrom("outbox").select("tipo").where("tipo", "=", "hospedagem.ReservaCriada").execute();
    expect(ev).toHaveLength(1);
    expect((await criarReserva(ctx, { ...dados, chegada: "2026-12-01", saida: "2026-12-02" }, recepcao)).codigo).toBe(2);
  });

  test("sinal pela primeira diária", async () => {
    await salvarConfig(ctx, { sinal: { ...SINAL, tipo: "primeira_diaria" } }, "u1");
    expect((await criarReserva(ctx, dados, recepcao)).valorSinal).toBe(30000);
  });

  test("canal sem exigência de sinal nasce confirmada", async () => {
    await salvarCanal(ctx, { nome: "Booking", percentual: 0, exigeSinal: false }, "u1");
    const r = await criarReserva(ctx, { ...dados, canal: "Booking" }, recepcao);
    expect(r).toMatchObject({ estado: "confirmada", valorSinal: 0, prazoSinal: null });
  });

  test("sinal desligado na configuração nasce confirmada", async () => {
    await salvarConfig(ctx, { sinal: { ...SINAL, exigir: false } }, "u1");
    expect((await criarReserva(ctx, dados, recepcao)).estado).toBe("confirmada");
  });

  test("preço congela: mudar a tabela depois não altera a reserva", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 1, 2: 2, 3: 3 }, adultoExtra: 1 }, "u1");
    const d = await obterReserva(ctx, r.id);
    expect(d.total).toBe(90000);
    expect(d.noites.map((n) => [n.data, n.valor])).toEqual([["2026-11-20", 30000], ["2026-11-21", 30000], ["2026-11-22", 30000]]);
    expect(d.noites[0]!.passos[0]!.rotulo).toBe("Base");
  });

  test("obterReserva de id desconhecido", async () => {
    await expect(obterReserva(ctx, "nada")).rejects.toMatchObject({ codigo: "RESERVA_NAO_ENCONTRADA" });
  });

  test("validações de datas, canal e titular", async () => {
    await expect(criarReserva(ctx, { ...dados, saida: "2026-11-20" }, recepcao)).rejects.toMatchObject({ codigo: "DATAS_INVALIDAS" });
    await expect(criarReserva(ctx, { ...dados, canal: "Nenhum" }, recepcao)).rejects.toMatchObject({ codigo: "CANAL_INEXISTENTE" });
    await expect(criarReserva(ctx, { ...dados, titularId: "xx" }, recepcao)).rejects.toMatchObject({ codigo: "HOSPEDE_NAO_ENCONTRADO" });
  });

  test("capacidade excedida", async () => {
    await expect(criarReserva(ctx, { ...dados, adultos: 5 }, recepcao)).rejects.toMatchObject({ codigo: "CAPACIDADE_EXCEDIDA" });
    await expect(
      criarReserva(ctx, { ...dados, criancasNascimento: ["2020-01-01", "2021-01-01"] }, recepcao),
    ).rejects.toMatchObject({ codigo: "CAPACIDADE_EXCEDIDA" });
    // quem já tem idade de adulto na chegada conta como adulto
    await expect(
      criarReserva(ctx, { ...dados, adultos: 3, criancasNascimento: ["2000-01-01"] }, recepcao),
    ).rejects.toMatchObject({ codigo: "CAPACIDADE_EXCEDIDA" });
  });
});

describe("disponibilidade", () => {
  test("Review Focus 1: duas reservas simultâneas do mesmo quarto — a segunda falha", async () => {
    const p = () => criarReserva(ctx, { ...dados, quartoId: q12 }, recepcao);
    const res = await Promise.allSettled([p(), p()]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((res.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.codigo).toBe("QUARTO_INDISPONIVEL");
  });

  test("períodos que apenas se tocam não conflitam", async () => {
    await criarReserva(ctx, { ...dados, quartoId: q12 }, recepcao);
    await criarReserva(ctx, { ...dados, quartoId: q12, chegada: "2026-11-23", saida: "2026-11-24" }, recepcao);
  });

  test("quarto em manutenção ou bloqueado é indisponível", async () => {
    await ctx.db.updateTable("quartos").set({ situacao: "em_manutencao" }).where("id", "=", q12).execute();
    await expect(criarReserva(ctx, { ...dados, quartoId: q12 }, recepcao)).rejects.toMatchObject({ codigo: "QUARTO_INDISPONIVEL" });
    await expect(
      verificarDisponibilidade(ctx, { categoriaId: std, quartoId: q12, chegada: "2026-11-20", saida: "2026-11-21" }),
    ).rejects.toMatchObject({ codigo: "QUARTO_INDISPONIVEL" });
  });

  test("categoria lotada sem quarto atribuído", async () => {
    await criarReserva(ctx, dados, recepcao);
    await expect(criarReserva(ctx, { ...dados, chegada: "2026-11-22", saida: "2026-11-24" }, recepcao)).rejects.toMatchObject({ codigo: "CATEGORIA_LOTADA" });
    await criarReserva(ctx, { ...dados, chegada: "2026-11-23", saida: "2026-11-24" }, recepcao);
  });

  test("ignorarReservaId desconsidera a própria reserva", async () => {
    const r = await criarReserva(ctx, { ...dados, quartoId: q12 }, recepcao);
    await expect(verificarDisponibilidade(ctx, { categoriaId: std, quartoId: q12, chegada: r.chegada, saida: r.saida })).rejects.toBeDefined();
    await verificarDisponibilidade(ctx, { categoriaId: std, quartoId: q12, chegada: r.chegada, saida: r.saida, ignorarReservaId: r.id });
  });

  test("reserva cancelada libera o quarto", async () => {
    const r = await criarReserva(ctx, { ...dados, quartoId: q12 }, recepcao);
    await ctx.db.updateTable("reservas").set({ estado: "cancelada" }).where("id", "=", r.id).execute();
    await criarReserva(ctx, { ...dados, quartoId: q12 }, recepcao);
  });
});

describe("autorização de supervisor", () => {
  test("desconto acima do limite exige supervisor", async () => {
    await expect(criarReserva(ctx, { ...dados, descontoPercentual: 10 }, recepcao)).rejects.toMatchObject({ codigo: "SUPERVISOR_NECESSARIO" });
    await expect(
      criarReserva(ctx, { ...dados, descontoPercentual: 10, autorizacao: { motivo: " ", supervisor: admin } }, recepcao),
    ).rejects.toMatchObject({ codigo: "MOTIVO_OBRIGATORIO" });
    const r = await criarReserva(ctx, { ...dados, descontoPercentual: 10, autorizacao: { motivo: "Cliente antigo", supervisor: admin } }, recepcao);
    const d = await obterReserva(ctx, r.id);
    expect(d.noites.map((n) => n.valor)).toEqual([27000, 27000, 27000]);
    expect(d.noites[0]!.passos.at(-1)).toEqual({ rotulo: "Desconto −10%", valor: 27000 });
    expect(d.total).toBe(81000);
    expect(r.valorSinal).toBe(24300); // sinal sobre o total com desconto
    const aud = await ctx.db.selectFrom("auditoria").selectAll().where("alvo_id", "=", r.id).executeTakeFirstOrThrow();
    expect(aud.motivo).toBe("Cliente antigo");
    expect(aud.supervisor_id).not.toBeNull();
  });

  test("desconto dentro do limite não exige supervisor", async () => {
    const r = await criarReserva(ctx, { ...dados, descontoPercentual: 5 }, recepcao);
    expect((await obterReserva(ctx, r.id)).total).toBe(85500);
  });

  test("restrição de data exige supervisor", async () => {
    await salvarRestricao(ctx, { categoriaId: std, data: "2026-11-20", minNoites: null, fechadoChegada: true, fechadoSaida: false, fechadoVenda: false }, "u1");
    const e = await criarReserva(ctx, dados, recepcao).catch((x) => x);
    expect(e.codigo).toBe("RESTRICAO_TARIFARIA");
    expect(e.detalhes).toHaveLength(1);
    expect(e.detalhes[0].codigo).toBe("FECHADO_CHEGADA");
    const r = await criarReserva(ctx, { ...dados, autorizacao: { motivo: "Exceção", supervisor: admin } }, recepcao);
    expect(r.estado).toBe("pre_reserva");
  });

  test("supervisor com senha errada é recusado e nada é gravado", async () => {
    await expect(
      criarReserva(ctx, { ...dados, descontoPercentual: 10, autorizacao: { motivo: "x", supervisor: { login: "admin", senha: "errada" } } }, recepcao),
    ).rejects.toMatchObject({ codigo: "CREDENCIAIS_INVALIDAS" });
    expect(await ctx.db.selectFrom("reservas").select("id").execute()).toHaveLength(0);
    expect(await ctx.db.selectFrom("contas").select("id").execute()).toHaveLength(0);
  });
});

describe("grupos", () => {
  test("grupo com cobrança única compartilha a conta", async () => {
    const g = await criarGrupo(ctx, { titularId: "h1", cobranca: "unica" }, recepcao);
    await salvarConfig(ctx, { sinal: { ...SINAL, exigir: false } }, "u1");
    await criarQuarto(ctx, { numero: "13", categoriaId: std }, "u1");
    const a = await criarReserva(ctx, { ...dados, grupoId: g.id }, recepcao);
    const b = await criarReserva(ctx, { ...dados, grupoId: g.id }, recepcao);
    expect(b.contaId).toBe(a.contaId);
    expect(a.grupoId).toBe(g.id);
    expect(await ctx.db.selectFrom("contas").select("id").execute()).toHaveLength(1);
  });

  test("grupo com cobrança separada tem uma conta por reserva", async () => {
    const g = await criarGrupo(ctx, { titularId: "h1", cobranca: "separada" }, recepcao);
    await criarQuarto(ctx, { numero: "13", categoriaId: std }, "u1");
    const a = await criarReserva(ctx, { ...dados, grupoId: g.id }, recepcao);
    const b = await criarReserva(ctx, { ...dados, grupoId: g.id }, recepcao);
    expect(b.contaId).not.toBe(a.contaId);
  });

  test("grupo inexistente e titular inexistente", async () => {
    await expect(criarReserva(ctx, { ...dados, grupoId: "nada" }, recepcao)).rejects.toMatchObject({ codigo: "GRUPO_NAO_ENCONTRADO" });
    await expect(criarGrupo(ctx, { titularId: "xx", cobranca: "unica" }, recepcao)).rejects.toMatchObject({ codigo: "HOSPEDE_NAO_ENCONTRADO" });
  });
});

describe("estados", () => {
  test("transições inválidas", () => {
    expect(() => transicionar("finalizada", "hospedada")).toThrow(/TRANSICAO_RESERVA_INVALIDA/);
    expect(() => transicionar("pre_reserva", "hospedada")).toThrow(/TRANSICAO_RESERVA_INVALIDA/);
    expect(() => transicionar("hospedada", "cancelada")).toThrow(/TRANSICAO_RESERVA_INVALIDA/);
  });
  test("transições válidas", () => {
    for (const [de, para] of [
      ["pre_reserva", "confirmada"], ["pre_reserva", "cancelada"], ["confirmada", "hospedada"],
      ["confirmada", "cancelada"], ["confirmada", "no_show"], ["hospedada", "finalizada"],
    ] as const) expect(() => transicionar(de, para)).not.toThrow();
  });
});

describe("rotas", () => {
  test("POST/GET reservas e POST grupos exigem reservas.gerenciar e validam", async () => {
    const app = criarApp(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    const gov = await entrarComo(ctx, "governanca");
    expect((await app.inject({ method: "POST", url: "/api/reservas", headers: gov, payload: dados })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/reservas", headers: rec, payload: { ...dados, chegada: "20/11/2026" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/reservas", headers: rec, payload: { ...dados, adultos: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/reservas", headers: rec, payload: { ...dados, descontoPercentual: 101 } })).statusCode).toBe(400);
    const criada = await app.inject({ method: "POST", url: "/api/reservas", headers: rec, payload: dados });
    expect(criada.statusCode).toBe(200);
    const id = criada.json().id;
    const lida = await app.inject({ method: "GET", url: `/api/reservas/${id}`, headers: rec });
    expect(lida.json()).toMatchObject({ id, total: 90000 });
    expect(lida.json().noites).toHaveLength(3);
    expect((await app.inject({ method: "GET", url: "/api/reservas/nada", headers: rec })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: "/api/grupos", headers: rec, payload: { titularId: "h1", cobranca: "unica" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/grupos", headers: gov, payload: { titularId: "h1", cobranca: "unica" } })).statusCode).toBe(403);
  });
});

describe("datas impossíveis e estadia longa", () => {
  test("I7: datas que não existem no calendário são recusadas (400)", async () => {
    const app = criarApp(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    for (const chegada of ["2026-02-30", "2026-13-01", "2026-04-31", "2026-00-10"]) {
      const res = await app.inject({ method: "POST", url: "/api/reservas", headers: rec, payload: { ...dados, chegada, saida: "2027-01-05" } });
      expect([chegada, res.statusCode]).toEqual([chegada, 400]);
    }
    const bissexto = await app.inject({ method: "POST", url: "/api/reservas", headers: rec, payload: { ...dados, chegada: "2028-02-29", saida: "2028-03-01" } });
    expect(bissexto.statusCode).toBe(200);
    expect(await ctx.db.selectFrom("reservas").selectAll().execute()).toHaveLength(1);
  });

  test("I8: no máximo 365 noites (rota e domínio)", async () => {
    const app = criarApp(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    const longa = { ...dados, saida: somarDias(dados.chegada, 366) };
    expect((await app.inject({ method: "POST", url: "/api/reservas", headers: rec, payload: longa })).statusCode).toBe(400);
    await expect(criarReserva(ctx, longa, recepcao)).rejects.toMatchObject({ codigo: "ESTADIA_LONGA_DEMAIS" });
    const r = await criarReserva(ctx, dados, recepcao);
    await expect(alterarReserva(ctx, r.id, { saida: somarDias(dados.chegada, 366) }, recepcao)).rejects.toMatchObject({ codigo: "ESTADIA_LONGA_DEMAIS" });
    const max = await alterarReserva(ctx, r.id, { saida: somarDias(dados.chegada, 365) }, recepcao);
    expect(max.saida).toBe(somarDias(dados.chegada, 365));
  });
});
