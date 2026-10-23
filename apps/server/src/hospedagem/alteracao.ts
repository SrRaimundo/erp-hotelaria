import { auditar } from "../infra/auditoria.js";
import { resolverAlerta } from "../infra/alertas.js";
import { registrarEvento } from "../infra/outbox.js";
import type { UsuarioSessao } from "../nucleo/permissoes.js";
import { obterConfig } from "../nucleo/pousada.js";
import { mudarSituacaoQuarto, obterQuarto } from "../nucleo/quartos.js";
import { autorizarSupervisor } from "../nucleo/supervisor.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { arredondarCentavos, type Centavos } from "../shared/dinheiro.js";
import { ErroDominio } from "../shared/erros.js";
import { diaHoteleiro, noites as datasDasNoites, type Data } from "../shared/tempo.js";
import { cotar } from "../tarifas/cotacao.js";
import { verificarRestricoes, type Violacao } from "../tarifas/restricoes.js";
import type { ValorNoite } from "../tarifas/tipos.js";
import { alertarSaldoOrfao } from "./conta.js";
import { verificarDisponibilidade } from "./disponibilidade.js";
import { ESTADOS_ATIVOS, transicionar } from "./estados.js";
import { obterReserva, verificarCapacidade, type Reserva, type ReservaDetalhe } from "./reservas.js";

export type Mudanca = {
  quartoId?: string | null;
  categoriaId?: string;
  chegada?: Data;
  saida?: Data;
  adultos?: number;
  criancasNascimento?: Data[];
  precosManuais?: { data: Data; valor: Centavos }[];
};

export type Autorizacao = { motivo: string; supervisor: { login: string; senha: string } };

type Plano = {
  atual: ReservaDetalhe;
  novo: { quartoId: string | null; categoriaId: string; chegada: Data; saida: Data; adultos: number; criancasNascimento: Data[] };
  noites: ValorNoite[];
  valorAntigo: Centavos;
  valorNovo: Centavos;
  violacoes: Violacao[];
  ajusteManual: boolean;
};

