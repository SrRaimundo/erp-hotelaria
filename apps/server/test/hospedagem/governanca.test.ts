import { beforeEach, describe, expect, test } from "vitest";
import { listaGovernanca, bloquear, colocarEmManutencao, liberar, marcarLimpo } from "../../src/hospedagem/governanca.js";
import { fazerCheckin } from "../../src/hospedagem/checkin.js";
import { criarReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { criarApp } from "../../src/http/app.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { salvarConfig } from "../../src/nucleo/pousada.js";
import { criarQuarto, mudarSituacaoQuarto, obterQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let std: string;
let q101: string;
let q102: string;
let q103: string;
let recepcao: UsuarioSessao;
let governanca: UsuarioSessao;
let dados: NovaReserva;

async function usuario(perfil: "recepcao" | "governanca"): Promise<UsuarioSessao> {
  await entrarComo(ctx, perfil);
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", `teste-${perfil}`).executeTakeFirstOrThrow();
  return (await carregarUsuarioSessao(ctx, l.id))!;
}

beforeEach(async () => {
  ctx = await criarContextoTeste();
  std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  q101 = (await criarQuarto(ctx, { numero: "101", categoriaId: std }, "u1")).id;
  q102 = (await criarQuarto(ctx, { numero: "102", categoriaId: std }, "u1")).id;
  q103 = (await criarQuarto(ctx, { numero: "103", categoriaId: std }, "u1")).id;
  await salvarConfig(ctx, { sinal: { exigir: false, tipo: "percentual", percentual: 30, prazoHoras: 24, toleranciaHoras: 2 } }, "u1");
  await salvarHospede(ctx, {
    id: "h1", nome: "Titular", documentoTipo: "passaporte", documento: "doc-h1", nascimento: "1990-01-01", nacionalidade: "BR",
    telefone: "11999990000", endereco: { logradouro: "Rua A", cidade: "Recife", uf: "PE", pais: "BR" },
  }, "u1");
  recepcao = await usuario("recepcao");
  governanca = await usuario("governanca");
  dados = { titularId: "h1", categoriaId: std, chegada: "2026-11-10", saida: "2026-11-12", adultos: 1, criancasNascimento: [], canal: "Balcão" };
});

describe("governança", () => {
  test("governança marca limpo, mas não coloca em manutenção (403)", async () => {
    const app = criarApp(ctx);
    const gov = await entrarComo(ctx, "governanca");
    await mudarSituacaoQuarto(ctx, q101, "em_manutencao", "u1");
    await mudarSituacaoQuarto(ctx, q101, "sujo", "u1");
    const ok = await app.inject({ method: "POST", url: `/api/quartos/${q101}/limpo`, headers: gov });
    expect(ok.statusCode).toBe(200);
    expect((await obterQuarto(ctx, q101)).situacao).toBe("livre");
    const r = await app.inject({ method: "POST", url: `/api/quartos/${q102}/manutencao`, headers: gov, payload: { motivo: "Torneira" } });
    expect(r.statusCode).toBe(403);
    expect(await colocarEmManutencao(ctx, q102, "Torneira", governanca).catch((e) => e)).toMatchObject({ codigo: "SEM_PERMISSAO" });
    expect((await obterQuarto(ctx, q102)).situacao).toBe("livre");
  });

  test("manutenção exige motivo", async () => {
    expect(await colocarEmManutencao(ctx, q101, "  ", recepcao).catch((e) => e)).toMatchObject({ codigo: "MOTIVO_OBRIGATORIO" });
    expect(await bloquear(ctx, q101, "", recepcao).catch((e) => e)).toMatchObject({ codigo: "MOTIVO_OBRIGATORIO" });
    const app = criarApp(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    const r = await app.inject({ method: "POST", url: `/api/quartos/${q101}/manutencao`, headers: rec, payload: {} });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect((await obterQuarto(ctx, q101)).situacao).toBe("livre");
    await colocarEmManutencao(ctx, q101, "Ar-condicionado", recepcao);
    expect((await obterQuarto(ctx, q101)).situacao).toBe("em_manutencao");
    await liberar(ctx, q101, "Consertado", recepcao);
    expect((await obterQuarto(ctx, q101)).situacao).toBe("livre");
    await bloquear(ctx, q101, "Reforma", recepcao);
    expect((await obterQuarto(ctx, q101)).situacao).toBe("bloqueado");
    await liberar(ctx, q101, "Fim da reforma", recepcao);
    expect((await obterQuarto(ctx, q101)).situacao).toBe("livre");
  });

  test("quarto hospedado não vai para manutenção nem bloqueio", async () => {
    await salvarConfig(ctx, { sinal: { exigir: false, tipo: "percentual", percentual: 30, prazoHoras: 24, toleranciaHoras: 2 } }, "u1");
    ctx.relogio.definir("2026-11-10T18:00:00Z");
    const r = await criarReserva(ctx, dados, recepcao);
    await fazerCheckin(ctx, { reservaId: r.id, quartoId: q101, acompanhantes: [] }, recepcao);
    expect(await colocarEmManutencao(ctx, q101, "Vazamento", recepcao).catch((e) => e)).toMatchObject({ codigo: "QUARTO_OCUPADO" });
    expect(await bloquear(ctx, q101, "Vazamento", recepcao).catch((e) => e)).toMatchObject({ codigo: "QUARTO_OCUPADO" });
  });

  test("lista traz sujos primeiro e hospedadoAte", async () => {
    await mudarSituacaoQuarto(ctx, q103, "em_manutencao", "u1");
    await mudarSituacaoQuarto(ctx, q103, "sujo", "u1");
    const r = await criarReserva(ctx, dados, recepcao);
    ctx.relogio.definir("2026-11-10T18:00:00Z");
    await fazerCheckin(ctx, { reservaId: r.id, quartoId: q102, acompanhantes: [] }, recepcao);
    const lista = await listaGovernanca(ctx);
    expect(lista.map((q) => q.numero)).toEqual(["103", "101", "102"]);
    expect(lista[0]).toMatchObject({ quartoId: q103, situacao: "sujo" });
    expect(lista[2]).toMatchObject({ situacao: "ocupado", hospedadoAte: "2026-11-12" });
    expect(lista[1]!.hospedadoAte).toBeUndefined();
    const app = criarApp(ctx);
    const res = await app.inject({ method: "GET", url: "/api/governanca", headers: await entrarComo(ctx, "governanca") });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(3);
  });

  test("marcar limpo só vale para quarto sujo", async () => {
    expect(await marcarLimpo(ctx, q101, governanca).catch((e) => e)).toMatchObject({ codigo: "TRANSICAO_QUARTO_INVALIDA" });
  });

  test("quarto em manutenção some da disponibilidade", async () => {
    await colocarEmManutencao(ctx, q101, "Pintura", recepcao);
    expect(await criarReserva(ctx, { ...dados, quartoId: q101 }, recepcao).catch((e) => e)).toMatchObject({ codigo: "QUARTO_INDISPONIVEL" });
  });
});
