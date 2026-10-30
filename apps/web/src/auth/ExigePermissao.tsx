import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router";
import { rotaInicial, useSessao } from "./SessaoProvider";

/**
 * Só renderiza a tela se o usuário tiver a permissão (ou, com `algumaDe`, qualquer uma da lista);
 * senão leva à tela inicial do perfil.
 */
export function ExigePermissao({ permissao, algumaDe, children }: { permissao?: string; algumaDe?: string[]; children: ReactElement }) {
  const { usuario, pode } = useSessao();
  const local = useLocation();
  const permitido = algumaDe ? algumaDe.some(pode) : permissao !== undefined && pode(permissao);
  if (permitido) return children;
  const destino = usuario ? rotaInicial(usuario) : "/";
  // Se a própria tela inicial é proibida, redirecionar giraria em círculo.
  if (local.pathname === destino) return <p role="alert" className="reserva-suave">Você não tem permissão para abrir esta tela.</p>;
  return <Navigate to={destino} replace />;
}
