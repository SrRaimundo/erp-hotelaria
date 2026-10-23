import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import type { UsuarioSessao } from "../src/api/tipos";
import { SessaoProvider } from "../src/auth/SessaoProvider";

export const usuarioPadrao: UsuarioSessao = {
  id: "u1",
  nome: "Maria Recepção",
  perfil: "recepcao",
  permissoes: [],
  trocarSenha: false,
  limiteDesconto: 10,
};

type Opcoes = { rota?: string; usuario?: Partial<UsuarioSessao>; semSessao?: boolean };

/** Renderiza com QueryClient, roteador em memória e a SessaoProvider real (sessão semeada no localStorage). */
export function renderizar(ui: ReactElement, opcoes: Opcoes = {}) {
  const usuario = { ...usuarioPadrao, ...opcoes.usuario };
  if (!opcoes.semSessao) {
    localStorage.setItem("erp.token", "token-falso");
    localStorage.setItem("erp.usuario", JSON.stringify(usuario));
  }
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return {
    usuario,
    cliente,
    ...render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={[opcoes.rota ?? "/"]}>
          <SessaoProvider>{ui}</SessaoProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}
