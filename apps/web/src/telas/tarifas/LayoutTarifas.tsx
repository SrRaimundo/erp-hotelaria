import { NavLink, Navigate, Outlet } from "react-router";
import { useSessao } from "../../auth/SessaoProvider";
import { ABAS_TARIFAS } from "./abas";
import "./tarifas.css";

/** Barra de abas (só as que o usuário pode abrir) + a aba escolhida. */
export function LayoutTarifas() {
  const { pode } = useSessao();
  const abas = ABAS_TARIFAS.filter((a) => pode(a.permissao));
  return (
    <div className="tarifas">
      <h1>Tarifas</h1>
      <nav aria-label="Abas de tarifas" className="tarifas__abas">
        {abas.map((a) => (
          <NavLink key={a.caminho} to={`/reservas/tarifas/${a.caminho}`} className="tarifas__aba">
            {a.rotulo}
          </NavLink>
        ))}
      </nav>
      <div className="tarifas__conteudo">
        <Outlet />
      </div>
    </div>
  );
}

/** `/reservas/tarifas` leva à primeira aba permitida. */
export function PrimeiraAbaTarifas() {
  const { pode } = useSessao();
  const primeira = ABAS_TARIFAS.find((a) => pode(a.permissao));
  return primeira ? <Navigate to={`/reservas/tarifas/${primeira.caminho}`} replace /> : null;
}
