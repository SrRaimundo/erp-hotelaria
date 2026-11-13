import { sql } from "kysely";
import { auditar } from "../../infra/auditoria.js";
import { emTransacao, type Contexto } from "../../shared/contexto.js";
import { ErroDominio } from "../../shared/erros.js";
import { novoId, type UUID } from "../../shared/ids.js";
import { CaixaBancoService } from "./caixa-banco.js";
import type { Usuario } from "./locais.js";

export const TIPOS_CONTA = ["corrente", "poupanca", "aplicacao", "caixa"] as const;
export type TipoConta = (typeof TIPOS_CONTA)[number];

export type ContaComSaldo = {
  id: UUID; local_id: UUID; nome: string; banco: string; agencia: string; numero: string; tipo: string; saldo_inicial: number; saldo: number;
};
export type Fornecedor = { id: UUID; local_id: UUID; razao_social: string; cnpj: string | null; contato: string | null };
export type PoliticaCliente = { prazo_dias?: number; forma_cobranca?: "boleto" | "pix" | "deposito"; observacoes?: string };
export type ContatoCliente = { email?: string; telefone?: string; endereco?: string };
export type ClienteFin = {
  id: UUID; local_id: UUID; nome: string; cpf_cnpj: string | null; tipo: string; contato: ContatoCliente; politica: PoliticaCliente;
};

const json = <T>(s: string | null, vazio: T): T => {
  if (!s) return vazio;
  try {
    return JSON.parse(s) as T;
  } catch {
    return vazio;
  }
};

/** Cadastros do Financeiro por local: contas (caixa e bancos), fornecedores e clientes. */
export class CadastrosFinanceiroService {
  constructor(private ctx: Contexto) {}

  private async exigirLocal(ctx: Contexto, local_id: UUID): Promise<void> {
    const l = await ctx.db.selectFrom("fin_local").select("id").where("id", "=", local_id).executeTakeFirst();
    if (!l) throw new ErroDominio("NAO_ENCONTRADO", "Local não encontrado.");
  }

  async listarContas(local_id: UUID, ate = this.ctx.relogio.agora()): Promise<ContaComSaldo[]> {
    const contas = (await this.ctx.db.selectFrom("fin_conta_bancaria").selectAll().where("local_id", "=", local_id).orderBy(sql`CASE WHEN tipo = 'caixa' THEN 0 ELSE 1 END`).orderBy("criado_em").orderBy("nome").execute()) as any[];
    const caixa = new CaixaBancoService(this.ctx);
    const r: ContaComSaldo[] = [];
    for (const c of contas) {
      const saldo = await caixa.obterSaldo(c.id, ate);
      r.push({ id: c.id, local_id: c.local_id, nome: c.nome, banco: c.banco, agencia: c.agencia, numero: c.numero, tipo: c.tipo, saldo_inicial: c.saldo_inicial, saldo: saldo.centavos });
    }
    return r;
  }

  async criarConta(
    p: { local_id: UUID; nome: string; banco: string; agencia: string; numero: string; tipo: TipoConta; saldo_inicial: number },
    usuario: Usuario,
  ): Promise<UUID> {
    return emTransacao(this.ctx, async (tx) => {
      await this.exigirLocal(tx, p.local_id);
      const dup = await tx.db.selectFrom("fin_conta_bancaria").select("id").where("local_id", "=", p.local_id).where("numero", "=", p.numero).executeTakeFirst();
      if (dup) throw new ErroDominio("VALIDACAO_FALHOU", "Já existe uma conta com este número neste local.");
      const id = novoId();
      await tx.db.insertInto("fin_conta_bancaria").values({ ...p, id, criado_em: tx.relogio.agora().toISOString() }).execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_conta_bancaria.criar", alvoTipo: "fin_conta_bancaria", alvoId: id, dados: p });
      return id;
    });
  }

  async listarFornecedores(local_id: UUID): Promise<Fornecedor[]> {
    return (await this.ctx.db.selectFrom("fin_fornecedor").select(["id", "local_id", "razao_social", "cnpj", "contato"]).where("local_id", "=", local_id).orderBy("razao_social").orderBy("id").execute()) as Fornecedor[];
  }

