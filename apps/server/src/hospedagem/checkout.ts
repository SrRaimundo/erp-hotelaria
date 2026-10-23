import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import type { UsuarioSessao } from "../nucleo/permissoes.js";
import { obterConfig } from "../nucleo/pousada.js";
import { obterProdutoPorCodigo } from "../nucleo/produtos.js";
import { mudarSituacaoQuarto } from "../nucleo/quartos.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { arredondarCentavos, type Centavos } from "../shared/dinheiro.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";
import { dataLocal, horaLocal, somarDias, type Data } from "../shared/tempo.js";
import { extrato, lancar, registrarPagamento, saldo, type LinhaExtrato } from "./conta.js";
import { ESTADOS_ATIVOS, transicionar } from "./estados.js";
import { lancarDiariasPendentes } from "./virada.js";

export type PedidoCheckout = {
  reservaId: string;
  pagamentos: { formaCodigo: string; valor: Centavos }[];
  faturado?: { nome: string; documento: string; valor: Centavos };
  cobrarLateCheckout?: boolean;
};

export type PreviaCheckout = { extrato: LinhaExtrato[]; saldo: Centavos; lateCheckout?: Centavos; saidaAntecipada: boolean };

/** O que o check-out faria agora: validações, data efetiva de saída, diárias pendentes e taxa de late check-out. */
async function planejar(ctx: Contexto, reservaId: string, cobrarLate: boolean) {
  const r = await ctx.db.selectFrom("reservas").selectAll().where("id", "=", reservaId).executeTakeFirst();
  if (!r) throw new ErroDominio("RESERVA_NAO_ENCONTRADA", "Reserva não encontrada. Confira o número informado.", { id: reservaId });
  if (r.estado !== "hospedada") {
    throw new ErroDominio("RESERVA_NAO_HOSPEDADA", "Só é possível fazer check-out de reserva hospedada. Verifique a situação da reserva.", { estado: r.estado });
  }
  const config = await obterConfig(ctx);
  const agora = ctx.relogio.agora();
  // A saída vale pela data do calendário (não pelo dia hoteleiro): às 01:00 do dia da saída a última noite já foi dormida.
  const dataSaida: Data = dataLocal(agora, config.fuso);
  if (dataSaida > r.saida) {
    throw new ErroDominio("ESTADIA_EXCEDIDA", "O hóspede ficou além da data de saída da reserva. Prorrogue a reserva antes de fazer o check-out.", { saida: r.saida, hoje: dataSaida });
  }
  // Toda estadia cobra ao menos uma noite: sair no próprio dia da chegada (day use) não remove a primeira diária.
  const minima = somarDias(r.chegada, 1);
  const hoje: Data = dataSaida < minima ? minima : dataSaida; // saída efetiva
  const saidaAntecipada = hoje < r.saida;
  const noites = await ctx.db.selectFrom("reserva_noites").select(["data", "valor", "passos"])
    .where("reserva_id", "=", reservaId).where("data", ">=", r.chegada).where("data", "<", hoje).orderBy("data").execute();
  const feitas = new Set(
    (await ctx.db.selectFrom("lancamentos").select("data_ref").where("reserva_id", "=", reservaId).where("tipo", "=", "diaria").execute()).map((l) => l.data_ref),
  );
  const pendentes = noites.filter((n) => !feitas.has(n.data) && n.valor >= 1);

  let taxa = 0;
  if (cobrarLate && dataSaida === r.saida && horaLocal(agora, config.fuso) > config.horaCheckout) {
    const regra = config.lateCheckout;
    const ultima = noites.at(-1)?.valor ?? 0;
    taxa = regra.tipo === "fixo" ? regra.valor : arredondarCentavos((ultima * regra.valor) / 100);
  }
  return { r, hoje, saidaAntecipada, pendentes, taxa };
}

export async function previaCheckout(ctx: Contexto, reservaId: string): Promise<PreviaCheckout> {
  const p = await planejar(ctx, reservaId, true);
  const atual = await saldo(ctx, p.r.conta_id);
  const linhas = await extrato(ctx, p.r.conta_id);
  const instante = ctx.relogio.agora().toISOString();
  const previstas: LinhaExtrato[] = p.pendentes.map((n) => {
    const [, mes, dia] = n.data.split("-");
    const rotulo = (JSON.parse(n.passos) as { rotulo: string }[]).at(-1)?.rotulo ?? "Diária";
    return { id: `previa-${n.data}`, natureza: "debito", tipo: "diaria", origem: "hospedagem", descricao: `Diária ${dia}/${mes} — ${rotulo}`, valor: n.valor, instante, estornaId: null, reservaId };
  });
  if (p.taxa > 0) {
    previstas.push({ id: "previa-late-checkout", natureza: "debito", tipo: "extra", origem: "hospedagem", descricao: "Late check-out", valor: p.taxa, instante, estornaId: null, reservaId });
  }
  const adicional = previstas.reduce((s, l) => s + l.valor, 0);
  return {
    extrato: [...linhas, ...previstas],
    saldo: atual.saldo + adicional,
    ...(p.taxa > 0 ? { lateCheckout: p.taxa } : {}),
    saidaAntecipada: p.saidaAntecipada,
  };
}

