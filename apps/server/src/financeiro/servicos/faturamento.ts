import { auditar } from "../../infra/auditoria.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { Dinheiro } from "../../shared/dinheiro.js";
import { ErroDominio } from "../../shared/erros.js";
import { novoId, type UUID } from "../../shared/ids.js";
import type { Faturamento } from "../modelos/faturamento.js";
import { ContasReceberService } from "./contas-receber.js";
import type { Usuario } from "./locais.js";

const PRAZO_VENCIMENTO_DIAS = 30;

export type FaturamentoListado = {
  id: UUID; cliente_id: UUID; cliente_nome: string; cliente_documento: string | null;
  cliente_contato: { email?: string; telefone?: string; endereco?: string };
  cliente_politica: { prazo_dias?: number; forma_cobranca?: string; observacoes?: string };
  reserva_codigo: number | null; valor_original: number; valor_liquido: number; data_vencimento: string;
  forma_cobranca: string; numero_documento: string; status: string; fechada: boolean; criado_em: string;
};

function paraFaturamento(f: any): Faturamento {
  return {
    id: f.id,
    local_id: f.local_id,
    cliente_id: f.cliente_id,
    referencia_id: f.referencia_id,
    referencia_tipo: "checkout",
    valor_original: Dinheiro.de(f.valor_original),
    valor_liquido: Dinheiro.de(f.valor_liquido),
    data_vencimento: new Date(f.data_vencimento),
    forma_cobranca: f.forma_cobranca,
    numero_documento: f.numero_documento ?? "",
    status: f.status,
    lançamentos_id: f.lançamentos_id ? JSON.parse(f.lançamentos_id) : [],
  };
}

export class FaturamentoService {
  constructor(private ctx: Contexto) {}

  /** Cria faturamento aberto para um checkout. Cobrança ainda não gerada (forma provisória "boleto", sem número). */
  async criarParaCheckout(
    checkout_id: UUID,
    cliente_id: UUID,
    local_id: UUID,
    valor_original: Dinheiro,
    usuario: Usuario,
  ): Promise<Faturamento> {
    if (!Number.isInteger(valor_original.centavos) || valor_original.centavos <= 0) {
      throw new ErroDominio("VALIDACAO_FALHOU", "Valor deve ser positivo.");
    }
    return emTransacao(this.ctx, async (tx) => {
      const local = await tx.db.selectFrom("fin_local").select("id").where("id", "=", local_id).executeTakeFirst();
      if (!local) throw new ErroDominio("NAO_ENCONTRADO", "Local não encontrado.");
      const cliente = await tx.db
        .selectFrom("fin_cliente")
        .select("id")
        .where("id", "=", cliente_id)
        .where("local_id", "=", local_id)
        .executeTakeFirst();
      if (!cliente) throw new ErroDominio("NAO_ENCONTRADO", "Cliente não encontrado.");
      const dup = await tx.db
        .selectFrom("fin_faturamento")
        .select("id")
        .where("referencia_id", "=", checkout_id)
        .where("status", "!=", "cancelado")
        .executeTakeFirst();
      if (dup) throw new ErroDominio("ESTADO_INVALIDO", "Checkout já faturado.");
      const agora = tx.relogio.agora();
      const venc = new Date(agora.getTime() + PRAZO_VENCIMENTO_DIAS * 86400000);
      const id = novoId();
      await tx.db
        .insertInto("fin_faturamento")
        .values({
          id,
          local_id,
          cliente_id,
          referencia_id: checkout_id,
          valor_original: valor_original.centavos,
          valor_liquido: valor_original.centavos,
          data_vencimento: venc.toISOString(),
          forma_cobranca: "boleto",
          numero_documento: null,
          status: "aberto",
          lançamentos_id: JSON.stringify([]),
          criado_em: agora.toISOString(),
        })
        .execute();
      const criado = await new FaturamentoService(tx).obter(id);
      await auditar(tx, {
        ator: usuario.email,
        acao: "fin_faturamento.criar",
        alvoTipo: "fin_faturamento",
        alvoId: id,
        dados: { ...criado, valor_original: criado.valor_original.centavos, valor_liquido: criado.valor_liquido.centavos },
      });
      return criado;
    });
  }

