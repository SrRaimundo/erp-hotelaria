import { describe, expect, test } from "vitest";
import { semearDemonstracao } from "../src/demo.js";
import { painelDoDia } from "../src/hospedagem/consultas.js";
import { listarReservas } from "../src/hospedagem/lista-reservas.js";
import { entrar } from "../src/nucleo/sessoes.js";
import { turnoAberto } from "../src/nucleo/caixa.js";
import { listaGovernanca } from "../src/hospedagem/governanca.js";
import { obterConfig } from "../src/nucleo/pousada.js";
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

  test("demonstração cria chamados, frigobar e arrumações", async () => {
    const ctx = await criarContextoTeste();
    await semearDemonstracao(ctx);
    const p = await painelDoDia(ctx);
    expect(p.chamadosAbertos.map((c) => [c.quartoNumero, c.tipo, c.descricao]).sort()).toEqual([
      ["204", "defeito", "Ar-condicionado não funciona"],
      ["204", "reposicao", "Controle da TV faltando"],
    ]);
    expect(p.numeros.defeitosAbertos).toBe(1);
    expect(p.governanca.find((g) => g.situacao === "bloqueado")).toMatchObject({ numero: "204", motivo: "Ar-condicionado não funciona" });
    expect(p.numeros.ocupadosSemArrumacao).toBe(2);

    const lista = await listaGovernanca(ctx);
    expect(lista.filter((i) => i.arrumadoHojeEm).map((i) => i.numero)).toEqual(["101", "102"]);
    expect(lista.find((i) => i.numero === "204")).toMatchObject({ situacao: "bloqueado", chamadosAbertos: 2 });

    const produtos = await ctx.db.selectFrom("produtos").select(["id", "nome", "preco_centavos"]).orderBy("nome").execute();
    expect(produtos.filter((x) => ["Água mineral", "Cerveja", "Chocolate", "Refrigerante"].includes(x.nome)).map((x) => [x.nome, x.preco_centavos]).sort((x, y) => String(x[0]).localeCompare(String(y[0]), "pt-BR"))).toEqual([["Água mineral", 600], ["Cerveja", 1200], ["Chocolate", 900], ["Refrigerante", 800]]);
    const setores = await ctx.db.selectFrom("produto_setores").select("setor").where("produto_id", "=", produtos.find((x) => x.nome === "Água mineral")!.id).orderBy("setor").execute();
    expect(setores.map((s) => s.setor)).toEqual(["bar", "frigobar", "recepcao"]);
    expect((await obterConfig(ctx)).camareiraLancaFrigobar).toBe(true);

    const mov = await ctx.db.selectFrom("frigobar_movimentos").select(["tipo", "quantidade", "lancamento_id"]).orderBy("tipo").execute();
    expect(mov).toHaveLength(2);
    const consumo = mov.find((m) => m.tipo === "consumo")!;
    expect(consumo.quantidade).toBe(1);
    const lanc = await ctx.db.selectFrom("lancamentos").select(["descricao", "quantidade", "valor", "setor"]).where("id", "=", consumo.lancamento_id!).executeTakeFirstOrThrow();
    expect(lanc).toMatchObject({ descricao: "Água mineral", quantidade: 1, valor: 600, setor: "frigobar" });
    const saidaOntem = await ctx.db.selectFrom("checklist_execucoes").select(["resultado", "motivo", "concluido_em"]).where("tipo", "=", "saida").executeTakeFirstOrThrow();
    expect(saidaOntem).toMatchObject({ resultado: "bloqueado", motivo: "Ar-condicionado não funciona" });
    expect(saidaOntem.concluido_em < p.dia).toBe(true);
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
