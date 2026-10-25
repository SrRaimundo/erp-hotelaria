import { auditar } from "../infra/auditoria.js";
import { criarAlerta, resolverAlerta } from "../infra/alertas.js";
import { registrarEvento } from "../infra/outbox.js";
import { exigirPermissao, type UsuarioSessao } from "../nucleo/permissoes.js";
import { obterQuarto } from "../nucleo/quartos.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";

export type TipoChamado = "defeito" | "reposicao";
export type SituacaoChamado = "aberto" | "resolvido" | "cancelado";
export type Chamado = {
  id: string;
  quartoId: string;
  quartoNumero: string;
  itemId: string | null;
  tipo: TipoChamado;
  descricao: string;
  observacao: string | null;
  situacao: SituacaoChamado;
  abertoPor: string;
  abertoPorNome: string;
  abertoEm: string;
  encerradoPor: string | null;
  encerradoEm: string | null;
  observacaoEncerramento: string | null;
};

function paraChamado(l: any): Chamado {
  return {
    id: l.id,
    quartoId: l.quarto_id,
    quartoNumero: l.quarto_numero,
    itemId: l.item_id,
    tipo: l.tipo,
    descricao: l.descricao,
    observacao: l.observacao,
    situacao: l.situacao,
    abertoPor: l.aberto_por,
    abertoPorNome: l.aberto_por_nome,
    abertoEm: l.aberto_em,
    encerradoPor: l.encerrado_por,
    encerradoEm: l.encerrado_em,
    observacaoEncerramento: l.observacao_encerramento,
  };
}

function consulta(ctx: Contexto) {
  return ctx.db
    .selectFrom("chamados as c")
    .innerJoin("quartos as q", "q.id", "c.quarto_id")
    .innerJoin("usuarios as u", "u.id", "c.aberto_por")
    .select(["c.id", "c.quarto_id", "q.numero as quarto_numero", "c.item_id", "c.tipo", "c.descricao", "c.observacao", "c.situacao", "c.aberto_por", "u.nome as aberto_por_nome", "c.aberto_em", "c.encerrado_por", "c.encerrado_em", "c.observacao_encerramento"]);
}

async function obterChamado(ctx: Contexto, id: string): Promise<Chamado> {
  const l = await consulta(ctx).where("c.id", "=", id).executeTakeFirst();
  if (!l) throw new ErroDominio("CHAMADO_NAO_ENCONTRADO", "Chamado não encontrado.");
  return paraChamado(l);
}

async function buscarItem(tx: Contexto, itemId: string): Promise<{ id: string; etapa: string; texto: string }> {
  const item = await tx.db.selectFrom("checklist_itens").select(["id", "etapa", "texto"]).where("id", "=", itemId).executeTakeFirst();
  if (!item) throw new ErroDominio("ITEM_NAO_ENCONTRADO", "Item do checklist não encontrado.");
  return item;
}

/** Roda dentro da transação do chamador. */
export async function abrirChamado(
  tx: Contexto,
  d: { quartoId: string; itemId: string; observacao?: string },
  usuario: UsuarioSessao,
): Promise<Chamado> {
  exigirPermissao(usuario, "quartos.situacao");
  const quarto = await obterQuarto(tx, d.quartoId);
  const item = await buscarItem(tx, d.itemId);
  let tipo: TipoChamado;
  let descricao: string;
  if (item.etapa === "equipamento") {
    tipo = "defeito";
    descricao = `${item.texto} não funciona`;
  } else if (item.etapa === "controles") {
    tipo = "reposicao";
    descricao = `${item.texto} faltando`;
  } else {
    throw new ErroDominio("ITEM_SEM_CHAMADO", "Só equipamentos e controles abrem chamado.");
  }
  const id = novoId();
  const observacao = d.observacao?.trim() || null;
  await tx.db
    .insertInto("chamados")
    .values({ id, quarto_id: quarto.id, item_id: item.id, tipo, descricao, observacao, situacao: "aberto", aberto_por: usuario.id, aberto_em: tx.relogio.agora().toISOString() })
    .execute();
  await auditar(tx, { ator: usuario.id, acao: "chamado.abrir", alvoTipo: "chamado", alvoId: id, dados: { quartoId: quarto.id, tipo, descricao } });
  await registrarEvento(tx, "governanca.ChamadoAberto", { chamadoId: id, quartoId: quarto.id, tipo });
  return obterChamado(tx, id);
}

async function encerrar(tx: Contexto, c: Chamado, situacao: "resolvido" | "cancelado", usuarioId: string, observacao: string | null): Promise<void> {
  const r = await tx.db
    .updateTable("chamados")
    .set({ situacao, encerrado_por: usuarioId, encerrado_em: tx.relogio.agora().toISOString(), observacao_encerramento: observacao })
    .where("id", "=", c.id)
    .where("situacao", "=", "aberto")
    .executeTakeFirst();
  if (Number(r.numUpdatedRows) !== 1) throw new ErroDominio("CHAMADO_ENCERRADO", "Este chamado já foi encerrado.");
  await auditar(tx, { ator: usuarioId, acao: situacao === "resolvido" ? "chamado.resolver" : "chamado.cancelar", alvoTipo: "chamado", alvoId: c.id, dados: { quartoId: c.quartoId, observacao } });
  await registrarEvento(tx, situacao === "resolvido" ? "governanca.ChamadoResolvido" : "governanca.ChamadoCancelado", { chamadoId: c.id, quartoId: c.quartoId });
}

