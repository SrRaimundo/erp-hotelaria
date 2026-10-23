import { beforeEach, describe, expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { fazerCheckin } from "../../src/hospedagem/checkin.js";
import { fazerCheckout, previaCheckout } from "../../src/hospedagem/checkout.js";
import { extrato, lancar, saldo } from "../../src/hospedagem/conta.js";
import { criarGrupo, criarReserva, obterReserva, type NovaReserva } from "../../src/hospedagem/reservas.js";
import { abrirCaixa } from "../../src/nucleo/caixa.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { ativarForma } from "../../src/nucleo/formas-pagamento.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { salvarConfig } from "../../src/nucleo/pousada.js";
import { criarQuarto, obterQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let q101: string;
let q102: string;
let recepcao: UsuarioSessao;
let dados: NovaReserva;

// Relógio: 15:00Z = 12:00 local (America/Sao_Paulo, -03:00); virada às 04:00.
const as = (dia: string, horaLocal: string) => {
  const [h, m] = horaLocal.split(":").map(Number);
  return `${dia}T${String(h! + 3).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
};

beforeEach(async () => {
  ctx = await criarContextoTeste("2026-11-10T15:00:00Z");
  const std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  q101 = (await criarQuarto(ctx, { numero: "101", categoriaId: std }, "u1")).id;
  q102 = (await criarQuarto(ctx, { numero: "102", categoriaId: std }, "u1")).id;
  await salvarConfig(ctx, { sinal: { exigir: false, tipo: "percentual", percentual: 30, prazoHoras: 24, toleranciaHoras: 2 } }, "u1");
  await salvarHospede(ctx, {
    id: "h1", nome: "Titular", documentoTipo: "passaporte", documento: "doc-h1", nascimento: "1990-01-01", nacionalidade: "BR",
    telefone: "11999990000", endereco: { logradouro: "Rua A", cidade: "Recife", uf: "PE", pais: "BR" },
  }, "u1");
  await entrarComo(ctx, "recepcao");
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "teste-recepcao").executeTakeFirstOrThrow();
  recepcao = (await carregarUsuarioSessao(ctx, l.id))!;
  await abrirCaixa(ctx, recepcao.id, 0);
  dados = { titularId: "h1", categoriaId: std, chegada: "2026-11-10", saida: "2026-11-13", adultos: 2, criancasNascimento: [], canal: "Balcão" };
});

async function hospedar(d: NovaReserva, quartoId = q101) {
  const r = await criarReserva(ctx, d, recepcao);
  await fazerCheckin(ctx, { reservaId: r.id, quartoId, acompanhantes: [] }, recepcao);
  return r;
}
const pagamentos = () => ctx.db.selectFrom("pagamentos").selectAll().execute();
const situacaoConta = async (id: string) =>
  (await ctx.db.selectFrom("contas").select("situacao").where("id", "=", id).executeTakeFirstOrThrow()).situacao;

describe("check-out", () => {
  test("pagamento dividido zera o saldo e finaliza", async () => {
    const r = await hospedar(dados);
    await lancar(ctx, { contaId: r.contaId, reservaId: r.id, tipo: "extra", origem: "hospedagem", descricao: "Lavanderia", quantidade: 1, valorUnitario: 5000 }, recepcao.id);
    ctx.relogio.definir(as("2026-11-13", "11:00"));
    const previa = await previaCheckout(ctx, r.id);
    expect(previa.saldo).toBe(95000);
    expect(previa.saidaAntecipada).toBe(false);
    expect(previa.lateCheckout).toBeUndefined();
    await fazerCheckout(ctx, { reservaId: r.id, pagamentos: [{ formaCodigo: "pix", valor: 50000 }, { formaCodigo: "credito", valor: 45000 }] }, recepcao);
    expect((await obterReserva(ctx, r.id)).estado).toBe("finalizada");
    expect((await obterQuarto(ctx, q101)).situacao).toBe("sujo");
    expect(await situacaoConta(r.contaId)).toBe("fechada");
    expect((await saldo(ctx, r.contaId)).saldo).toBe(0);
    const tipos = (await ctx.db.selectFrom("outbox").select("tipo").execute()).map((e) => e.tipo);
    expect(tipos).toContain("hospedagem.CheckoutConcluido");
    const aud = await ctx.db.selectFrom("auditoria").select("acao").where("alvo_id", "=", r.id).execute();
    expect(aud.map((a) => a.acao)).toContain("reserva.checkout");
  });

  test("saldo pendente impede o check-out sem gravar nada", async () => {
    const r = await hospedar(dados);
    ctx.relogio.definir(as("2026-11-13", "11:00"));
    const antes = (await extrato(ctx, r.contaId)).length;
    const erro = await fazerCheckout(ctx, { reservaId: r.id, pagamentos: [{ formaCodigo: "pix", valor: 10000 }] }, recepcao).catch((e) => e);
    expect(erro).toMatchObject({ codigo: "SALDO_PENDENTE", detalhes: { saldo: 80000 } });
    expect((await obterReserva(ctx, r.id)).estado).toBe("hospedada");
    expect(await pagamentos()).toHaveLength(0);
    expect((await extrato(ctx, r.contaId)).length).toBe(antes); // nenhuma diária nova
    expect((await obterQuarto(ctx, q101)).situacao).toBe("ocupado");
    // pagamento a mais também é saldo pendente
    await expect(fazerCheckout(ctx, { reservaId: r.id, pagamentos: [{ formaCodigo: "pix", valor: 95000 }] }, recepcao))
      .rejects.toMatchObject({ codigo: "SALDO_PENDENTE", detalhes: { saldo: -5000 } });
    expect(await pagamentos()).toHaveLength(0);
  });

  test("só reserva hospedada; estadia excedida exige prorrogação", async () => {
    const r = await criarReserva(ctx, dados, recepcao);
    await expect(fazerCheckout(ctx, { reservaId: r.id, pagamentos: [] }, recepcao)).rejects.toMatchObject({ codigo: "RESERVA_NAO_HOSPEDADA" });
    await fazerCheckin(ctx, { reservaId: r.id, quartoId: q101, acompanhantes: [] }, recepcao);
    ctx.relogio.definir(as("2026-11-14", "11:00"));
    await expect(fazerCheckout(ctx, { reservaId: r.id, pagamentos: [] }, recepcao)).rejects.toMatchObject({ codigo: "ESTADIA_EXCEDIDA" });
  });

  test("faturado gera valor a receber", async () => {
    const r = await hospedar(dados);
    ctx.relogio.definir(as("2026-11-13", "11:00"));
    await fazerCheckout(ctx, {
      reservaId: r.id, pagamentos: [{ formaCodigo: "pix", valor: 40000 }],
      faturado: { nome: "Empresa X", documento: "12345678000199", valor: 50000 },
    }, recepcao);
    const v = await ctx.db.selectFrom("valores_a_receber").selectAll().execute();
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ conta_id: r.contaId, reserva_id: r.id, responsavel_nome: "Empresa X", responsavel_documento: "12345678000199", valor: 50000, situacao: "aberto" });
    expect((await pagamentos()).map((p) => p.forma_codigo).sort()).toEqual(["faturado", "pix"]);
    expect(await ctx.db.selectFrom("outbox").select("tipo").where("tipo", "=", "hospedagem.ValorAReceberCriado").execute()).toHaveLength(1);
    expect((await obterReserva(ctx, r.id)).estado).toBe("finalizada");
  });

  test("faturado exige a forma ativa e desfaz tudo", async () => {
    const r = await hospedar(dados);
    await ativarForma(ctx, "faturado", false, "u1");
    ctx.relogio.definir(as("2026-11-13", "11:00"));
    await expect(fazerCheckout(ctx, {
      reservaId: r.id, pagamentos: [{ formaCodigo: "pix", valor: 40000 }], faturado: { nome: "X", documento: "1", valor: 50000 },
    }, recepcao)).rejects.toMatchObject({ codigo: "FORMA_INATIVA" });
    expect(await pagamentos()).toHaveLength(0);
    expect(await ctx.db.selectFrom("valores_a_receber").selectAll().execute()).toHaveLength(0);
  });

  test("Review Focus 4: saída antecipada cobra só as noites usadas", async () => {
    const r = await hospedar({ ...dados, chegada: "2026-11-10", saida: "2026-11-15" });
    ctx.relogio.definir(as("2026-11-12", "11:00"));
    const previa = await previaCheckout(ctx, r.id);
    expect(previa.saidaAntecipada).toBe(true);
    expect(previa.saldo).toBe(60000);
    expect((await obterReserva(ctx, r.id)).noites).toHaveLength(5); // a prévia não grava
    await fazerCheckout(ctx, { reservaId: r.id, pagamentos: [{ formaCodigo: "pix", valor: 60000 }] }, recepcao);
    const diarias = await ctx.db.selectFrom("lancamentos").select("data_ref").where("tipo", "=", "diaria").orderBy("data_ref").execute();
    expect(diarias.map((d) => d.data_ref)).toEqual(["2026-11-10", "2026-11-11"]);
    const d = await obterReserva(ctx, r.id);
    expect(d.saida).toBe("2026-11-12");
    expect(d.noites.map((n) => n.data)).toEqual(["2026-11-10", "2026-11-11"]);
    const aud = await ctx.db.selectFrom("auditoria").select("acao").where("alvo_id", "=", r.id).execute();
    expect(aud.map((a) => a.acao)).toContain("reserva.saida_antecipada");
  });

  test("late checkout após o horário (fixo e percentual)", async () => {
    await salvarConfig(ctx, { lateCheckout: { tipo: "fixo", valor: 7000 } }, "u1");
    const r = await hospedar(dados);
    ctx.relogio.definir(as("2026-11-13", "13:00"));
    const previa = await previaCheckout(ctx, r.id);
    expect(previa.lateCheckout).toBe(7000);
    expect(previa.saldo).toBe(97000);
    await fazerCheckout(ctx, { reservaId: r.id, pagamentos: [{ formaCodigo: "pix", valor: 97000 }] }, recepcao);
    const ex = await extrato(ctx, r.contaId);
    expect(ex.find((l) => l.descricao === "Late check-out")?.valor).toBe(7000);

    // percentual da última diária, dispensável com cobrarLateCheckout=false
    await salvarConfig(ctx, { lateCheckout: { tipo: "percentual_diaria", valor: 50 } }, "u1");
    ctx.relogio.definir("2026-12-10T15:00:00Z");
    const r2 = await hospedar({ ...dados, chegada: "2026-12-10", saida: "2026-12-12" }, q102);
    ctx.relogio.definir(as("2026-12-12", "12:30"));
    expect((await previaCheckout(ctx, r2.id)).lateCheckout).toBe(15000);
    await fazerCheckout(ctx, { reservaId: r2.id, pagamentos: [{ formaCodigo: "pix", valor: 60000 }], cobrarLateCheckout: false }, recepcao);
    expect((await obterReserva(ctx, r2.id)).estado).toBe("finalizada");
  });

  test("sem taxa configurada não há late checkout", async () => {
    const r = await hospedar(dados);
    ctx.relogio.definir(as("2026-11-13", "13:00")); // taxa padrão 0
    const previa = await previaCheckout(ctx, r.id);
    expect(previa.lateCheckout).toBeUndefined();
    expect(previa.saldo).toBe(90000);
  });

  test("grupo com conta única: só o último quarto exige saldo zero", async () => {
    const g = await criarGrupo(ctx, { titularId: "h1", cobranca: "unica" }, recepcao);
    const a = await hospedar({ ...dados, grupoId: g.id }, q101);
    const b = await hospedar({ ...dados, grupoId: g.id }, q102);
    expect(a.contaId).toBe(b.contaId);
    ctx.relogio.definir(as("2026-11-13", "11:00"));
    await fazerCheckout(ctx, { reservaId: a.id, pagamentos: [] }, recepcao); // saldo em aberto, mas há outro quarto
    expect((await obterReserva(ctx, a.id)).estado).toBe("finalizada");
    expect((await obterQuarto(ctx, q101)).situacao).toBe("sujo");
    expect(await situacaoConta(a.contaId)).toBe("aberta");
    await expect(fazerCheckout(ctx, { reservaId: b.id, pagamentos: [{ formaCodigo: "pix", valor: 1000 }] }, recepcao))
      .rejects.toMatchObject({ codigo: "SALDO_PENDENTE", detalhes: { saldo: 179000 } });
    await fazerCheckout(ctx, { reservaId: b.id, pagamentos: [{ formaCodigo: "pix", valor: 180000 }] }, recepcao);
    expect(await situacaoConta(a.contaId)).toBe("fechada");
  });
});

describe("rotas", () => {
  test("exigem hospedagem.checkout e validam o corpo", async () => {
    const app = criarApp(ctx);
    const rec = await entrarComo(ctx, "recepcao");
    const gov = await entrarComo(ctx, "governanca");
    const r = await hospedar(dados);
    ctx.relogio.definir(as("2026-11-13", "11:00"));
    const url = `/api/reservas/${r.id}/checkout`;
    expect((await app.inject({ method: "GET", url, headers: gov })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: gov, payload: { pagamentos: [] } })).statusCode).toBe(403);
    const previa = await app.inject({ method: "GET", url, headers: rec });
    expect(previa.statusCode).toBe(200);
    expect(previa.json().saldo).toBe(90000);
    expect((await app.inject({ method: "POST", url, headers: rec, payload: { pagamentos: [{ formaCodigo: "pix", valor: 0 }] } })).statusCode).toBe(400);
    const pend = await app.inject({ method: "POST", url, headers: rec, payload: { pagamentos: [] } });
    expect(pend.statusCode).toBe(422);
    expect(pend.json().codigo).toBe("SALDO_PENDENTE");
    const ok = await app.inject({ method: "POST", url, headers: rec, payload: { pagamentos: [{ formaCodigo: "pix", valor: 90000 }] } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().estado).toBe("finalizada");
  });
});