/** Tudo numa transação: qualquer erro (inclusive saldo pendente) desfaz diárias, taxas e pagamentos. */
export async function fazerCheckout(ctx: Contexto, pedido: PedidoCheckout, usuario: UsuarioSessao): Promise<void> {
  await emTransacao(ctx, async (tx) => {
    const { r, hoje, saidaAntecipada, taxa } = await planejar(tx, pedido.reservaId, pedido.cobrarLateCheckout !== false);

    if (saidaAntecipada) {
      await tx.db.deleteFrom("reserva_noites").where("reserva_id", "=", r.id).where("data", ">=", hoje).execute();
      await tx.db.updateTable("reservas").set({ saida: hoje }).where("id", "=", r.id).execute();
      await auditar(tx, {
        ator: usuario.id, acao: "reserva.saida_antecipada", alvoTipo: "reserva", alvoId: r.id,
        dados: { saidaPrevista: r.saida, saidaEfetiva: hoje },
      });
    }
    await lancarDiariasPendentes(tx, r.id, hoje);

    if (taxa > 0) {
      const produto = await obterProdutoPorCodigo(tx, "LATE_CHECKOUT");
      await lancar(tx, {
        tipo: "extra", origem: "hospedagem", produtoId: produto.id, descricao: "Late check-out",
        quantidade: 1, valorUnitario: taxa, contaId: r.conta_id, reservaId: r.id,
      }, usuario.id);
    }

    for (const p of pedido.pagamentos) {
      if (p.formaCodigo === "faturado") {
        throw new ErroDominio("FATURADO_VIA_CAMPO_PROPRIO", "O valor faturado deve ser informado no campo \"faturado\", com o nome e o documento do responsável.");
      }
      await registrarPagamento(tx, { contaId: r.conta_id, reservaId: r.id, formaCodigo: p.formaCodigo, valor: p.valor }, usuario);
    }
    if (pedido.faturado) {
      const f = pedido.faturado;
      await registrarPagamento(tx, { contaId: r.conta_id, reservaId: r.id, formaCodigo: "faturado", valor: f.valor }, usuario);
      const id = novoId();
      await tx.db.insertInto("valores_a_receber").values({
        id, conta_id: r.conta_id, reserva_id: r.id, responsavel_nome: f.nome, responsavel_documento: f.documento,
        valor: f.valor, criado_em: tx.relogio.agora().toISOString(), situacao: "aberto",
      }).execute();
      await registrarEvento(tx, "hospedagem.ValorAReceberCriado", { valorAReceberId: id, contaId: r.conta_id, reservaId: r.id, valor: f.valor });
    }

    // Conta de grupo "unica": só a última reserva não finalizada do grupo precisa zerar o saldo e fecha a conta.
    let ultima = true;
    if (r.grupo_id) {
      const grupo = await tx.db.selectFrom("grupos").select("cobranca").where("id", "=", r.grupo_id).executeTakeFirst();
      if (grupo?.cobranca === "unica") {
        const outra = await tx.db.selectFrom("reservas").select("id")
          .where("grupo_id", "=", r.grupo_id).where("id", "!=", r.id).where("estado", "in", ESTADOS_ATIVOS).executeTakeFirst();
        ultima = !outra;
      }
    }
    if (ultima) {
      const { saldo: restante } = await saldo(tx, r.conta_id);
      if (restante !== 0) {
        throw new ErroDominio(
          "SALDO_PENDENTE",
          restante > 0
            ? "Ainda há saldo a pagar na conta. Registre o pagamento do valor restante para concluir o check-out."
            : "Os pagamentos informados passam do valor da conta. Corrija os valores para concluir o check-out.",
          { saldo: restante },
        );
      }
      await tx.db.updateTable("contas").set({ situacao: "fechada" }).where("id", "=", r.conta_id).execute();
    }

    transicionar(r.estado, "finalizada");
    await tx.db.updateTable("reservas").set({ estado: "finalizada" }).where("id", "=", r.id).execute();
    if (r.quarto_id) await mudarSituacaoQuarto(tx, r.quarto_id, "sujo", usuario.id);
    await auditar(tx, {
      ator: usuario.id, acao: "reserva.checkout", alvoTipo: "reserva", alvoId: r.id,
      dados: { saidaEfetiva: hoje, lateCheckout: taxa, contaFechada: ultima },
    });
    await registrarEvento(tx, "hospedagem.CheckoutConcluido", { reservaId: r.id, quartoId: r.quarto_id, contaId: r.conta_id });
  });
}
