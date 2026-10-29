import { beforeEach, describe, expect, test } from "vitest";
import { alertasAbertos } from "../../src/infra/alertas.js";
import { concluirChecklist, type RespostaEnviada } from "../../src/governanca/checklists.js";
import { lancarFrigobar } from "../../src/governanca/frigobar.js";
import { abrirChamado, avisarControleFaltando, cancelarChamado, listarChamados, resolverChamado } from "../../src/governanca/chamados.js";
import { obterModelos, type ItemChecklist } from "../../src/governanca/modelos.js";
import { fazerCheckin } from "../../src/hospedagem/checkin.js";
import { extrato } from "../../src/hospedagem/conta.js";
import { criarReserva } from "../../src/hospedagem/reservas.js";
import { criarApp } from "../../src/http/app.js";
import { criarCategoria } from "../../src/nucleo/categorias.js";
import { salvarHospede } from "../../src/nucleo/hospedes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { salvarConfig } from "../../src/nucleo/pousada.js";
import { criarProduto } from "../../src/nucleo/produtos.js";
import { criarQuarto, mudarSituacaoQuarto, obterQuarto } from "../../src/nucleo/quartos.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { emTransacao } from "../../src/shared/contexto.js";
import { salvarTabelaBase } from "../../src/tarifas/regras.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let std: string;
let q101: string;
let q102: string;
let saida: ItemChecklist[];
let diaria: ItemChecklist[];
let agua: string;
let refri: string;
let cerveja: string;
let recepcao: UsuarioSessao;
let governanca: UsuarioSessao;
const INICIO = "2026-11-10T14:30:00Z";

async function usuario(perfil: "recepcao" | "governanca"): Promise<UsuarioSessao> {
  await entrarComo(ctx, perfil);
  const l = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", `teste-${perfil}`).executeTakeFirstOrThrow();
  return (await carregarUsuarioSessao(ctx, l.id))!;
}

function respostasOk(itens: ItemChecklist[], sobre: Record<string, Partial<RespostaEnviada>> = {}): RespostaEnviada[] {
  return itens.map((i): RespostaEnviada => {
    const base: RespostaEnviada =
      i.etapa === "limpeza" ? { itemId: i.id, simNao: true }
      : i.etapa === "enxoval" ? { itemId: i.id, quantidade: 1 }
      : i.etapa === "equipamento" ? { itemId: i.id, equipamento: "funciona" }
      : { itemId: i.id, presenca: "presente" };
    return { ...base, ...(sobre[i.texto] ?? {}) };
  });
}
const idDe = (itens: ItemChecklist[], texto: string) => itens.find((i) => i.texto === texto)!.id;

async function sujar(quartoId: string) {
  await mudarSituacaoQuarto(ctx, quartoId, "em_manutencao", "u1");
  await mudarSituacaoQuarto(ctx, quartoId, "sujo", "u1");
}

async function hospedar(quartoId: string) {
  ctx.relogio.definir("2026-11-10T18:00:00Z");
  const r = await criarReserva(ctx, { titularId: "h1", categoriaId: std, chegada: "2026-11-10", saida: "2026-11-12", adultos: 1, criancasNascimento: [], canal: "Balcão" }, recepcao);
  await fazerCheckin(ctx, { reservaId: r.id, quartoId, acompanhantes: [] }, recepcao);
  return r;
}

type Pedido = Parameters<typeof concluirChecklist>[2];
const concluirSaida = (quartoId: string, d: Partial<Pedido> = {}) =>
  concluirChecklist(ctx, quartoId, { tipo: "saida", iniciadoEm: INICIO, respostas: respostasOk(saida), resultado: "liberado", ...d }, governanca);
const concluirDiaria = (quartoId: string, d: Partial<Pedido> = {}) =>
  concluirChecklist(ctx, quartoId, { tipo: "diaria", iniciadoEm: INICIO, respostas: respostasOk(diaria), ...d }, governanca);

