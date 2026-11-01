import { NavLink, Navigate, Outlet } from "react-router";
import { useSessao } from "../../auth/SessaoProvider";
import { useEstadoAssistente } from "../assistente/Assistente";
import { TELAS_CONFIGURACOES } from "./telas";
import "./configuracoes.css";

/** Submenu à esquerda (lista no topo no celular) + a tela escolhida. */
export function LayoutConfiguracoes() {
  const { pode } = useSessao();
  const telas = TELAS_CONFIGURACOES.filter((t) => pode(t.permissao));
  return (
    <div className="configuracoes">
      <nav aria-label="Configurações" className="configuracoes__submenu">
        {telas.map((t) => (
          <NavLink key={t.caminho} to={`/configuracoes/${t.caminho}`} className="configuracoes__item">
            {t.rotulo}
          </NavLink>
        ))}
      </nav>
      <div className="configuracoes__conteudo">
        <Outlet />
      </div>
    </div>
  );
}

/** `/configuracoes` leva à primeira tela permitida. */
export function PrimeiraConfiguracao() {
  const { pode } = useSessao();
  const estado = useEstadoAssistente(pode("config.gerenciar"));
  // Enquanto não há quartos ativos, quem configura a pousada cai no assistente (falha na consulta: segue o normal).
  if (pode("config.gerenciar") && estado.isPending) return null;
  if (estado.data && !estado.data.quartos) return <Navigate to="/configuracoes/assistente" replace />;
  const primeira = TELAS_CONFIGURACOES.find((t) => pode(t.permissao));
  return primeira ? <Navigate to={`/configuracoes/${primeira.caminho}`} replace /> : null;
}
