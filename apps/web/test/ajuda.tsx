import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import type { UsuarioSessao } from "../src/api/tipos";

export const usuarioPadrao: UsuarioSessao = {
  id: "u1",
  nome: "Maria Recepção",
  perfil: "recepcao",
  permissoes: [],
  trocarSenha: false,
  limiteDesconto: 10,
};

export function renderizar(ui: ReactElement, opcoes: { rota?: string; usuario?: Partial<UsuarioSessao> } = {}) {
  localStorage.setItem("erp.token", "token-falso");
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const usuario = { ...usuarioPadrao, ...opcoes.usuario };
  return {
    usuario,
    cliente,
    ...render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={[opcoes.rota ?? "/"]}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}