const contagem = async (tabela: string) => Number((await ctx.db.selectFrom(tabela as any).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow()).n);

beforeEach(async () => {
  ctx = await criarContextoTeste();
  std = (await criarCategoria(ctx, { nome: "Standard", maxAdultos: 3, maxCriancas: 1, comodidades: [] }, "u1")).id;
  await salvarTabelaBase(ctx, { categoriaId: std, porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 }, "u1");
  q101 = (await criarQuarto(ctx, { numero: "101", categoriaId: std }, "u1")).id;
  q102 = (await criarQuarto(ctx, { numero: "102", categoriaId: std }, "u1")).id;
  await salvarConfig(ctx, { sinal: { exigir: false, tipo: "percentual", percentual: 30, prazoHoras: 24, toleranciaHoras: 2 } }, "u1");
  await salvarHospede(ctx, {
    id: "h1", nome: "Titular", documentoTipo: "passaporte", documento: "doc-h1", nascimento: "1990-01-01", nacionalidade: "BR",
    telefone: "11999990000", endereco: { logradouro: "Rua A", cidade: "Recife", uf: "PE", pais: "BR" },
  }, "u1");
  const base = { unidade: "un", grupo: "bebidas", tipo: "produto" as const };
  agua = (await criarProduto(ctx, { ...base, codigo: "AGUA", nome: "Água mineral", precoCentavos: 600, setores: ["frigobar", "recepcao"] }, "u1")).id;
  refri = (await criarProduto(ctx, { ...base, codigo: "REFRI", nome: "Refrigerante", precoCentavos: 800, setores: ["frigobar"] }, "u1")).id;
  cerveja = (await criarProduto(ctx, { ...base, codigo: "CERV", nome: "Cerveja", precoCentavos: 1200, setores: ["bar"] }, "u1")).id;
  const m = await obterModelos(ctx);
  saida = m.saida;
  diaria = m.diaria;
  recepcao = await usuario("recepcao");
  governanca = await usuario("governanca");
});

