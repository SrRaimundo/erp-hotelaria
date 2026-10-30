import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { exigirPermissao, type UsuarioSessao } from "../nucleo/permissoes.js";
import { obterConfig } from "../nucleo/pousada.js";
import { mudarSituacaoQuarto, obterQuarto } from "../nucleo/quartos.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";
import { abrirChamado, avisarControleFaltando, defeitosAbertos } from "./chamados.js";
import { lancarConsumoFrigobar, produtosDoFrigobar, type ItemFrigobar } from "./frigobar.js";
import type { Etapa } from "./modelos.js";

export type Equipamento = "funciona" | "nao_funciona" | "nao_se_aplica";
export type Presenca = "presente" | "faltando" | "nao_se_aplica";
export type RespostaEnviada = {
  itemId: string;
  simNao?: boolean;
  quantidade?: number;
  equipamento?: Equipamento;
  presenca?: Presenca;
  observacao?: string;
  chamadoId?: string;
  alertaId?: string;
};
export type PedidoChecklist = {
  /** Gerado pelo cliente ao abrir o checklist; repetir o envio devolve o resultado já gravado. */
  execucaoId?: string;
  tipo: "saida" | "diaria";
  iniciadoEm: string;
  respostas: RespostaEnviada[];
  /** Ids dos itens que o aparelho exibiu ao abrir o checklist; rascunhos antigos não enviam. */
  itensExibidos?: string[];
  frigobar?: ItemFrigobar[];
  resultado?: "liberado" | "bloqueado";
  motivo?: string;
};

const MAX_QUANTIDADE = 999;
const invalida = (msg: string, detalhes?: unknown) => new ErroDominio("RESPOSTA_INVALIDA", msg, detalhes);
const quantidadeValida = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_QUANTIDADE;

type ItemAtivo = { id: string; etapa: Etapa; texto: string };

/** Cada etapa aceita só o seu campo de resposta; qualquer outro campo de resposta é recusado. */
function validarResposta(item: ItemAtivo, r: RespostaEnviada): void {
  const campos = { limpeza: "simNao", enxoval: "quantidade", equipamento: "equipamento", controles: "presenca" } as const;
  const esperado = campos[item.etapa];
  for (const c of Object.values(campos)) {
    if ((c === esperado) === (r[c] === undefined)) throw invalida(`Resposta inválida para "${item.texto}".`, { itemId: item.id });
  }
  const v = r[esperado];
  const ok =
    esperado === "simNao" ? typeof v === "boolean"
    : esperado === "quantidade" ? quantidadeValida(v)
    : esperado === "equipamento" ? v === "funciona" || v === "nao_funciona" || v === "nao_se_aplica"
    : v === "presente" || v === "faltando" || v === "nao_se_aplica";
  if (!ok) throw invalida(`Resposta inválida para "${item.texto}".`, { itemId: item.id });
}

function validarFrigobar(frigobar: ItemFrigobar[]): void {
  const vistos = new Set<string>();
  for (const i of frigobar) {
    if (!i.produtoId || !quantidadeValida(i.quantidade) || vistos.has(i.produtoId)) {
      throw invalida("Quantidade de frigobar inválida. Informe um número inteiro de 0 a 999, uma vez por produto.", { produtoId: i.produtoId });
    }
    vistos.add(i.produtoId);
  }
}

async function chamadoReaproveitavel(tx: Contexto, id: string | undefined, quartoId: string, itemId: string): Promise<string | null> {
  if (!id) return null;
  // Resolvido nesse meio-tempo pela recepção também vale: o defeito foi atendido, não se abre outro.
  const c = await tx.db.selectFrom("chamados").select("id").where("id", "=", id).where("quarto_id", "=", quartoId).where("item_id", "=", itemId).where("situacao", "in", ["aberto", "resolvido"]).executeTakeFirst();
  return c?.id ?? null;
}

async function avisoReaproveitavel(tx: Contexto, id: string | undefined, itemId: string, reservaId: string | null): Promise<string | null> {
  if (!id || !reservaId) return null;
  const a = await tx.db.selectFrom("alertas").select("id").where("id", "=", id).where("tipo", "=", "controle_faltando").where("alvo_tipo", "=", "reserva").where("alvo_id", "=", reservaId).where("chave", "=", itemId).where("resolvido_em", "is", null).executeTakeFirst();
  return a?.id ?? null;
}

/**
 * Conclui o checklist inteiro numa única transação: valida as respostas, cria chamados e avisos que ficaram
 * pendentes (preenchimento offline), lança/registra o frigobar e decide a situação do quarto (saída).
 */
