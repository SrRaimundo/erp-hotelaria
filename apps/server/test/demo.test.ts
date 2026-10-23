import { describe, expect, test } from "vitest";
import { semearDemonstracao } from "../src/demo.js";
import { painelDoDia } from "../src/hospedagem/consultas.js";
import { listarReservas } from "../src/hospedagem/lista-reservas.js";
import { entrar } from "../src/nucleo/sessoes.js";
import { turnoAberto } from "../src/nucleo/caixa.js";
import { saldo } from "../src/hospedagem/conta.js";
import { criarContextoTeste } from "./ajuda.js";

describe("pousada de demonstração", () => {
  test("povoa a pousada relativa ao dia", async () => {
    const ctx = await criarContextoTeste();
    const r = await semearDemonstracao(ctx);
    expect(r.quartos).toBe(12);
    expect(r.reservas).toBe(17);

    const p = await painelDoDia(ctx);
    expect(p.chegadas.length).toBeGreaterThanOrEqual(3);
    expect(p.atencao.some((a) => a.tipo === "sinal_vencendo")).toBe(true);
    expect(p.atencao.some((a) => a.tipo === "chegada_atrasada")).toBe(true);
    expect(p.hospedados).toBe(4);
    expect(p.saidas).toHaveLength(1);
    expect(p.saidas[0]!.saldo).toBeGreaterThan(0);
    expect(p.chegadas.some((c) => c.pendenciasFnrh)).toBe(true);
    expect(p.quartosSujos.map((q) => q.numero)).toEqual(["103"]);
    expect(p.governanca.find((g) => g.situacao === "em_manutencao")).toMatchObject({ numero: "106", motivo: "chuveiro" });
  });

  test("estados consistentes: hospedadas ocupam quarto e têm diárias lançadas; sem caixa aberto; logins válidos", async () => {
    const ctx = await criarContextoTeste();
    await semearDemonstracao(ctx);
    const hospedadas = await ctx.db.selectFrom("reservas").select(["id", "quarto_id", "conta_id", "chegada"]).where("estado", "=", "hospedada").execute();
    expect(hospedadas).toHaveLength(4);
    for (const h of hospedadas) {
      const q = await ctx.db.selectFrom("quartos").select("situacao").where("id", "=", h.quarto_id!).executeTakeFirstOrThrow();
      expect(q.situacao).toBe("ocupado");
      const diarias = await ctx.db.selectFrom("lancamentos").select("id").where("reserva_id", "=", h.id).where("tipo", "=", "diaria").execute();
      expect(diarias.length).toBeGreaterThanOrEqual(1);
      expect((await saldo(ctx, h.conta_id)).saldo).toBeGreaterThan(0);
    }
    const grupo = await ctx.db.selectFrom("reservas").select("conta_id").where("grupo_id", "is not", null).execute();
    expect(grupo).toHaveLength(2);
    expect(grupo[0]!.conta_id).toBe(grupo[1]!.conta_id);
    expect((await listarReservas(ctx, {})).itens.length).toBeGreaterThan(0);

    const admin = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", "admin").executeTakeFirstOrThrow();
    expect(await turnoAberto(ctx, admin.id)).toBeNull();
    expect((await entrar(ctx, "admin", "admin")).usuario.trocarSenha).toBe(true);
    expect((await entrar(ctx, "recepcao", "recepcao123")).usuario).toMatchObject({ perfil: "recepcao", trocarSenha: false });
    expect((await entrar(ctx, "governanca", "governanca123")).usuario.perfil).toBe("governanca");
    const hospedes = await ctx.db.selectFrom("hospedes").select("id").execute();
    expect(hospedes).toHaveLength(15);
  });

  test("demonstração recusa base com dados", async () => {
    const ctx = await criarContextoTeste();
    await semearDemonstracao(ctx);
    await expect(semearDemonstracao(ctx)).rejects.toMatchObject({ codigo: "BASE_NAO_VAZIA" });
  });
});