describe("checklist de saída", () => {
  test("saída liberada: quarto livre, respostas com texto copiado", async () => {
    await sujar(q101);
    const r = await concluirSaida(q101, { respostas: respostasOk(saida, { Toalhas: { quantidade: 3 }, TV: { equipamento: "nao_se_aplica" } }) });
    expect(r.totalFrigobar).toBe(0);
    expect((await obterQuarto(ctx, q101)).situacao).toBe("livre");
    const ex = await ctx.db.selectFrom("checklist_execucoes").selectAll().executeTakeFirstOrThrow();
    expect(ex).toMatchObject({ id: r.execucaoId, quarto_id: q101, tipo: "saida", reserva_id: null, usuario_id: governanca.id, iniciado_em: INICIO, concluido_em: "2026-11-10T15:00:00.000Z", resultado: "liberado", motivo: null });
    const rs = await ctx.db.selectFrom("checklist_respostas").selectAll().where("execucao_id", "=", r.execucaoId).execute();
    expect(rs).toHaveLength(saida.length);
    const toalhas = rs.find((x) => x.item_id === idDe(saida, "Toalhas"))!;
    expect(toalhas).toMatchObject({ etapa: "enxoval", texto_item: "Toalhas", quantidade: 3, sim_nao: null });
    expect(rs.find((x) => x.item_id === idDe(saida, "Banheiro limpo"))).toMatchObject({ etapa: "limpeza", texto_item: "Banheiro limpo", sim_nao: 1 });
    expect(rs.find((x) => x.item_id === idDe(saida, "TV"))).toMatchObject({ equipamento: "nao_se_aplica" });
    expect(rs.find((x) => x.item_id === idDe(saida, "Controle da TV"))).toMatchObject({ presenca: "presente" });
    const aud = await ctx.db.selectFrom("auditoria").select("acao").where("alvo_id", "=", r.execucaoId).execute();
    expect(aud.map((a) => a.acao)).toEqual(["checklist.concluir"]);
  });

  test("saída com limpeza 'Não' → LIMPEZA_INCOMPLETA para liberado; bloqueado com motivo funciona", async () => {
    await sujar(q101);
    const respostas = respostasOk(saida, { "Banheiro limpo": { simNao: false } });
    expect(await concluirSaida(q101, { respostas }).catch((e) => e)).toMatchObject({ codigo: "LIMPEZA_INCOMPLETA" });
    expect((await obterQuarto(ctx, q101)).situacao).toBe("sujo");
    expect(await contagem("checklist_execucoes")).toBe(0);
    await concluirSaida(q101, { respostas, resultado: "bloqueado", motivo: "Banheiro com infiltração" });
    expect((await obterQuarto(ctx, q101)).situacao).toBe("bloqueado");
  });

  test("saída liberada com defeito aberto → CHAMADO_ABERTO; com só reposição → libera", async () => {
    await sujar(q101);
    const defeito = await emTransacao(ctx, (tx) => abrirChamado(tx, { quartoId: q101, itemId: idDe(saida, "Ar-condicionado") }, governanca));
    const erro = await concluirSaida(q101).catch((e) => e);
    expect(erro).toMatchObject({ codigo: "CHAMADO_ABERTO" });
    expect((await obterQuarto(ctx, q101)).situacao).toBe("sujo");
    await cancelarChamado(ctx, defeito.id, governanca);
    const repo = await emTransacao(ctx, (tx) => abrirChamado(tx, { quartoId: q101, itemId: idDe(saida, "Controle da TV") }, governanca));
    await concluirSaida(q101, { respostas: respostasOk(saida, { "Controle da TV": { presenca: "faltando", chamadoId: repo.id } }) });
    expect((await obterQuarto(ctx, q101)).situacao).toBe("livre");
    expect(await listarChamados(ctx, { situacao: "aberto" })).toHaveLength(1);
  });

  test("bloqueado sem motivo → MOTIVO_OBRIGATORIO; com motivo: sujo → bloqueado e motivo auditado", async () => {
    await sujar(q101);
    for (const motivo of [undefined, "   "]) {
      expect(await concluirSaida(q101, { resultado: "bloqueado", motivo }).catch((e) => e)).toMatchObject({ codigo: "MOTIVO_OBRIGATORIO" });
    }
    expect(await concluirSaida(q101, { resultado: undefined }).catch((e) => e)).toMatchObject({ codigo: "RESULTADO_OBRIGATORIO" });
    const r = await concluirSaida(q101, { resultado: "bloqueado", motivo: " Ar-condicionado não funciona " });
    expect((await obterQuarto(ctx, q101)).situacao).toBe("bloqueado");
    const ex = await ctx.db.selectFrom("checklist_execucoes").selectAll().where("id", "=", r.execucaoId).executeTakeFirstOrThrow();
    expect(ex).toMatchObject({ resultado: "bloqueado", motivo: "Ar-condicionado não funciona" });
    const aud = await ctx.db.selectFrom("auditoria").select(["motivo", "dados"]).where("acao", "=", "quarto.situacao").where("alvo_id", "=", q101).orderBy("rowid", "desc").executeTakeFirstOrThrow();
    expect(aud.motivo).toBe("Ar-condicionado não funciona");
    expect(JSON.parse(aud.dados as string)).toMatchObject({ de: "sujo", para: "bloqueado" });
  });

  test("resposta faltando → RESPOSTA_FALTANDO; inválidas → RESPOSTA_INVALIDA", async () => {
    await sujar(q101);
    const sem = respostasOk(saida).slice(1);
    const erro = await concluirSaida(q101, { respostas: sem }).catch((e) => e);
    expect(erro).toMatchObject({ codigo: "RESPOSTA_FALTANDO" });
    expect(JSON.stringify(erro.detalhes)).toContain(saida[0].texto);
    const todas = respostasOk(saida);
    const invalidas: RespostaEnviada[][] = [
      [...todas, todas[0]],
      [...todas, { itemId: "inexistente", simNao: true }],
      [...todas.slice(1), { itemId: saida[0].id, quantidade: 1 }],
      [...todas.slice(1), { itemId: saida[0].id }],
      respostasOk(saida, { Toalhas: { quantidade: 1000 } }),
      respostasOk(saida, { Toalhas: { quantidade: -1 } }),
      respostasOk(saida, { Toalhas: { quantidade: 1.5 } }),
    ];
    for (const respostas of invalidas) {
      expect(await concluirSaida(q101, { respostas }).catch((e) => e)).toMatchObject({ codigo: "RESPOSTA_INVALIDA" });
    }
    for (const iniciadoEm of ["ontem", "2026-11-10T16:00:00Z"]) {
      expect(await concluirSaida(q101, { iniciadoEm }).catch((e) => e)).toMatchObject({ codigo: "RESPOSTA_INVALIDA" });
    }
    expect(await contagem("checklist_execucoes")).toBe(0);
  });

  test("defeito marcado offline (sem chamadoId) é criado na conclusão; com chamadoId usa o existente", async () => {
    await sujar(q101);
    const ar = idDe(saida, "Ar-condicionado");
    const tv = idDe(saida, "TV");
    const existente = await emTransacao(ctx, (tx) => abrirChamado(tx, { quartoId: q101, itemId: tv }, governanca));
    const respostas = respostasOk(saida, {
      "Ar-condicionado": { equipamento: "nao_funciona", observacao: "Não gela" },
      TV: { equipamento: "nao_funciona", chamadoId: existente.id },
      "Controle da TV": { presenca: "faltando" },
    });
    const r = await concluirSaida(q101, { respostas, resultado: "bloqueado", motivo: "Defeitos" });
    const abertos = await listarChamados(ctx, { quartoId: q101, situacao: "aberto" });
    expect(abertos.map((c) => `${c.tipo}:${c.descricao}`).sort()).toEqual(["defeito:Ar-condicionado não funciona", "defeito:TV não funciona", "reposicao:Controle da TV faltando"]);
    expect(abertos.find((c) => c.itemId === ar)).toMatchObject({ observacao: "Não gela", abertoPor: governanca.id });
    const rs = await ctx.db.selectFrom("checklist_respostas").select(["item_id", "chamado_id"]).where("execucao_id", "=", r.execucaoId).execute();
    expect(rs.find((x) => x.item_id === tv)!.chamado_id).toBe(existente.id);
    expect(rs.find((x) => x.item_id === ar)!.chamado_id).toBe(abertos.find((c) => c.itemId === ar)!.id);
    // defeito criado na mesma transação impede liberar, e nada fica gravado
    await sujar(q102);
    expect(await concluirSaida(q102, { respostas: respostasOk(saida, { TV: { equipamento: "nao_funciona" } }) }).catch((e) => e)).toMatchObject({ codigo: "CHAMADO_ABERTO" });
    expect(await listarChamados(ctx, { quartoId: q102 })).toHaveLength(0);
  });

  test("chamadoId cancelado nesse meio-tempo: o servidor cria um novo", async () => {
    await sujar(q101);
    const ar = idDe(saida, "Ar-condicionado");
    const c = await emTransacao(ctx, (tx) => abrirChamado(tx, { quartoId: q101, itemId: ar }, governanca));
    await cancelarChamado(ctx, c.id, governanca);
    await concluirSaida(q101, { respostas: respostasOk(saida, { "Ar-condicionado": { equipamento: "nao_funciona", chamadoId: c.id } }), resultado: "bloqueado", motivo: "x" });
    const abertos = await listarChamados(ctx, { quartoId: q101, situacao: "aberto" });
    expect(abertos).toHaveLength(1);
    expect(abertos[0].id).not.toBe(c.id);
  });

  test("quarto que não está sujo → QUARTO_NAO_SUJO", async () => {
    expect(await concluirSaida(q101).catch((e) => e)).toMatchObject({ codigo: "QUARTO_NAO_SUJO" });
  });

  test("Review Focus 2: duas conclusões de saída do mesmo quarto — a segunda recebe QUARTO_NAO_SUJO e só há uma execução", async () => {
    await sujar(q101);
    const [a, b] = await Promise.allSettled([concluirSaida(q101), concluirSaida(q101)]);
    const ok = [a, b].filter((r) => r.status === "fulfilled");
    const falha = [a, b].filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(falha).toHaveLength(1);
    expect(falha[0].reason).toMatchObject({ codigo: "QUARTO_NAO_SUJO" });
    expect(await contagem("checklist_execucoes")).toBe(1);
  });

  test("saída registra só reposição, sem lançamento na conta; produto fora do frigobar é recusado", async () => {
    await sujar(q101);
    expect(await concluirSaida(q101, { frigobar: [{ produtoId: cerveja, quantidade: 1 }] }).catch((e) => e)).toMatchObject({ codigo: "PRODUTO_NAO_FRIGOBAR" });
    expect(await contagem("checklist_execucoes")).toBe(0);
    const r = await concluirSaida(q101, { frigobar: [{ produtoId: agua, quantidade: 2 }, { produtoId: refri, quantidade: 0 }] });
    expect(r.totalFrigobar).toBe(0);
    const ms = await ctx.db.selectFrom("frigobar_movimentos").selectAll().execute();
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ execucao_id: r.execucaoId, quarto_id: q101, reserva_id: null, produto_id: agua, quantidade: 2, tipo: "reposicao", lancamento_id: null, usuario_id: governanca.id });
    expect(await contagem("lancamentos")).toBe(0);
  });
});

