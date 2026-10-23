import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { paraHospede, pendenciasFnrh } from "../nucleo/hospedes.js";
import type { UsuarioSessao } from "../nucleo/permissoes.js";
import { obterConfig } from "../nucleo/pousada.js";
import { obterProdutoPorCodigo } from "../nucleo/produtos.js";
import { listarQuartos, mudarSituacaoQuarto, obterQuarto, type Quarto } from "../nucleo/quartos.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { arredondarCentavos } from "../shared/dinheiro.js";
import { ErroDominio } from "../shared/erros.js";
import { diaHoteleiro, horaLocal, idadeEm } from "../shared/tempo.js";
import { alterarReserva } from "./alteracao.js";
import { lancar } from "./conta.js";
import { verificarDisponibilidade } from "./disponibilidade.js";
import { transicionar } from "./estados.js";
import { obterReserva } from "./reservas.js";

export type PedidoCheckin = {
  reservaId: string;
  quartoId: string;
  /** hospedeIds dos acompanhantes (o titular já faz parte da reserva). */
  acompanhantes: string[];
  cobrarEarlyCheckin?: boolean;
  recalcularPreco?: boolean;
};

/** Quartos livres (limpos) da categoria reservada e disponíveis em todo o período; o já atribuído primeiro. */
export async function sugerirQuartos(ctx: Contexto, reservaId: string): Promise<Quarto[]> {
  const r = await obterReserva(ctx, reservaId);
  const livres = (await listarQuartos(ctx, { categoriaId: r.categoriaId })).filter((q) => q.situacao === "livre");
  const sugeridos: Quarto[] = [];
  for (const q of livres) {
    try {
      await verificarDisponibilidade(ctx, { categoriaId: r.categoriaId, quartoId: q.id, chegada: r.chegada, saida: r.saida, ignorarReservaId: r.id });
      sugeridos.push(q);
    } catch (e) {
      if (!(e instanceof ErroDominio)) throw e;
    }
  }
  return sugeridos.sort((a, b) => Number(b.id === r.quartoId) - Number(a.id === r.quartoId));
}

export async function fazerCheckin(ctx: Contexto, p: PedidoCheckin, usuario: UsuarioSessao): Promise<void> {
  await emTransacao(ctx, async (tx) => {
    const r = await obterReserva(tx, p.reservaId);
    if (r.estado !== "confirmada") {
      throw new ErroDominio("RESERVA_NAO_CONFIRMADA", "Só é possível fazer check-in de reserva confirmada. Confirme o sinal ou verifique a situação da reserva.", { estado: r.estado });
    }
    const config = await obterConfig(tx);
    const agora = tx.relogio.agora();
    const hoje = diaHoteleiro(agora, config.fuso, config.viradaDia);
    if (hoje !== r.chegada) {
      throw new ErroDominio("CHECKIN_FORA_DA_DATA", "O check-in só pode ser feito no dia da chegada. Altere a data da reserva antes de continuar.", { chegada: r.chegada, hoje });
    }

    // FNRH: titular e acompanhantes (o titular, se repetido, conta uma vez só).
    const ids = [r.titularId, ...new Set(p.acompanhantes.filter((id) => id !== r.titularId))];
    const faltas: Record<string, string[]> = {};
    for (const id of ids) {
      const l = await tx.db.selectFrom("hospedes").selectAll().where("id", "=", id).executeTakeFirst();
      if (!l) throw new ErroDominio("HOSPEDE_NAO_ENCONTRADO", "Hóspede não encontrado. Cadastre o hóspede antes do check-in.", { id });
      const h = paraHospede(l);
      const adulto = h.nascimento ? idadeEm(h.nascimento, r.chegada) >= 18 : true;
      const pendencias = pendenciasFnrh(h, adulto);
      if (pendencias.length > 0) faltas[id] = pendencias;
    }
    if (Object.keys(faltas).length > 0) {
      throw new ErroDominio("FNRH_INCOMPLETA", "A ficha do hóspede (FNRH) está incompleta. Complete o cadastro antes do check-in.", faltas);
    }

    const quarto = await obterQuarto(tx, p.quartoId);
    if (quarto.situacao !== "livre") {
      throw new ErroDominio("QUARTO_INDISPONIVEL", `O quarto ${quarto.numero} não está livre (${quarto.situacao.replace("_", " ")}). Escolha outro quarto.`, { situacao: quarto.situacao });
    }
    await verificarDisponibilidade(tx, { categoriaId: quarto.categoriaId, quartoId: quarto.id, chegada: r.chegada, saida: r.saida, ignorarReservaId: r.id });

    // Upgrade: quarto de outra categoria. O preço congelado é mantido, salvo pedido de recálculo.
    if (quarto.categoriaId !== r.categoriaId) {
      if (p.recalcularPreco) {
        await alterarReserva(tx, r.id, { categoriaId: quarto.categoriaId, quartoId: quarto.id }, usuario);
      } else {
        await tx.db.updateTable("reservas").set({ categoria_id: quarto.categoriaId }).where("id", "=", r.id).execute();
      }
      await auditar(tx, {
        ator: usuario.id, acao: "reserva.upgrade", alvoTipo: "reserva", alvoId: r.id,
        dados: { categoriaAnterior: r.categoriaId, categoriaNova: quarto.categoriaId, quartoId: quarto.id, recalcularPreco: p.recalcularPreco === true },
      });
    }

    transicionar(r.estado, "hospedada");
    await tx.db.updateTable("reservas").set({ estado: "hospedada", quarto_id: quarto.id }).where("id", "=", r.id).execute();
    for (const id of ids.slice(1)) {
      await tx.db.insertInto("acompanhantes").values({ reserva_id: r.id, hospede_id: id }).execute();
    }
    await mudarSituacaoQuarto(tx, quarto.id, "ocupado", usuario.id);

    if (p.cobrarEarlyCheckin !== false && horaLocal(agora, config.fuso) < config.horaCheckin) {
      const regra = config.earlyCheckin;
      const primeira = (await obterReserva(tx, r.id)).noites[0]!.valor;
      const taxa = regra.tipo === "fixo" ? regra.valor : arredondarCentavos((primeira * regra.valor) / 100);
      if (taxa > 0) {
        const produto = await obterProdutoPorCodigo(tx, "EARLY_CHECKIN");
        await lancar(tx, {
          tipo: "extra", origem: "hospedagem", produtoId: produto.id, descricao: "Early check-in",
          quantidade: 1, valorUnitario: taxa, contaId: r.contaId, reservaId: r.id,
        }, usuario.id);
      }
    }

    await auditar(tx, {
      ator: usuario.id, acao: "reserva.checkin", alvoTipo: "reserva", alvoId: r.id,
      dados: { quartoId: quarto.id, hospedeIds: ids },
    });
    await registrarEvento(tx, "hospedagem.CheckinConcluido", { reservaId: r.id, quartoId: quarto.id, hospedeIds: ids });
  });
}