export async function concluirChecklist(
  ctx: Contexto,
  quartoId: string,
  d: PedidoChecklist,
  usuario: UsuarioSessao,
): Promise<{ execucaoId: string; totalFrigobar: number }> {
  exigirPermissao(usuario, "quartos.situacao");
  return emTransacao(ctx, async (tx) => {
    if (d.execucaoId) {
      const previa = await tx.db.selectFrom("checklist_execucoes").select(["quarto_id", "tipo"]).where("id", "=", d.execucaoId).executeTakeFirst();
      if (previa) {
        if (previa.quarto_id !== quartoId || previa.tipo !== d.tipo) throw invalida("Este envio já foi usado em outro checklist. Reabra o checklist e tente novamente.");
        const soma = await tx.db
          .selectFrom("frigobar_movimentos as m")
          .innerJoin("lancamentos as l", "l.id", "m.lancamento_id")
          .select((eb) => eb.fn.sum<number>("l.valor").as("total"))
          .where("m.execucao_id", "=", d.execucaoId)
          .where("m.tipo", "=", "consumo")
          .executeTakeFirst();
        return { execucaoId: d.execucaoId, totalFrigobar: Number(soma?.total ?? 0) };
      }
    }
    const agora = tx.relogio.agora();
    const inicio = /^\d{4}-\d{2}-\d{2}T/.test(d.iniciadoEm) ? Date.parse(d.iniciadoEm) : NaN;
    if (Number.isNaN(inicio) || inicio > agora.getTime()) {
      throw invalida("Horário de início inválido. Reabra o checklist e tente novamente.");
    }
    // A situação é lida dentro da transação: escritas são serializadas, então a segunda conclusão já vê o quarto livre.
    const quarto = await obterQuarto(tx, quartoId);
    let reservaId: string | null = null;
    let contaId: string | null = null;
    if (d.tipo === "saida") {
      if (quarto.situacao !== "sujo") {
        throw new ErroDominio("QUARTO_NAO_SUJO", `O quarto ${quarto.numero} não está sujo, então não há limpeza de saída a concluir.`, { situacao: quarto.situacao });
      }
      if (d.resultado !== "liberado" && d.resultado !== "bloqueado") {
        throw new ErroDominio("RESULTADO_OBRIGATORIO", "Informe se o quarto fica Liberado ou Bloqueado.");
      }
    } else {
      const r = await tx.db.selectFrom("reservas").select(["id", "conta_id"]).where("quarto_id", "=", quartoId).where("estado", "=", "hospedada").executeTakeFirst();
      if (!r) throw new ErroDominio("QUARTO_NAO_OCUPADO", `O quarto ${quarto.numero} não tem hóspede, então não há arrumação a concluir.`);
      reservaId = r.id;
      contaId = r.conta_id;
    }
    const motivo = d.tipo === "saida" && d.resultado === "bloqueado" ? (d.motivo?.trim() ?? "") : null;
    if (motivo === "") throw new ErroDominio("MOTIVO_OBRIGATORIO", "Informe o motivo do bloqueio.");

    const todos = await tx.db
      .selectFrom("checklist_itens as i")
      .innerJoin("checklist_modelos as m", "m.id", "i.modelo_id")
      .select(["i.id", "i.etapa", "i.texto", "i.ativo"])
      .where("m.tipo", "=", d.tipo)
      .orderBy("i.ordem")
      .execute();
    // Com `itensExibidos`, vale o que o aparelho mostrou: itens criados depois não são exigidos e
    // itens desativados nesse meio-tempo têm a resposta ignorada. Sem a lista, só os ativos de hoje.
    const exibidos = d.itensExibidos ? new Set(d.itensExibidos) : null;
    const elegiveis = todos.filter((i) => (exibidos ? exibidos.has(i.id) : i.ativo === 1));
    const itens: ItemAtivo[] = elegiveis.filter((i) => i.ativo === 1);
    const porId = new Map(elegiveis.map((i) => [i.id, i]));
    const respondidos = new Set<string>();
    for (const r of d.respostas) {
      const item = porId.get(r.itemId);
      if (!item) throw invalida("Há uma resposta para um item que não faz parte deste checklist.", { itemId: r.itemId });
      if (respondidos.has(r.itemId)) throw invalida(`O item "${item.texto}" foi respondido mais de uma vez.`, { itemId: r.itemId });
      respondidos.add(r.itemId);
      if (item.ativo === 1) validarResposta(item, r);
    }
    const faltando = itens.filter((i) => !respondidos.has(i.id)).map((i) => i.texto);
    if (faltando.length > 0) throw new ErroDominio("RESPOSTA_FALTANDO", `Faltam respostas: ${faltando.join(", ")}.`, { itens: faltando });
    // Respostas de itens desativados durante o preenchimento não são gravadas.
    const respostas = d.respostas.filter((r) => porId.get(r.itemId)!.ativo === 1);

    const frigobar = d.frigobar ?? [];
    validarFrigobar(frigobar);
    const lancaConsumo = d.tipo === "diaria" && (await obterConfig(tx)).camareiraLancaFrigobar;
    if (d.tipo === "diaria" && frigobar.length > 0 && !lancaConsumo) {
      throw new ErroDominio("FRIGOBAR_DESLIGADO", "A pousada não lança o frigobar pela arrumação. Retire o frigobar do checklist.");
    }
    const produtos = await produtosDoFrigobar(tx, frigobar);

    if (d.resultado === "liberado" && d.tipo === "saida" && respostas.some((r) => r.simNao === false)) {
      throw new ErroDominio("LIMPEZA_INCOMPLETA", "Há itens de limpeza marcados como Não. Corrija-os ou bloqueie o quarto com um motivo.");
    }

    // Chamados e avisos que ainda não existem (marcados sem conexão) são criados agora.
    const ligacoes = new Map<string, { chamadoId: string | null; alertaId: string | null }>();
    for (const r of respostas) {
      const item = porId.get(r.itemId)!;
      const observacao = r.observacao?.trim() || undefined;
      const abre = async () =>
        (await chamadoReaproveitavel(tx, r.chamadoId, quartoId, item.id)) ?? (await abrirChamado(tx, { quartoId, itemId: item.id, observacao }, usuario)).id;
      let chamadoId: string | null = null;
      let alertaId: string | null = null;
      if (r.equipamento === "nao_funciona" || (r.presenca === "faltando" && d.tipo === "saida")) {
        chamadoId = await abre();
      } else if (r.presenca === "faltando") {
        alertaId = (await avisoReaproveitavel(tx, r.alertaId, item.id, reservaId)) ?? (await avisarControleFaltando(tx, { quartoId, itemId: item.id }, usuario));
      }
      ligacoes.set(item.id, { chamadoId, alertaId });
    }
    if (d.resultado === "liberado" && d.tipo === "saida") {
      const defeitos = await defeitosAbertos(tx, quartoId);
      if (defeitos > 0) {
        throw new ErroDominio("CHAMADO_ABERTO", `Há ${defeitos} chamado(s) de defeito aberto(s) neste quarto. Bloqueie o quarto com um motivo.`, { defeitos });
      }
    }

    const execucaoId = d.execucaoId ?? novoId();
    const instante = agora.toISOString();
    await tx.db.insertInto("checklist_execucoes").values({
      id: execucaoId, quarto_id: quartoId, tipo: d.tipo, reserva_id: reservaId, usuario_id: usuario.id,
      iniciado_em: d.iniciadoEm, concluido_em: instante, resultado: d.tipo === "saida" ? d.resultado! : null, motivo,
    }).execute();
    for (const r of respostas) {
      const item = porId.get(r.itemId)!;
      const lig = ligacoes.get(item.id)!;
      await tx.db.insertInto("checklist_respostas").values({
        execucao_id: execucaoId, item_id: item.id, etapa: item.etapa, texto_item: item.texto,
        sim_nao: r.simNao === undefined ? null : r.simNao ? 1 : 0, quantidade: r.quantidade ?? null,
        equipamento: r.equipamento ?? null, presenca: r.presenca ?? null, observacao: r.observacao?.trim() || null,
        chamado_id: lig.chamadoId, alerta_id: lig.alertaId,
      }).execute();
    }

    let totalFrigobar = 0;
    const movimento = (produtoId: string, quantidade: number, tipo: "consumo" | "reposicao", lancamentoId: string | null) =>
      tx.db.insertInto("frigobar_movimentos").values({
        id: novoId(), execucao_id: execucaoId, quarto_id: quartoId, reserva_id: reservaId, produto_id: produtoId,
        quantidade, tipo, lancamento_id: lancamentoId, usuario_id: usuario.id, instante,
      }).execute();
    for (const i of frigobar.filter((f) => f.quantidade > 0)) {
      if (lancaConsumo) {
        const produto = produtos.get(i.produtoId)!;
        const lancamentoId = await lancarConsumoFrigobar(tx, { contaId: contaId!, reservaId: reservaId!, produto, quantidade: i.quantidade }, usuario.id);
        totalFrigobar += i.quantidade * produto.preco;
        await movimento(i.produtoId, i.quantidade, "consumo", lancamentoId);
      }
      await movimento(i.produtoId, i.quantidade, "reposicao", null);
    }

    if (d.tipo === "saida") {
      if (d.resultado === "bloqueado") await mudarSituacaoQuarto(tx, quartoId, "bloqueado", usuario.id, motivo!);
      else await mudarSituacaoQuarto(tx, quartoId, "livre", usuario.id);
    }
    await auditar(tx, {
      ator: usuario.id, acao: "checklist.concluir", alvoTipo: "checklist", alvoId: execucaoId, motivo: motivo ?? undefined,
      dados: { quartoId, tipo: d.tipo, resultado: d.tipo === "saida" ? d.resultado : null, totalFrigobar },
    });
    await registrarEvento(tx, "governanca.ChecklistConcluido", { execucaoId, quartoId, tipo: d.tipo, resultado: d.tipo === "saida" ? d.resultado : null });
    return { execucaoId, totalFrigobar };
  });
}