describe("checklist diário", () => {
  test("diária: só com hospedada; lança frigobar na conta com setor frigobar quando a opção está ligada", async () => {
    expect(await concluirDiaria(q101).catch((e) => e)).toMatchObject({ codigo: "QUARTO_NAO_OCUPADO" });
    const reserva = await hospedar(q101);
    await salvarConfig(ctx, { camareiraLancaFrigobar: true }, "u1");
    const antes = (await extrato(ctx, reserva.contaId)).length;
    const r = await concluirDiaria(q101, { frigobar: [{ produtoId: agua, quantidade: 1 }, { produtoId: refri, quantidade: 0 }] });
    expect(r.totalFrigobar).toBe(600);
    const ex = await extrato(ctx, reserva.contaId);
    expect(ex).toHaveLength(antes + 1);
    const linha = ex.find((l) => l.setor === "frigobar")!;
    expect(linha).toMatchObject({ descricao: "Água mineral", origem: "governanca", tipo: "extra", valor: 600, setor: "frigobar", reservaId: reserva.id });
    const ms = await ctx.db.selectFrom("frigobar_movimentos").selectAll().orderBy("tipo").execute();
    expect(ms.map((m) => [m.tipo, m.quantidade, m.produto_id])).toEqual([["consumo", 1, agua], ["reposicao", 1, agua]]);
    expect(ms.find((m) => m.tipo === "consumo")!.lancamento_id).toBe(linha.id);
    expect(ms.find((m) => m.tipo === "reposicao")!.lancamento_id).toBeNull();
    expect(ms.every((m) => m.reserva_id === reserva.id && m.execucao_id === r.execucaoId)).toBe(true);
    const exec = await ctx.db.selectFrom("checklist_execucoes").selectAll().executeTakeFirstOrThrow();
    expect(exec).toMatchObject({ tipo: "diaria", reserva_id: reserva.id, resultado: null });
    expect((await obterQuarto(ctx, q101)).situacao).toBe("ocupado");
    await concluirDiaria(q101);
    expect(await contagem("checklist_execucoes")).toBe(2);
  });

  test("diária com opção desligada e frigobar → FRIGOBAR_DESLIGADO; sem frigobar conclui", async () => {
    await hospedar(q101);
    expect(await concluirDiaria(q101, { frigobar: [{ produtoId: agua, quantidade: 1 }] }).catch((e) => e)).toMatchObject({ codigo: "FRIGOBAR_DESLIGADO" });
    expect(await contagem("checklist_execucoes")).toBe(0);
    await concluirDiaria(q101, { frigobar: [] });
    expect(await contagem("frigobar_movimentos")).toBe(0);
  });

  test("diária: controle faltando cria o aviso (offline) ou reaproveita o alertaId, sem abrir chamado", async () => {
    const reserva = await hospedar(q101);
    const ctrl = idDe(diaria, "Controle da TV");
    const aviso = await emTransacao(ctx, (tx) => avisarControleFaltando(tx, { quartoId: q101, itemId: ctrl }, governanca));
    const r = await concluirDiaria(q101, { respostas: respostasOk(diaria, { "Controle da TV": { presenca: "faltando", alertaId: aviso }, "Controle do ar-condicionado": { presenca: "faltando" } }) });
    const alertas = await alertasAbertos(ctx);
    expect(alertas).toHaveLength(2);
    expect(alertas.every((a) => a.alvoId === reserva.id)).toBe(true);
    expect(await listarChamados(ctx)).toHaveLength(0);
    const rs = await ctx.db.selectFrom("checklist_respostas").select(["item_id", "alerta_id"]).where("execucao_id", "=", r.execucaoId).where("presenca", "=", "faltando").execute();
    expect(rs.find((x) => x.item_id === ctrl)!.alerta_id).toBe(aviso);
    expect(rs.every((x) => x.alerta_id)).toBe(true);
  });

  test("alertaId de outra reserva não é reaproveitado: cria um novo aviso para a reserva atual", async () => {
    const reserva = await hospedar(q101);
    const ctrl = idDe(diaria, "Controle da TV");
    const aviso = await emTransacao(ctx, (tx) => avisarControleFaltando(tx, { quartoId: q101, itemId: ctrl }, governanca));
    await ctx.db.updateTable("alertas").set({ alvo_id: "reserva-antiga" }).where("id", "=", aviso).execute();
    const r = await concluirDiaria(q101, { respostas: respostasOk(diaria, { "Controle da TV": { presenca: "faltando", alertaId: aviso } }) });
    const resp = await ctx.db.selectFrom("checklist_respostas").select("alerta_id").where("execucao_id", "=", r.execucaoId).where("item_id", "=", ctrl).executeTakeFirstOrThrow();
    expect(resp.alerta_id).not.toBe(aviso);
    const novo = await ctx.db.selectFrom("alertas").select(["alvo_id", "resolvido_em"]).where("id", "=", resp.alerta_id!).executeTakeFirstOrThrow();
    expect(novo).toMatchObject({ alvo_id: reserva.id, resolvido_em: null });
  });

  test("Review Focus 3: hóspede saiu antes da conclusão da arrumação → QUARTO_NAO_OCUPADO e nada gravado", async () => {
    const reserva = await hospedar(q101);
    await salvarConfig(ctx, { camareiraLancaFrigobar: true }, "u1");
    await ctx.db.updateTable("reservas").set({ estado: "finalizada" }).where("id", "=", reserva.id).execute();
    await mudarSituacaoQuarto(ctx, q101, "sujo", "u1");
    const lancamentosAntes = await contagem("lancamentos");
    const erro = await concluirDiaria(q101, { frigobar: [{ produtoId: agua, quantidade: 1 }] }).catch((e) => e);
    expect(erro).toMatchObject({ codigo: "QUARTO_NAO_OCUPADO" });
    for (const t of ["checklist_execucoes", "checklist_respostas", "frigobar_movimentos"]) expect(await contagem(t)).toBe(0);
    expect(await contagem("lancamentos")).toBe(lancamentosAntes);
  });

  test("conta fechada → CONTA_FECHADA e nada é gravado", async () => {
    const reserva = await hospedar(q101);
    await salvarConfig(ctx, { camareiraLancaFrigobar: true }, "u1");
    await ctx.db.updateTable("contas").set({ situacao: "fechada" }).where("id", "=", reserva.contaId).execute();
    expect(await concluirDiaria(q101, { frigobar: [{ produtoId: agua, quantidade: 1 }] }).catch((e) => e)).toMatchObject({ codigo: "CONTA_FECHADA" });
    expect(await contagem("checklist_execucoes")).toBe(0);
    expect(await contagem("frigobar_movimentos")).toBe(0);
  });

  test("quantidade de frigobar fora de 0–999 → RESPOSTA_INVALIDA", async () => {
    await hospedar(q101);
    await salvarConfig(ctx, { camareiraLancaFrigobar: true }, "u1");
    for (const quantidade of [1000, -1, 1.5]) {
      expect(await concluirDiaria(q101, { frigobar: [{ produtoId: agua, quantidade }] }).catch((e) => e)).toMatchObject({ codigo: "RESPOSTA_INVALIDA" });
    }
  });
});

