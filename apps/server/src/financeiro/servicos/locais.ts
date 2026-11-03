import { auditar } from "../../infra/auditoria.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { ErroDominio } from "../../shared/erros.js";
import { novoId, type UUID } from "../../shared/ids.js";
import type { Local } from "../modelos/local.js";

/** Quem executa a ação; apenas o email entra na auditoria. */
export type Usuario = { email: string; id?: string; dispositivo?: string };

function paraLocal(l: any): Local {
  const p = l.parametros ? JSON.parse(l.parametros) : {};
  return {
    id: l.id,
    pousada_id: l.pousada_id,
    nome: l.nome,
    ativo: !!l.ativo,
    parametros: {
      local_padrao_hospedagem: p.local_padrao_hospedagem ?? l.id,
      local_padrao_reserva: p.local_padrao_reserva ?? l.id,
    },
  };
}

/** Local para a lista da tela; `hospedagem_padrao` marca o local que recebe os lançamentos da hospedagem. */
export type LocalListado = Local & { hospedagem_padrao: boolean };

export class LocalService {
  constructor(private ctx: Contexto) {}

  async criar(pousada_id: UUID, nome: string, usuario: Usuario): Promise<Local> {
    return emTransacao(this.ctx, async (tx) => {
      const existente = await tx.db.selectFrom("fin_local").select("id").where("pousada_id", "=", pousada_id).executeTakeFirst();
      if (existente) throw new ErroDominio("VALIDACAO_FALHOU", "Já existe um Local para esta pousada.");
      const agora = tx.relogio.agora().toISOString();
      const id = novoId();
      const parametros = { local_padrao_hospedagem: novoId(), local_padrao_reserva: novoId() };
      await tx.db
        .insertInto("fin_local")
        .values({ id, pousada_id, nome, ativo: 1, parametros: JSON.stringify(parametros), criado_em: agora })
        .execute();
      await tx.db
        .insertInto("fin_conta_bancaria")
        .values({
          id: novoId(),
          local_id: id,
          nome: "Caixa",
          banco: "Sem banco",
          agencia: "0",
          numero: "0",
          tipo: "caixa",
          saldo_inicial: 0,
          criado_em: agora,
        })
        .execute();
      const local: Local = { id, pousada_id, nome, ativo: true, parametros };
      await auditar(tx, { ator: usuario.email, acao: "fin_local.criar", alvoTipo: "fin_local", alvoId: id, dados: local });
      return local;
    });
  }

  async listarPorPousada(pousada_id: UUID): Promise<Local[]> {
    const linhas = await this.ctx.db
      .selectFrom("fin_local")
      .selectAll()
      .where("pousada_id", "=", pousada_id)
      .orderBy("nome")
      .orderBy("id")
      .execute();
    return linhas.map(paraLocal);
  }

  /** Todos os locais (inclusive desativados), por nome. */
  async listar(): Promise<LocalListado[]> {
    const linhas = (await this.ctx.db.selectFrom("fin_local").selectAll().orderBy("nome").orderBy("id").execute()) as any[];
    return linhas.map((l) => ({ ...paraLocal(l), hospedagem_padrao: !!(l.parametros ? JSON.parse(l.parametros) : {}).hospedagem_padrao }));
  }

  /** Marca este local como o que recebe os lançamentos da hospedagem (e desmarca os demais). */
  async definirPadraoHospedagem(id: UUID, usuario: Usuario): Promise<void> {
    await emTransacao(this.ctx, async (tx) => {
      const alvo = await new LocalService(tx).obter(id);
      if (!alvo.ativo) throw new ErroDominio("ESTADO_INVALIDO", "Local desativado não pode receber a hospedagem.");
      const todos = (await tx.db.selectFrom("fin_local").select(["id", "parametros"]).execute()) as any[];
      for (const l of todos) {
        const p = l.parametros ? JSON.parse(l.parametros) : {};
        if (l.id === id ? p.hospedagem_padrao === true : !p.hospedagem_padrao) continue;
        p.hospedagem_padrao = l.id === id;
        await tx.db.updateTable("fin_local").set({ parametros: JSON.stringify(p) }).where("id", "=", l.id).execute();
      }
      await auditar(tx, { ator: usuario.email, acao: "fin_local.padrao_hospedagem", alvoTipo: "fin_local", alvoId: id, dados: {} });
    });
  }

  async obter(id: UUID): Promise<Local> {
    const l = await this.ctx.db.selectFrom("fin_local").selectAll().where("id", "=", id).executeTakeFirst();
    if (!l) throw new ErroDominio("NAO_ENCONTRADO", "Local não encontrado.");
    return paraLocal(l);
  }

  async atualizar(id: UUID, dados: Partial<Pick<Local, "nome" | "ativo" | "parametros">>, usuario: Usuario): Promise<Local> {
    return emTransacao(this.ctx, async (tx) => {
      const antes = await new LocalService(tx).obter(id);
      if (dados.ativo === false && antes.ativo) {
        const marca = (await tx.db.selectFrom("fin_local").select("parametros").where("id", "=", id).executeTakeFirst()) as any;
        if (marca?.parametros && JSON.parse(marca.parametros).hospedagem_padrao === true) {
          throw new ErroDominio("ESTADO_INVALIDO", "Este local recebe os lançamentos da hospedagem. Marque outro local como o da hospedagem antes de desativá-lo.");
        }
      }
      const depois: Local = {
        ...antes,
        nome: dados.nome ?? antes.nome,
        ativo: dados.ativo ?? antes.ativo,
        parametros: dados.parametros ?? antes.parametros,
      };
      const linha = (await tx.db.selectFrom("fin_local").select("parametros").where("id", "=", id).executeTakeFirst()) as any;
      const extras = linha?.parametros ? JSON.parse(linha.parametros) : {};
      await tx.db
        .updateTable("fin_local")
        .set({ nome: depois.nome, ativo: depois.ativo ? 1 : 0, parametros: JSON.stringify({ ...extras, ...depois.parametros }) })
        .where("id", "=", id)
        .execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_local.atualizar", alvoTipo: "fin_local", alvoId: id, dados: { antes, depois } });
      return depois;
    });
  }
}
