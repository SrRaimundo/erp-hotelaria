/**
 * Endereco: Estrutura padrão para endereços no sistema.
 */
export type Endereco = {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
};