describe("formulário rápido do check-out", () => {
  test("lança cada item com setor frigobar; sem itens > 0 → NADA_A_LANCAR; produto fora do frigobar recusado", async () => {
    const reserva = await hospedar(q101);
    const lanc = (itens: { produtoId: string; quantidade: number }[]) => lancarFrigobar(ctx, reserva.contaId, { reservaId: reserva.id, itens }, recepcao);
    expect(await lanc([{ produtoId: agua, quantidade: 0 }]).catch((e) => e)).toMatchObject({ codigo: "NADA_A_LANCAR" });
    expect(await lanc([{ produtoId: cerveja, quantidade: 1 }]).catch((e) => e)).toMatchObject({ codigo: "PRODUTO_NAO_FRIGOBAR" });
    const r = await lanc([{ produtoId: agua, quantidade: 2 }, { produtoId: refri, quantidade: 1 }, { produtoId: refri, quantidade: 0 }]);
    expect(r.total).toBe(2000);
    const ls = (await extrato(ctx, reserva.contaId)).filter((l) => l.setor === "frigobar");
    expect(ls.map((l) => [l.descricao, l.valor, l.origem, l.reservaId]).sort()).toEqual([["Refrigerante", 800, "governanca", reserva.id], ["Água mineral", 1200, "governanca", reserva.id]]);
    expect(await contagem("frigobar_movimentos")).toBe(0);
  });

  test("reserva que não é da conta é recusada", async () => {
    const reserva = await hospedar(q101);
    const erro = await lancarFrigobar(ctx, "outra-conta", { reservaId: reserva.id, itens: [{ produtoId: agua, quantidade: 1 }] }, recepcao).catch((e) => e);
    expect(erro).toMatchObject({ codigo: "RESERVA_NAO_ENCONTRADA" });
  });
});

