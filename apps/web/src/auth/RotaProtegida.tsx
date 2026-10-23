import { Navigate, Outlet, useLocation } from "react-router";
import { useSessao } from "./SessaoProvider";

export function RotaProtegida() {
  const { usuario } = useSessao();
  const local = useLocation();
  const atual = local.pathname + local.search;
  if (!usuario) return <Navigate to={`/login?voltar=${encodeURIComponent(atual)}`} replace />;
  if (usuario.trocarSenha) return <Navigate to={`/trocar-senha?voltar=${encodeURIComponent(atual)}`} replace />;
  return <Outlet />;
}
