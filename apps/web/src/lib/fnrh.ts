import type { Hospede } from "../api/tipos";

const NOMES: Record<string, string> = {
  nome: "nome",
  documento: "documento",
  nascimento: "data de nascimento",
  nacionalidade: "nacionalidade",
  "endereco.cidade": "cidade",
  contato: "telefone ou e-mail",
};

/** Nome amigável de um campo pendente da FNRH. */
export const nomeCampoFnrh = (campo: string): string => NOMES[campo] ?? campo;

/** Mesma regra do servidor (`pendenciasFnrh`): menores de 18 anos na chegada precisam de menos campos. */
export function pendenciasFnrh(h: Pick<Hospede, "nome" | "documento" | "nascimento" | "nacionalidade" | "telefone" | "email" | "endereco">, chegada: string): string[] {
  const adulto = h.nascimento ? `${Number(h.nascimento.slice(0, 4)) + 18}${h.nascimento.slice(4)}` <= chegada : true;
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