describe("rotas", () => {
  test("POST /api/quartos/:id/checklists e /api/contas/:id/frigobar", async () => {
    const app = criarApp(ctx);
    const gov = await entrarComo(ctx, "governanca");
    const rec = await entrarComo(ctx, "recepcao");
    await sujar(q101);
    const url = `/api/quartos/${q101}/checklists`;
    const corpo = { tipo: "saida", iniciadoEm: INICIO, respostas: respostasOk(saida), resultado: "liberado" };
    expect((await app.inject({ method: "POST", url, payload: corpo })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: gov, payload: { ...corpo, tipo: "x" } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url, headers: gov, payload: corpo });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ totalFrigobar: 0, execucaoId: expect.any(String) });
    expect((await app.inject({ method: "POST", url, headers: gov, payload: corpo })).json()).toMatchObject({ codigo: "QUARTO_NAO_SUJO" });

    const reserva = await hospedar(q102);
    const f = `/api/contas/${reserva.contaId}/frigobar`;
    const corpoF = { reservaId: reserva.id, itens: [{ produtoId: agua, quantidade: 1 }] };
    expect((await app.inject({ method: "POST", url: f, headers: gov, payload: corpoF })).statusCode).toBe(403);
    const lancado = await app.inject({ method: "POST", url: f, headers: rec, payload: corpoF });
    expect(lancado.statusCode).toBe(200);
    expect(lancado.json()).toMatchObject({ total: 600 });
    expect((await app.inject({ method: "POST", url: f, headers: rec, payload: { reservaId: reserva.id, itens: [{ produtoId: agua, quantidade: -1 }] } })).statusCode).toBe(400);
  });
});

