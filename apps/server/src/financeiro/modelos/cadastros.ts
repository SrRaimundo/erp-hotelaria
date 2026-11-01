import type { UUID } from "../../shared/ids.js";
import type { Endereco } from "../../shared/endereco.js";
import type { Dinheiro } from "../../shared/dinheiro.js";

export type Cliente = {
  id: UUID;
  local_id: UUID;
  nome: string;
  cpf_cnpj: string;
  tipo: "pessoa_fisica" | "pessoa_juridica";
  contato: {
    email: string;
    telefone: string;
    endereco: Endereco;
  };
};

export type Fornecedor = {
  id: UUID;
  local_id: UUID;
  razao_social: string;
  cnpj: string;
  contato: {
    email: string;
    telefone: string;
    endereco: Endereco;
  };
  banco: {
    banco: string;
    agencia: string;
    conta: string;
  };
};

export type ContaBancaria = {
  id: UUID;
  local_id: UUID;
  nome: string;
  banco: string;
  agencia: string;
  numero: string;
  tipo: "corrente" | "poupanca" | "aplicacao";
  saldo_inicial: Dinheiro;
  data_saldo_inicial: Date;
  ativo: boolean;
};

export type Moeda = {
  id: UUID;
  codigo: string;
  nome: string;
  taxa_cambio: number;
  ativo: boolean;
};