  /** Define a forma de cobrança e gera o numero_documento (sequencial por local). */
  async gerarCobranca(faturamento_id: UUID, forma: Faturamento["forma_cobranca"], usuario: Usuario): Promise<Faturamento> {
    if (!["boleto", "pix", "deposito"].includes(forma)) {
      throw new ErroDominio("VALIDACAO_FALHOU", "Forma de cobrança inválida.");
    }
    return emTransacao(this.ctx, async (tx) => {
      const svc = new FaturamentoService(tx);
      const f = await svc.obter(faturamento_id);
      if (f.status !== "aberto") throw new ErroDominio("ESTADO_INVALIDO", "Faturamento não está aberto.");
      if (f.numero_documento) throw new ErroDominio("ESTADO_INVALIDO", "Cobrança já gerada.");
      const r = await tx.db
        .selectFrom("fin_faturamento")
        .select(({ fn }) => fn.count<number>("numero_documento").as("n"))
        .where("local_id", "=", f.local_id)
        .executeTakeFirst();
      const ano = tx.relogio.agora().getUTCFullYear();
      const numero_documento = `FAT-${ano}-${String(Number(r?.n ?? 0) + 1).padStart(6, "0")}`;
      await tx.db
        .updateTable("fin_faturamento")
        .set({ forma_cobranca: forma, numero_documento })
        .where("id", "=", faturamento_id)
        .execute();
      await auditar(tx, {
        ator: usuario.email,
        acao: "fin_faturamento.gerar_cobranca",
        alvoTipo: "fin_faturamento",
        alvoId: faturamento_id,
        dados: { forma, numero_documento },
      });
      return svc.obter(faturamento_id);
    });
  }

  /** Faturamentos do local com os dados do cliente e a reserva de origem; "fechada" = cobrança gerada (tem número de documento). */
  async listar(local_id: UUID): Promise<FaturamentoListado[]> {
    const linhas = (await this.ctx.db
      .selectFrom("fin_faturamento as f")
      .innerJoin("fin_cliente as c", "c.id", "f.cliente_id")
      .leftJoin("valores_a_receber as v", "v.id", "f.referencia_id")
      .leftJoin("reservas as r", "r.id", "v.reserva_id")
      .select([
        "f.id", "f.cliente_id", "f.valor_original", "f.valor_liquido", "f.data_vencimento", "f.forma_cobranca", "f.numero_documento", "f.status", "f.criado_em",
        "c.nome as cliente_nome", "c.cpf_cnpj as cliente_documento", "c.contato as cliente_contato", "c.politica as cliente_politica", "r.codigo as reserva_codigo",
      ])
      .where("f.local_id", "=", local_id)
      .orderBy("f.criado_em", "desc")
      .orderBy("f.id")
      .execute()) as any[];
    const ler = (s: string | null) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
    return linhas.map((l) => ({
      id: l.id, cliente_id: l.cliente_id, cliente_nome: l.cliente_nome, cliente_documento: l.cliente_documento,
      cliente_contato: ler(l.cliente_contato), cliente_politica: ler(l.cliente_politica),
      reserva_codigo: l.reserva_codigo ?? null, valor_original: l.valor_original, valor_liquido: l.valor_liquido,
      data_vencimento: l.data_vencimento, forma_cobranca: l.forma_cobranca, numero_documento: l.numero_documento ?? "",
      status: l.status, fechada: !!l.numero_documento, criado_em: l.criado_em,
    }));
  }

  /**
   * Fecha a fatura: gera o número do documento, ajusta forma e vencimento e envia o valor para Contas a Receber.
   * Sem a chamada, o checkout faturado fica apenas aberto em Faturamento.
   */
  async fechar(id: UUID, forma: Faturamento["forma_cobranca"], vencimento: Date, usuario: Usuario): Promise<Faturamento> {
    if (Number.isNaN(vencimento.getTime())) throw new ErroDominio("VALIDACAO_FALHOU", "Data de vencimento inválida.");
    return emTransacao(this.ctx, async (tx) => {
      const svc = new FaturamentoService(tx);
      const aberto = await svc.obter(id);
      const cobr = await svc.gerarCobranca(id, forma, usuario);
      await tx.db.updateTable("fin_faturamento").set({ data_vencimento: vencimento.toISOString() }).where("id", "=", id).execute();
      await new ContasReceberService(tx).criarRecebivel(
        id, aberto.cliente_id, aberto.local_id, cobr.numero_documento, aberto.valor_liquido, vencimento, usuario,
      );
      return svc.obter(id);
    });
  }

  async obter(id: UUID): Promise<Faturamento> {
    const f = await this.ctx.db.selectFrom("fin_faturamento").selectAll().where("id", "=", id).executeTakeFirst();
    if (!f) throw new ErroDominio("NAO_ENCONTRADO", "Faturamento não encontrado.");
    return paraFaturamento(f);
  }
}
