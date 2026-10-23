import { describe, expect, test, vi } from "vitest";
import { iniciarAgendador } from "../../src/agendador.js";
import { criarApp } from "../../src/http/app.js";
import { processarSinais } from "../../src/hospedagem/sinal.js";
import { processarVirada } from "../../src/hospedagem/virada.js";
import { criarContextoTeste } from "../ajuda.js";

vi.mock("../../src/hospedagem/sinal.js", async (original) => {
  const m = await original<typeof import("../../src/hospedagem/sinal.js")>();
  return { ...m, processarSinais: vi.fn(m.processarSinais) };
});
vi.mock("../../src/hospedagem/virada.js", async (original) => {
  const m = await original<typeof import("../../src/hospedagem/virada.js")>();
  return { ...m, processarVirada: vi.fn(m.processarVirada) };
});

describe("ponta a ponta", () => {
  test("fluxo completo de uma estadia", async () => {
    // 2026-11-10 09:00 local (UTC-3)
    const ctx = await criarContextoTeste("2026-11-10T12:00:00Z");
    const app = criarApp(ctx);
    const agendador = iniciarAgendador(ctx, 3_600_000);
    await agendador.tick();

    const chamar = async (metodo: "GET" | "POST" | "PUT", url: string, payload?: object) => {
      const r = await app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload });
      expect(r.statusCode, `${metodo} ${url}: ${r.body}`).toBeLessThan(300);
      expect(r.statusCode).toBeGreaterThanOrEqual(200);
      return r.json();
    };
    let token = "";
    token = (await chamar("POST", "/api/sessoes", { login: "admin", senha: "admin" })).token;

    await chamar("PUT", "/api/config", { sinal: { exigir: true, tipo: "percentual", percentual: 30, prazoHoras: 48, toleranciaHoras: 2 } });
    const categoria = await chamar("POST", "/api/categorias", { nome: "Standard", maxAdultos: 3, maxCriancas: 1 });
    const quarto = await chamar("POST", "/api/quartos", { numero: "12", categoriaId: categoria.id });
    await chamar("PUT", "/api/tarifas/tabelas-base", { categoriaId: categoria.id, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 });
    const hospede = await chamar("POST", "/api/hospedes", {
      nome: "Maria da Silva", documentoTipo: "cpf", documento: "529.982.247-25", nascimento: "1985-03-20", nacionalidade: "BR",
      telefone: "81999990000", endereco: { logradouro: "Rua das Flores, 10", cidade: "Recife", uf: "PE", pais: "BR" },
    });

    const reserva = await chamar("POST", "/api/reservas", {
      titularId: hospede.id, categoriaId: categoria.id, chegada: "2026-11-11", saida: "2026-11-12", adultos: 2, canal: "Balcão",
    });
    expect(reserva.estado).toBe("pre_reserva");
    expect(reserva.valorSinal).toBe(9000);

    await chamar("POST", "/api/caixa/abrir", { valorInicial: 0 });
    await chamar("POST", `/api/contas/${reserva.contaId}/pagamentos`, { reservaId: reserva.id, formaCodigo: "pix", valor: reserva.valorSinal });
    expect((await chamar("GET", `/api/reservas/${reserva.id}`)).estado).toBe("confirmada");

    // dia da chegada, 15:00 local
    ctx.relogio.definir("2026-11-11T18:00:00Z");
    const comCheckin = await chamar("POST", `/api/reservas/${reserva.id}/checkin`, { quartoId: quarto.id });
    expect(comCheckin.estado).toBe("hospedada");

    // virada do dia (04:00 local do dia 12) pelo agendador
    ctx.relogio.definir("2026-11-12T07:00:00Z");
    await agendador.tick();
    const conta = await chamar("GET", `/api/contas/${reserva.contaId}`);
    expect(conta.extrato.filter((l: any) => l.tipo === "diaria")).toHaveLength(1);
    expect(conta.saldo.saldo).toBe(21000);

    const final = await chamar("POST", `/api/reservas/${reserva.id}/checkout`, { pagamentos: [{ formaCodigo: "pix", valor: conta.saldo.saldo }] });
    expect(final.estado).toBe("finalizada");
    const quartos = await chamar("GET", "/api/quartos");
    expect(quartos.find((q: any) => q.id === quarto.id).situacao).toBe("sujo");

    const eventos = (await ctx.db.selectFrom("outbox").select("tipo").orderBy("seq").execute()).map((e) => e.tipo);
    const posicoes = ["ReservaCriada", "ReservaConfirmada", "CheckinConcluido", "CheckoutConcluido"].map((nome) => {
      const i = eventos.findIndex((t) => t.endsWith(`.${nome}`));
      expect(i, `evento ${nome} em ${eventos.join(",")}`).toBeGreaterThanOrEqual(0);
      return i;
    });
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));

    const caixa = await chamar("POST", "/api/caixa/fechar", { contados: { pix: 30000 } });
    expect(caixa.porForma.length).toBeGreaterThan(0);
    for (const f of caixa.porForma) expect(f.diferenca, f.forma).toBe(0);
    agendador.parar();
  });

  test("agendador: erro num job não impede o outro", async () => {
    const ctx = await criarContextoTeste();
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(processarSinais).mockClear();
    vi.mocked(processarVirada).mockClear();
    vi.mocked(processarSinais).mockRejectedValueOnce(new Error("falha simulada"));
    const agendador = iniciarAgendador(ctx, 3_600_000);
    await agendador.tick(); // o tick inicial ainda em andamento
    agendador.parar();
    expect(processarVirada).toHaveBeenCalled();
    expect(processarSinais).toHaveBeenCalledTimes(1);
    expect(processarVirada).toHaveBeenCalledTimes(1);
    expect(erro).toHaveBeenCalledTimes(1);
    erro.mockRestore();
  });
});
