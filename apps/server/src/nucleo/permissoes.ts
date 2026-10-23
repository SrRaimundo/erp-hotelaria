import { ErroDominio } from "../shared/erros.js";

export const PERMISSOES = [
  "cadastros.gerenciar",
  "tarifas.gerenciar",
  "reservas.gerenciar",
  "hospedagem.checkin",
  "hospedagem.checkout",
  "conta.lancar",
  "caixa.operar",
  "quartos.situacao",
  "quartos.manutencao",
  "config.gerenciar",
  "supervisor",
] as const;

export type Permissao = (typeof PERMISSOES)[number];

export type UsuarioSessao = {
  id: string;
  nome: string;
  perfil: string;
  permissoes: string[];
  limiteDesconto: number;
  trocarSenha: boolean;
};

const SO_ADMIN: Permissao[] = ["cadastros.gerenciar", "tarifas.gerenciar", "config.gerenciar", "supervisor"];

export const PERFIS_PADRAO: { nome: string; limiteDesconto: number; permissoes: string[] }[] = [
  { nome: "admin", limiteDesconto: 100, permissoes: [...PERMISSOES] },
  { nome: "recepcao", limiteDesconto: 5, permissoes: PERMISSOES.filter((p) => !SO_ADMIN.includes(p)) },
  { nome: "governanca", limiteDesconto: 0, permissoes: ["quartos.situacao"] },
];

export function exigirPermissao(u: UsuarioSessao, p: string): void {
  if (!u.permissoes.includes(p)) {
    throw new ErroDominio("SEM_PERMISSAO", "Você não tem permissão para realizar esta ação.", { permissao: p });
  }
}

export function exigirAlgumaPermissao(u: UsuarioSessao, ps: string[]): void {
  if (!ps.some((p) => u.permissoes.includes(p))) {
    throw new ErroDominio("SEM_PERMISSAO", "Você não tem permissão para realizar esta ação.", { permissoes: ps });
  }
}
