import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";
import type { Data } from "../shared/tempo.js";

export type Endereco = { logradouro: string; cidade: string; uf: string; pais: string; cep?: string };
export type Hospede = {
  id: string;
  nome: string;
  documentoTipo: "cpf" | "passaporte";
  documento: string | null;
  nascimento: Data | null;
  nacionalidade: string;
  telefone?: string;
  email?: string;
  endereco?: Endereco;
  observacoes?: string;
};
export type DadosHospede = Omit<Hospede, "id"> & { id?: string };

export function normalizarBusca(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

const soDigitos = (s: string) => s.replace(/\D/g, "");

export function cpfValido(cpf: string): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[n])) return false;
  }
  return true;
}

export function paraHospede(l: any): Hospede {
  const h: Hospede = {
    id: l.id,
    nome: l.nome,
    documentoTipo: l.documento_tipo,
    documento: l.documento,
    nascimento: l.nascimento,
    nacionalidade: l.nacionalidade,
  };
  if (l.telefone != null) h.telefone = l.telefone;
  if (l.email != null) h.email = l.email;
  if (l.endereco != null) h.endereco = JSON.parse(l.endereco);
  if (l.observacoes != null) h.observacoes = l.observacoes;
  return h;
}

/** Cria (sem `id`, ou com `id` ainda inexistente) ou atualiza (com `id` existente) o hóspede. */
export async function salvarHospede(ctx: Contexto, dados: DadosHospede, ator: string): Promise<Hospede> {
  return emTransacao(ctx, async (tx) => {
    let documento = dados.documento?.trim() ? dados.documento.trim() : null;
    if (documento && dados.documentoTipo === "cpf") {
      if (!cpfValido(documento)) throw new ErroDominio("CPF_INVALIDO", "CPF inválido. Confira os números digitados.");
      documento = soDigitos(documento);
    } else if (documento) {
      documento = documento.replace(/\s+/g, "").toUpperCase();
    }
    const id = dados.id ?? novoId();
    if (documento) {
      const dup = await tx.db
        .selectFrom("hospedes")
        .select("id")
        .where("documento_tipo", "=", dados.documentoTipo)
        .where("documento", "=", documento)
        .where("id", "!=", id)
        .executeTakeFirst();
      if (dup) {
        throw new ErroDominio(
          "DOCUMENTO_DUPLICADO",
          "Já existe um hóspede com este documento. Abra o cadastro existente.",
          { hospedeId: dup.id },
        );
      }
    }
    const existente = await tx.db.selectFrom("hospedes").select("id").where("id", "=", id).executeTakeFirst();
    const linha = {
      nome: dados.nome,
      nome_busca: normalizarBusca(dados.nome),
      documento_tipo: dados.documentoTipo,
      documento,
      nascimento: dados.nascimento ?? null,
      nacionalidade: dados.nacionalidade,
      telefone: dados.telefone ?? null,
      email: dados.email ?? null,
      endereco: dados.endereco ? JSON.stringify(dados.endereco) : null,
      observacoes: dados.observacoes ?? null,
    };
    if (existente) await tx.db.updateTable("hospedes").set(linha).where("id", "=", id).execute();
    else await tx.db.insertInto("hospedes").values({ id, ...linha }).execute();
    const salvo = paraHospede(await tx.db.selectFrom("hospedes").selectAll().where("id", "=", id).executeTakeFirstOrThrow());
    await auditar(tx, {
      ator,
      acao: existente ? "hospede.atualizar" : "hospede.criar",
      alvoTipo: "hospede",
      alvoId: id,
      dados: salvo,
    });
    await registrarEvento(tx, existente ? "nucleo.HospedeAtualizado" : "nucleo.HospedeCriado", { hospedeId: id });
    return salvo;
  });
}

export async function buscarHospedes(ctx: Contexto, termo: string): Promise<Hospede[]> {
  const t = normalizarBusca(termo);
  if (!t) return [];
  const digitos = soDigitos(termo);
  const padraoNome = `%${t.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const linhas = await ctx.db
    .selectFrom("hospedes")
    .selectAll()
    .where((eb) =>
      eb.or([
        eb("nome_busca", "like", padraoNome),
        ...(digitos ? [eb("documento", "like", `%${digitos}%`)] : []),
      ]),
    )
    .orderBy("nome_busca")
    .orderBy("id")
    .execute();
  return linhas.map(paraHospede);
}

export function pendenciasFnrh(h: Hospede, adulto: boolean): string[] {
  const falta: string[] = [];
  if (!h.nome?.trim()) falta.push("nome");
  if (adulto && !h.documento) falta.push("documento");
  if (!h.nascimento) falta.push("nascimento");
  if (adulto) {
    if (!h.nacionalidade?.trim()) falta.push("nacionalidade");
    if (!h.endereco?.cidade?.trim()) falta.push("endereco.cidade");
    if (!h.telefone?.trim() && !h.email?.trim()) falta.push("contato");
  }
  return falta;
}