describe("correções da revisão final", () => {
  test("I2: Concluir repetido com o mesmo execucaoId não grava de novo e devolve o mesmo resultado", async () => {
    const reserva = await hospedar(q101);
    await salvarConfig(ctx, { camareiraLancaFrigobar: true }, "u1");
    const pedido = { execucaoId: "exec-cliente-1", frigobar: [{ produtoId: agua, quantidade: 2 }] };
    const a = await concluirDiaria(q101, pedido);
    const b = await concluirDiaria(q101, pedido);
    expect(a).toEqual({ execucaoId: "exec-cliente-1", totalFrigobar: 1200 });
    expect(b).toEqual(a);
    expect(await contagem("checklist_execucoes")).toBe(1);
    expect(await contagem("frigobar_movimentos")).toBe(2);
    expect((await extrato(ctx, reserva.contaId)).filter((l) => l.setor === "frigobar")).toHaveLength(1);
  });

  test("I2: mesmo execucaoId em outro quarto ou outro tipo → RESPOSTA_INVALIDA", async () => {
    await hospedar(q101);
    await hospedar(q102);
    await concluirDiaria(q101, { execucaoId: "exec-cliente-2" });
    expect(await concluirDiaria(q102, { execucaoId: "exec-cliente-2" }).catch((e) => e)).toMatchObject({ codigo: "RESPOSTA_INVALIDA" });
    expect(await contagem("checklist_execucoes")).toBe(1);
  });

  test("I3: chamadoId já resolvido pela recepção conta como atendido: sem chamado novo e Liberado permitido", async () => {
    await sujar(q101);
    const ar = idDe(saida, "Ar-condicionado");
    const c = await emTransacao(ctx, (tx) => abrirChamado(tx, { quartoId: q101, itemId: ar }, governanca));
    await resolverChamado(ctx, c.id, "Consertado", recepcao);
    await concluirSaida(q101, { respostas: respostasOk(saida, { "Ar-condicionado": { equipamento: "nao_funciona", chamadoId: c.id } }) });
    expect((await obterQuarto(ctx, q101)).situacao).toBe("livre");
    const todos = await listarChamados(ctx, { quartoId: q101 });
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ id: c.id, situacao: "resolvido" });
    const r = await ctx.db.selectFrom("checklist_respostas").select("chamado_id").where("item_id", "=", ar).executeTakeFirstOrThrow();
    expect(r.chamado_id).toBe(c.id);
  });

  test("I3: defeito já aberto no quarto é reaproveitado na conclusão, mesmo sem chamadoId", async () => {
    await sujar(q101);
    const ar = idDe(saida, "Ar-condicionado");
    const c = await emTransacao(ctx, (tx) => abrirChamado(tx, { quartoId: q101, itemId: ar }, governanca));
    await concluirSaida(q101, { respostas: respostasOk(saida, { "Ar-condicionado": { equipamento: "nao_funciona" } }), resultado: "bloqueado", motivo: "Ar" });
    const abertos = await listarChamados(ctx, { quartoId: q101, situacao: "aberto" });
    expect(abertos.map((x) => x.id)).toEqual([c.id]);
  });
});