const mesmasCriancas = (a: Data[], b: Data[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Calcula o resultado da alteração sem gravar nada. */
async function planejar(c: Contexto, reservaId: string, m: Mudanca): Promise<Plano> {
  const atual = await obterReserva(c, reservaId);
  if (!ESTADOS_ATIVOS.includes(atual.estado)) {
    throw new ErroDominio("RESERVA_NAO_ALTERAVEL", "Esta reserva não pode mais ser alterada porque já foi encerrada.", { estado: atual.estado });
  }
  const categoriaId = m.categoriaId ?? atual.categoriaId;
  const chegada = m.chegada ?? atual.chegada;
  const saida = m.saida ?? atual.saida;
  const adultos = m.adultos ?? atual.adultos;
  const criancasNascimento = m.criancasNascimento ?? atual.criancasNascimento;
  if (!(chegada < saida)) throw new ErroDominio("DATAS_INVALIDAS", "A saída deve ser depois da chegada. Corrija as datas.");
  if (atual.estado === "hospedada" && chegada !== atual.chegada) {
    throw new ErroDominio("CHEGADA_NAO_ALTERAVEL", "O hóspede já chegou: não é possível mudar a data de chegada.");
  }

  const categoria = await c.db.selectFrom("categorias").select(["nome", "max_adultos", "max_criancas"]).where("id", "=", categoriaId).executeTakeFirst();
  if (!categoria) throw new ErroDominio("CATEGORIA_NAO_ENCONTRADA", "Categoria não encontrada. Escolha uma categoria existente.");
  // Trocar de categoria sem indicar quarto desfaz a atribuição de quarto.
  const quartoId = m.quartoId !== undefined ? m.quartoId : categoriaId === atual.categoriaId ? atual.quartoId : null;
  if (atual.estado === "hospedada" && !quartoId) {
    throw new ErroDominio("QUARTO_OBRIGATORIO_HOSPEDADA", "O hóspede já está no quarto: informe o quarto de destino para trocar de quarto ou de categoria.");
  }
  if (quartoId) {
    const quarto = await c.db.selectFrom("quartos").select("categoria_id").where("id", "=", quartoId).executeTakeFirst();
    if (!quarto) throw new ErroDominio("QUARTO_NAO_ENCONTRADO", "Quarto não encontrado.");
    if (quarto.categoria_id !== categoriaId) {
      throw new ErroDominio("QUARTO_FORA_DA_CATEGORIA", "O quarto escolhido não pertence à categoria da reserva. Escolha outro quarto.");
    }
  }
  await verificarCapacidade(c, categoria, adultos, criancasNascimento, chegada);

  const periodo = datasDasNoites(chegada, saida);
  const congeladas = new Map(atual.noites.map((n) => [n.data, n]));
  const manuais = m.precosManuais ?? [];

  // Noites com diária lançada (estornada ou não) já foram cobradas: mantêm o valor congelado,
  // não aceitam preço manual e não podem sair do período.
  const lancadas = new Set(
    (await c.db.selectFrom("lancamentos").select("data_ref").where("reserva_id", "=", reservaId).where("tipo", "=", "diaria").execute())
      .map((l) => l.data_ref as Data),
  );
  for (const d of lancadas) {
    if (!periodo.includes(d) || manuais.some((p) => p.data === d)) {
      const dia = d.split("-").reverse().slice(0, 2).join("/");
      throw new ErroDominio("NOITE_JA_LANCADA", `A diária de ${dia} já foi cobrada na conta: essa noite não pode ser alterada nem removida da estadia.`, { data: d });
    }
  }

  const recotarTudo =
    categoriaId !== atual.categoriaId || adultos !== atual.adultos || !mesmasCriancas(criancasNascimento, atual.criancasNascimento);
  const hospedes = { adultos, criancasNascimento };
  const pedido = { categoriaId, chegada, saida, canal: atual.canal, hospedes, ignorarReservaId: atual.id };
  const fixa = (d: Data) => (lancadas.has(d) ? congeladas.get(d) : undefined);
  const precisaCotar = periodo.some((d) => !fixa(d) && (recotarTudo || !congeladas.has(d)));
  const cotacao = precisaCotar ? await cotar(c, pedido) : undefined;
  const cotadas = new Map((cotacao?.noites ?? []).map((n) => [n.data, n]));
  let noites: ValorNoite[] = periodo.map((d) => fixa(d) ?? (recotarTudo ? cotadas.get(d)! : (congeladas.get(d) ?? cotadas.get(d)!)));

  for (const p of manuais) {
    if (!periodo.includes(p.data) || !Number.isInteger(p.valor) || p.valor < 0) {
      throw new ErroDominio("PRECO_MANUAL_INVALIDO", `Não é possível ajustar o preço de ${p.data.split("-").reverse().join("/")}: use uma noite da estadia e um valor em centavos.`, p);
    }
  }
  if (manuais.length > 0) {
    noites = noites.map((n) => {
      const p = manuais.find((x) => x.data === n.data);
      return p ? { data: n.data, valor: p.valor, passos: [...n.passos, { rotulo: "Ajuste manual", valor: p.valor }] } : n;
    });
  }

  const periodoMudou = chegada !== atual.chegada || saida !== atual.saida || categoriaId !== atual.categoriaId;
  const violacoes = periodoMudou ? (cotacao?.violacoes ?? (await verificarRestricoes(c, categoriaId, chegada, saida))) : [];
  return {
    atual,
    novo: { quartoId, categoriaId, chegada, saida, adultos, criancasNascimento },
    noites,
    valorAntigo: atual.total,
    valorNovo: noites.reduce((s, n) => s + n.valor, 0),
    violacoes,
    ajusteManual: manuais.length > 0,
  };
}

export async function previaAlteracao(
  ctx: Contexto,
  reservaId: string,
  mudanca: Mudanca,
): Promise<{ valorAntigo: Centavos; valorNovo: Centavos; noites: ValorNoite[] }> {
  const p = await planejar(ctx, reservaId, mudanca);
  return { valorAntigo: p.valorAntigo, valorNovo: p.valorNovo, noites: p.noites };
}

const MSG_RESTRICAO = "Estas datas têm restrição de venda. Peça a autorização de um supervisor para continuar.";

export async function alterarReserva(
  ctx: Contexto,
  reservaId: string,
  mudanca: Mudanca,
  usuario: UsuarioSessao,
  autorizacao?: Autorizacao,
): Promise<Reserva> {
  // Supervisor (scrypt é lento) fora da transação e só quando a alteração é sensível.
  const previo = await planejar(ctx, reservaId, mudanca);
  if (previo.violacoes.length > 0 && !autorizacao) throw new ErroDominio("RESTRICAO_TARIFARIA", MSG_RESTRICAO, previo.violacoes);
  const autorizado =
    previo.violacoes.length > 0 || previo.ajusteManual
      ? await autorizarSupervisor(ctx, autorizacao?.supervisor, autorizacao?.motivo)
      : undefined;

  return emTransacao(ctx, async (tx) => {
    const p = await planejar(tx, reservaId, mudanca);
    if (p.violacoes.length > 0 && !autorizado) throw new ErroDominio("RESTRICAO_TARIFARIA", MSG_RESTRICAO, p.violacoes);
    if (p.ajusteManual && !autorizado) await autorizarSupervisor(tx, undefined, undefined);
    const { novo, atual } = p;
    await verificarDisponibilidade(tx, {
      categoriaId: novo.categoriaId, quartoId: novo.quartoId ?? undefined, chegada: novo.chegada, saida: novo.saida, ignorarReservaId: atual.id,
    });
    // Hóspede já no quarto: a troca ocupa o quarto novo (que precisa estar livre) e deixa o antigo para limpeza.
    if (atual.estado === "hospedada" && novo.quartoId && novo.quartoId !== atual.quartoId) {
      const destino = await obterQuarto(tx, novo.quartoId);
      if (destino.situacao !== "livre") {
        throw new ErroDominio("QUARTO_INDISPONIVEL", `O quarto ${destino.numero} não está livre (${destino.situacao.replace("_", " ")}). Escolha outro quarto.`, { situacao: destino.situacao });
      }
      await mudarSituacaoQuarto(tx, destino.id, "ocupado", usuario.id);
      if (atual.quartoId) await mudarSituacaoQuarto(tx, atual.quartoId, "sujo", usuario.id);
    }

    let valorSinal = atual.valorSinal;
    if (atual.estado === "pre_reserva") {
      const { sinal } = await obterConfig(tx);
      valorSinal = sinal.tipo === "percentual" ? arredondarCentavos((p.valorNovo * sinal.percentual) / 100) : p.noites[0]!.valor;
    }

    await tx.db.updateTable("reservas").set({
      quarto_id: novo.quartoId, categoria_id: novo.categoriaId, chegada: novo.chegada, saida: novo.saida,
      adultos: novo.adultos, criancas: JSON.stringify(novo.criancasNascimento), valor_sinal: valorSinal,
    }).where("id", "=", atual.id).execute();
    await tx.db.deleteFrom("reserva_noites").where("reserva_id", "=", atual.id).execute();
    for (const n of p.noites) {
      await tx.db.insertInto("reserva_noites").values({ reserva_id: atual.id, data: n.data, valor: n.valor, passos: JSON.stringify(n.passos) }).execute();
    }

    const antes = { quartoId: atual.quartoId, categoriaId: atual.categoriaId, chegada: atual.chegada, saida: atual.saida, adultos: atual.adultos, criancasNascimento: atual.criancasNascimento };
    await auditar(tx, {
      ator: usuario.id, acao: "reserva.alterar", alvoTipo: "reserva", alvoId: atual.id,
      ...(autorizado ? { motivo: autorizado.motivo, supervisorId: autorizado.supervisorId } : {}),
      dados: { antes, depois: novo, valorAntigo: p.valorAntigo, valorNovo: p.valorNovo, valorSinal, ajusteManual: mudanca.precosManuais ?? [] },
    });
    await registrarEvento(tx, "hospedagem.ReservaAlterada", { reservaId: atual.id, antes, depois: novo, valorAntigo: p.valorAntigo, valorNovo: p.valorNovo });
    const { noites: _n, total: _t, pago: _p, ...reserva } = await obterReserva(tx, atual.id);
    return reserva;
  });
}

async function resolverAlertasDaReserva(tx: Contexto, reservaId: string, usuarioId: string, soSinal: boolean): Promise<void> {
  let q = tx.db.selectFrom("alertas").select("id").where("alvo_tipo", "=", "reserva").where("alvo_id", "=", reservaId).where("resolvido_em", "is", null);
  if (soSinal) q = q.where("tipo", "like", "sinal%");
  for (const a of await q.execute()) await resolverAlerta(tx, a.id, usuarioId);
}

async function carregarEstado(tx: Contexto, id: string) {
  const l = await tx.db.selectFrom("reservas").select(["estado", "chegada", "conta_id"]).where("id", "=", id).executeTakeFirst();
  if (!l) throw new ErroDominio("RESERVA_NAO_ENCONTRADA", "Reserva não encontrada. Confira o número informado.", { id });
  return l;
}

export async function cancelarReserva(ctx: Contexto, reservaId: string, usuario: UsuarioSessao, autorizacao: Autorizacao | undefined): Promise<void> {
  const aut = await autorizarSupervisor(ctx, autorizacao?.supervisor, autorizacao?.motivo);
  await emTransacao(ctx, async (tx) => {
    const { estado, conta_id } = await carregarEstado(tx, reservaId);
    transicionar(estado, "cancelada");
    await tx.db.updateTable("reservas").set({ estado: "cancelada" }).where("id", "=", reservaId).execute();
    await resolverAlertasDaReserva(tx, reservaId, usuario.id, false);
    await alertarSaldoOrfao(tx, conta_id);
    await auditar(tx, {
      ator: usuario.id, acao: "reserva.cancelar", alvoTipo: "reserva", alvoId: reservaId,
      motivo: aut.motivo, supervisorId: aut.supervisorId, dados: { estadoAnterior: estado },
    });
    await registrarEvento(tx, "hospedagem.ReservaCancelada", { reservaId, motivo: aut.motivo, automatico: false });
  });
}

export async function marcarNoShow(ctx: Contexto, reservaId: string, usuario: UsuarioSessao, autorizacao: Autorizacao | undefined): Promise<void> {
  const aut = await autorizarSupervisor(ctx, autorizacao?.supervisor, autorizacao?.motivo);
  await emTransacao(ctx, async (tx) => {
    const { estado, chegada, conta_id } = await carregarEstado(tx, reservaId);
    transicionar(estado, "no_show");
    const config = await obterConfig(tx);
    const hoje = diaHoteleiro(tx.relogio.agora(), config.fuso, config.viradaDia);
    if (!(chegada < hoje)) {
      throw new ErroDominio("NO_SHOW_ANTECIPADO", "O no-show só pode ser marcado depois do dia previsto de chegada.", { chegada, hoje });
    }
    await tx.db.updateTable("reservas").set({ estado: "no_show" }).where("id", "=", reservaId).execute();
    await resolverAlertasDaReserva(tx, reservaId, usuario.id, false);
    await alertarSaldoOrfao(tx, conta_id);
    await auditar(tx, {
      ator: usuario.id, acao: "reserva.no_show", alvoTipo: "reserva", alvoId: reservaId,
      motivo: aut.motivo, supervisorId: aut.supervisorId, dados: { chegada },
    });
    await registrarEvento(tx, "hospedagem.ReservaNoShow", { reservaId, motivo: aut.motivo });
  });
}

export async function prorrogarSinal(
  ctx: Contexto,
  reservaId: string,
  novoPrazo: string,
  usuario: UsuarioSessao,
  autorizacao: Autorizacao | undefined,
): Promise<void> {
  const aut = await autorizarSupervisor(ctx, autorizacao?.supervisor, autorizacao?.motivo);
  await emTransacao(ctx, async (tx) => {
    const l = await tx.db.selectFrom("reservas").select(["estado", "prazo_sinal"]).where("id", "=", reservaId).executeTakeFirst();
    if (!l) throw new ErroDominio("RESERVA_NAO_ENCONTRADA", "Reserva não encontrada. Confira o número informado.", { id: reservaId });
    if (l.estado !== "pre_reserva") {
      throw new ErroDominio("SINAL_NAO_PRORROGAVEL", "Só é possível prorrogar o sinal de uma pré-reserva.", { estado: l.estado });
    }
    const instante = new Date(novoPrazo);
    if (Number.isNaN(instante.getTime()) || instante <= tx.relogio.agora()) {
      throw new ErroDominio("PRAZO_INVALIDO", "O novo prazo do sinal deve ser uma data e hora futuras.", { novoPrazo });
    }
    const prazo = instante.toISOString();
    await tx.db.updateTable("reservas").set({ prazo_sinal: prazo, aviso_sinal_em: null }).where("id", "=", reservaId).execute();
    await resolverAlertasDaReserva(tx, reservaId, usuario.id, true);
    await auditar(tx, {
      ator: usuario.id, acao: "reserva.prorrogar_sinal", alvoTipo: "reserva", alvoId: reservaId,
      motivo: aut.motivo, supervisorId: aut.supervisorId, dados: { prazoAnterior: l.prazo_sinal, novoPrazo: prazo },
    });
  });
}
