import { beforeEach, describe, expect, test } from "vitest";
import { concluirChecklist, type RespostaEnviada } from "../../src/governanca/checklists.js";
import { obterModelos, type ItemChecklist } from "../../src/governanca/modelos.js";
import { fazerCheckin } from "../../src/hospedagem/checkin.js";
import { painelDoDia } from "../../src/hospedagem/consultas.js";
import { listaGovernanca } from "../../src/hospedagem/governanca.js";
import { criarReserva, obterReserva } from "../../src/hospedagem/reservas.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { salvarConfig } from "../../src/nucleo/pousada.js";
import { criarQuarto, mudarSituacaoQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let std: string;
let q: Record<string, string>;
let saida: ItemChecklist[];
let diaria: ItemChecklist[];
let recepcao: UsuarioSessao;
let governanca: UsuarioSessao;
const INICIO = "2026-11-10T14:30:00Z";

async function usuario(perfil: "recepcao" | "governanca"): Promise<UsuarioSessao> {
  await entrarComo(ctx, perfil);
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", `teste-${perfil}`).executeTakeFirstOrThrow();
  return (await carregarUsuarioSessao(ctx, l.id))!;
}

function respostas(itens: ItemChecklist[], sobre: Record<string, Partial<RespostaEnviada>> = {}): RespostaEnviada[] {
  return itens.map((i): RespostaEnviada => {
    const base: RespostaEnviada =
      i.etapa === "limpeza" ? { itemId: i.id, simNao: true }
      : i.etapa === "enxoval" ? { itemId: i.id, quantidade: 1 }
      : i.etapa === "equipamento" ? { itemId: i.id, equipamento: "funciona" }
      : { itemId: i.id, presenca: "presente" };
    return { ...base, ...(sobre[i.texto] ?? {}) };
  });
}

async function hospedar(quartoId: string) {
  ctx.relogio.definir("2026-11-10T18:00:00Z");
  const r = await criarReserva(ctx, { titularId: "h1", categoriaId: std, chegada: "2026-11-10", saida: "2026-11-12", adultos: 1, criancasNascimento: [], canal: "Balcão" }, recepcao);
  await fazerCheckin(ctx, { reservaId: r.id, quartoId, acompanhantes: [] }, recepcao);
  return r;
}

const arrumar = (quartoId: string) => concluirChecklist(ctx, quartoId, { tipo: "diaria", iniciadoEm: INICIO, respostas: respostas(diaria) }, governanca);

async function sujar(quartoId: string) {
  await mudarSituacaoQuarto(ctx, quartoId, "em_manutencao", "u1");
  await mudarSituacaoQuarto(ctx, quartoId, "sujo", "u1");
}

beforeEach(async () => {
  ctx = await criarContextoTeste();
  std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  q = {};
  for (const numero of ["103", "104", "105", "201"]) q[numero] = (await criarQuarto(ctx, { numero, categoriaId: std }, "u1")).id;
  await salvarConfig(ctx, { sinal: { exigir: false, tipo: "percentual", percentual: 30, prazoHoras: 24, toleranciaHoras: 2 } }, "u1");
  await salvarHospede(ctx, {
    id: "h1", nome: "Titular", documentoTipo: "passaporte", documento: "doc-h1", nascimento: "1990-01-01", nacionalidade: "BR",
    telefone: "11999990000", endereco: { logradouro: "Rua A", cidade: "Recife", uf: "PE", pais: "BR" },
  }, "u1");
  const m = await obterModelos(ctx);
  saida = m.saida;
  diaria = m.diaria;
  recepcao = await usuario("recepcao");
  governanca = await usuario("governanca");
});

async function cenario() {
  await sujar(q["103"]!);
  const r104 = await hospedar(q["104"]!);
  await hospedar(q["105"]!);
  await arrumar(q["104"]!);
  await sujar(q["201"]!);
  await concluirChecklist(ctx, q["201"]!, {
    tipo: "saida", iniciadoEm: INICIO, respostas: respostas(saida, { "Ar-condicionado": { equipamento: "nao_funciona" } }),
    resultado: "bloqueado", motivo: "Ar-condicionado não funciona",
  }, governanca);
  return r104;
}

describe("consultas de governança", () => {
  test("lista de governança com tarefas e ordem", async () => {
    await cenario();
    const lista = await listaGovernanca(ctx);
    expect(lista.map((i) => i.numero)).toEqual(["103", "105", "201", "104"]);
    expect(lista.map((i) => i.tarefa)).toEqual(["limpeza_saida", "arrumacao", null, null]);
    const por = (n: string) => lista.find((i) => i.numero === n)!;
    expect(por("201")).toMatchObject({ situacao: "bloqueado", motivoBloqueio: "Ar-condicionado não funciona", chamadosAbertos: 1, arrumadoHojeEm: null });
    expect(por("104").arrumadoHojeEm).toBe("2026-11-10T18:00:00.000Z");
    expect(por("104")).toMatchObject({ motivoBloqueio: null, chamadosAbertos: 0 });
    expect(por("103")).toMatchObject({ motivoBloqueio: null, arrumadoHojeEm: null });
  });

  test("arrumação de ontem não conta como arrumado hoje", async () => {
    await hospedar(q["104"]!);
    await arrumar(q["104"]!);
    ctx.relogio.definir("2026-11-11T18:00:00Z");
    const item = (await listaGovernanca(ctx)).find((i) => i.numero === "104")!;
    expect(item).toMatchObject({ tarefa: "arrumacao", arrumadoHojeEm: null });
  });

  test("painel traz chamados abertos e ocupados sem arrumação", async () => {
    await cenario();
    const p = await painelDoDia(ctx);
    expect(p.chamadosAbertos).toHaveLength(1);
    expect(p.chamadosAbertos[0]).toMatchObject({ quartoNumero: "201", tipo: "defeito", descricao: "Ar-condicionado não funciona", situacao: "aberto" });
    expect(p.numeros.ocupadosSemArrumacao).toBe(1);
    expect(p.numeros.defeitosAbertos).toBe(1);
    expect(p.governanca.find((g) => g.numero === "201")).toMatchObject({ situacao: "bloqueado", motivo: "Ar-condicionado não funciona" });
  });

  test("reserva mostra a última arrumação de hoje", async () => {
    const r104 = await cenario();
    expect((await obterReserva(ctx, r104.id)).ultimaArrumacao).toEqual({ em: "2026-11-10T18:00:00.000Z", por: "Teste governanca" });
    const outra = await ctx.db.selectFrom("reservas").select("id").where("quarto_id", "=", q["105"]!).executeTakeFirstOrThrow();
    expect((await obterReserva(ctx, outra.id)).ultimaArrumacao).toBeNull();
    ctx.relogio.definir("2026-11-11T18:00:00Z");
    expect((await obterReserva(ctx, r104.id)).ultimaArrumacao).toBeNull();
  });
});