  async criarFornecedor(p: { local_id: UUID; razao_social: string; cnpj?: string }, usuario: Usuario): Promise<Fornecedor> {
    return emTransacao(this.ctx, async (tx) => {
      await this.exigirLocal(tx, p.local_id);
      const cnpj = p.cnpj?.trim() || null;
      if (cnpj) {
        const dup = await tx.db.selectFrom("fin_fornecedor").select("id").where("local_id", "=", p.local_id).where("cnpj", "=", cnpj).executeTakeFirst();
        if (dup) throw new ErroDominio("VALIDACAO_FALHOU", "Já existe um fornecedor com este CNPJ neste local.");
      }
      const id = novoId();
      await tx.db.insertInto("fin_fornecedor").values({ id, local_id: p.local_id, razao_social: p.razao_social.trim(), cnpj, contato: null, banco: null, criado_em: tx.relogio.agora().toISOString() }).execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_fornecedor.criar", alvoTipo: "fin_fornecedor", alvoId: id, dados: p });
      return { id, local_id: p.local_id, razao_social: p.razao_social.trim(), cnpj, contato: null };
    });
  }

  async listarClientes(local_id: UUID): Promise<ClienteFin[]> {
    const l = (await this.ctx.db.selectFrom("fin_cliente").selectAll().where("local_id", "=", local_id).orderBy("nome").orderBy("id").execute()) as any[];
    return l.map((c) => ({
      id: c.id, local_id: c.local_id, nome: c.nome, cpf_cnpj: c.cpf_cnpj, tipo: c.tipo,
      contato: json<ContatoCliente>(c.contato, {}), politica: json<PoliticaCliente>(c.politica, {}),
    }));
  }

  /** Cadastro rápido de cliente (documento único por local). */
  async criarCliente(p: { local_id: UUID; nome: string; cpf_cnpj?: string }, usuario: Usuario): Promise<ClienteFin> {
    return emTransacao(this.ctx, async (tx) => {
      await this.exigirLocal(tx, p.local_id);
      const doc = p.cpf_cnpj?.trim() || null;
      if (doc) {
        const dup = await tx.db.selectFrom("fin_cliente").select("id").where("local_id", "=", p.local_id).where("cpf_cnpj", "=", doc).executeTakeFirst();
        if (dup) throw new ErroDominio("VALIDACAO_FALHOU", "Já existe um cliente com este documento neste local.");
      }
      const id = novoId();
      const digitos = (doc ?? "").replace(/\D/g, "");
      await tx.db.insertInto("fin_cliente").values({
        id, local_id: p.local_id, nome: p.nome.trim(), cpf_cnpj: doc, tipo: digitos.length === 14 ? "pessoa_juridica" : "pessoa_fisica", contato: null, criado_em: tx.relogio.agora().toISOString(),
      }).execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_cliente.criar", alvoTipo: "fin_cliente", alvoId: id, dados: p });
      return (await new CadastrosFinanceiroService(tx).listarClientes(p.local_id)).find((c) => c.id === id)!;
    });
  }

  /** Dados de contato e política de faturamento do cliente (usados ao fechar a fatura). */
  async atualizarCliente(id: UUID, dados: { contato?: ContatoCliente; politica?: PoliticaCliente }, usuario: Usuario): Promise<void> {
    await emTransacao(this.ctx, async (tx) => {
      const c = await tx.db.selectFrom("fin_cliente").select("id").where("id", "=", id).executeTakeFirst();
      if (!c) throw new ErroDominio("NAO_ENCONTRADO", "Cliente não encontrado.");
      const set: Record<string, string> = {};
      if (dados.contato) set.contato = JSON.stringify(dados.contato);
      if (dados.politica) set.politica = JSON.stringify(dados.politica);
      if (Object.keys(set).length === 0) return;
      await tx.db.updateTable("fin_cliente").set(set).where("id", "=", id).execute();
      await auditar(tx, { ator: usuario.email, acao: "fin_cliente.atualizar", alvoTipo: "fin_cliente", alvoId: id, dados });
    });
  }
}
