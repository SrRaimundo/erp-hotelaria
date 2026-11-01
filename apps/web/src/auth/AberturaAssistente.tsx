import { useEffect } from "react";
import { useNavigate } from "react-router";
import { chamarApi, CHAVE_TOKEN } from "../api/cliente";
import { CHAVE_VERIFICAR_ASSISTENTE, useSessao } from "./SessaoProvider";

/**
 * Após qualquer login, quem configura a pousada (config.gerenciar), numa base sem quartos ativos,
 * é levado ao assistente (spec §4), uma vez por login. Falha na consulta: segue o destino normal.
 */
export function AberturaAssistente() {
  const { usuario, pode } = useSessao();
  const navegar = useNavigate();
  const podeConfigurar = pode("config.gerenciar");
  const aguardando = usuario !== null && !usuario.trocarSenha;

  useEffect(() => {
    if (!aguardando) return;
    let marcado = false;
    try {
      marcado = sessionStorage.getItem(CHAVE_VERIFICAR_ASSISTENTE) !== null;
      if (marcado) sessionStorage.removeItem(CHAVE_VERIFICAR_ASSISTENTE);
    } catch {
      return;
    }
    if (!marcado || !podeConfigurar) return;
    void chamarApi<{ quartos: boolean }>("GET", "/api/assistente")
      .then((estado) => {
        if (!estado.quartos && localStorage.getItem(CHAVE_TOKEN)) void navegar("/configuracoes/assistente", { replace: true });
      })
      .catch(() => {
        // sem conexão ou erro do servidor: segue o destino normal
      });
  }, [aguardando, podeConfigurar, navegar]);

  return null;
}
