import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { chamarApi, CHAVE_TOKEN, definirToken, EVENTO_SESSAO_EXPIRADA } from "../api/cliente";
import type { UsuarioSessao } from "../api/tipos";

export const CHAVE_USUARIO = "erp.usuario";

type Sessao = {
  usuario: UsuarioSessao | null;
  entrar(login: string, senha: string): Promise<void>;
  sair(): Promise<void>;
  trocarSenha(atual: string, nova: string): Promise<void>;
  pode(permissao: string): boolean;
};

const Contexto = createContext<Sessao | null>(null);

function lerUsuario(): UsuarioSessao | null {
  try {
    if (!localStorage.getItem(CHAVE_TOKEN)) return null;
    const bruto = localStorage.getItem(CHAVE_USUARIO);
    return bruto ? (JSON.parse(bruto) as UsuarioSessao) : null;
  } catch {
    return null;
  }
}

function guardar(usuario: UsuarioSessao): void {
  localStorage.setItem(CHAVE_USUARIO, JSON.stringify(usuario));
}

function limparArmazenamento(): void {
  definirToken(null);
  localStorage.removeItem(CHAVE_USUARIO);
}

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(lerUsuario);
  const consultas = useQueryClient();
  const navegar = useNavigate();

  const encerrar = useCallback(() => {
    limparArmazenamento();
    setUsuario(null);
    consultas.clear();
  }, [consultas]);

  useEffect(() => {
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, encerrar);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, encerrar);
  }, [encerrar]);

  const entrar = useCallback(async (login: string, senha: string) => {
    const r = await chamarApi<{ token: string; usuario: UsuarioSessao }>("POST", "/api/sessoes", { login, senha });
    definirToken(r.token);
    guardar(r.usuario);
    setUsuario(r.usuario);
  }, []);

  const sair = useCallback(async () => {
    try {
      await chamarApi("DELETE", "/api/sessoes");
    } catch {
      // Sair sempre funciona localmente, mesmo que o servidor não responda.
    }
    encerrar();
    void navegar("/login");
  }, [encerrar, navegar]);

  const trocarSenha = useCallback(
    async (atual: string, nova: string) => {
      await chamarApi("PUT", "/api/usuarios/me/senha", { senhaAtual: atual, novaSenha: nova });
      if (!usuario) return;
      const atualizado = { ...usuario, trocarSenha: false };
      guardar(atualizado);
      setUsuario(atualizado);
    },
    [usuario],
  );

  const valor = useMemo<Sessao>(
    () => ({ usuario, entrar, sair, trocarSenha, pode: (p) => usuario?.permissoes.includes(p) ?? false }),
    [usuario, entrar, sair, trocarSenha],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): Sessao {
  const s = useContext(Contexto);
  if (!s) throw new Error("useSessao fora de SessaoProvider");
  return s;
}

/** Rota inicial após o login: perfis só de governança caem direto em /governanca. */
export function rotaInicial(u: UsuarioSessao): string {
  return u.permissoes.length === 1 && u.permissoes[0] === "quartos.situacao" ? "/governanca" : "/";
}

/** Aceita só caminhos internos, para o parâmetro voltar não virar redirecionamento aberto. */
export function destinoSeguro(voltar: string | null, u: UsuarioSessao): string {
  return voltar && voltar.startsWith("/") && !voltar.startsWith("//") && !voltar.startsWith("/login") ? voltar : rotaInicial(u);
}