export async function cancelarChamado(ctx: Contexto, id: string, usuario: UsuarioSessao): Promise<void> {
  exigirPermissao(usuario, "quartos.situacao");
  await emTransacao(ctx, async (tx) => {
    const c = await obterChamado(tx, id);
    if (c.situacao !== "aberto" || c.abertoPor !== usuario.id) {
      throw new ErroDominio("CHAMADO_NAO_CANCELAVEL", "Só quem abriu o chamado pode cancelá-lo, e apenas enquanto estiver aberto.");
    }
    await encerrar(tx, c, "cancelado", usuario.id, null);
  });
}

export async function defeitosAbertos(tx: Contexto, quartoId: string): Promise<number> {
  const r = await tx.db
    .selectFrom("chamados")
    .select((eb) => eb.fn.countAll().as("n"))
    .where("quarto_id", "=", quartoId)
    .where("tipo", "=", "defeito")
    .where("situacao", "=", "aberto")
    .executeTakeFirst();
  return Number(r?.n ?? 0);
}

export async function resolverChamado(ctx: Contexto, id: string, observacao: string | undefined, usuario: UsuarioSessao): Promise<{ podeLiberar: boolean }> {
  exigirPermissao(usuario, "quartos.manutencao");
  return emTransacao(ctx, async (tx) => {
    const c = await obterChamado(tx, id);
    if (c.situacao !== "aberto") throw new ErroDominio("CHAMADO_ENCERRADO", "Este chamado já foi encerrado.");
    await encerrar(tx, c, "resolvido", usuario.id, observacao?.trim() || null);
    const quarto = await obterQuarto(tx, c.quartoId);
    const restrito = quarto.situacao === "bloqueado" || quarto.situacao === "em_manutencao";
    return { podeLiberar: restrito && (await defeitosAbertos(tx, c.quartoId)) === 0 };
  });
}

export async function listarChamados(ctx: Contexto, filtro: { situacao?: SituacaoChamado; quartoId?: string } = {}): Promise<Chamado[]> {
  let q = consulta(ctx);
  if (filtro.situacao) q = q.where("c.situacao", "=", filtro.situacao);
  if (filtro.quartoId) q = q.where("c.quarto_id", "=", filtro.quartoId);
  return (await q.orderBy("c.aberto_em").orderBy("c.id").execute()).map(paraChamado);
}

/** Aviso à recepção ("Precisa da sua atenção") de controle não encontrado em quarto ocupado. Roda dentro da transação do chamador. */
export async function avisarControleFaltando(
  tx: Contexto,
  d: { quartoId: string; itemId: string },
  usuario: UsuarioSessao,
): Promise<string> {
  exigirPermissao(usuario, "quartos.situacao");
  const quarto = await obterQuarto(tx, d.quartoId);
  const item = await buscarItem(tx, d.itemId);
  if (item.etapa !== "controles") throw new ErroDominio("ITEM_SEM_CHAMADO", "Só controles geram aviso de controle faltando.");
  const reserva = await tx.db.selectFrom("reservas").select("id").where("quarto_id", "=", quarto.id).where("estado", "=", "hospedada").executeTakeFirst();
  if (!reserva) throw new ErroDominio("QUARTO_NAO_OCUPADO", `O quarto ${quarto.numero} não tem hóspede, então não há o que conferir.`);
  const alertaId = await criarAlerta(tx, {
    tipo: "controle_faltando",
    alvoTipo: "reserva",
    alvoId: reserva.id,
    mensagem: `${item.texto} não encontrado no ${quarto.numero} — conferir com o hóspede`,
  });
  await auditar(tx, { ator: usuario.id, acao: "aviso_controle.criar", alvoTipo: "alerta", alvoId: alertaId, dados: { quartoId: quarto.id, itemId: item.id } });
  return alertaId;
}

/** Desfaz um aviso de controle faltando ainda aberto (a camareira voltou atrás). */
export async function cancelarAvisoControle(ctx: Contexto, id: string, usuario: UsuarioSessao): Promise<void> {
  exigirPermissao(usuario, "quartos.situacao");
  await emTransacao(ctx, async (tx) => {
    const a = await tx.db.selectFrom("alertas").select("id").where("id", "=", id).where("tipo", "=", "controle_faltando").where("resolvido_em", "is", null).executeTakeFirst();
    if (!a) throw new ErroDominio("AVISO_NAO_ENCONTRADO", "Aviso não encontrado ou já resolvido.");
    await resolverAlerta(tx, id, usuario.id);
    await auditar(tx, { ator: usuario.id, acao: "aviso_controle.cancelar", alvoTipo: "alerta", alvoId: id });
  });
}
