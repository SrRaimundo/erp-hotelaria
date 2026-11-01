import { useState } from "react";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { useConfig } from "../../api/consultas";
import { SecaoDados, SecaoHorarios } from "../configuracoes/TelaPousada";

/** Passo 1: reaproveita as seções Dados e Horários da tela Pousada (cada uma grava no seu Salvar). */
export function PassoPousada({ aoAvancar }: { aoAvancar: () => void }) {
  const config = useConfig();
  const [sujos, setSujos] = useState({ dados: false, horarios: false });
  const [avisar, setAvisar] = useState(false);
  const pendente = sujos.dados || sujos.horarios;
  const preenchida = (config.data?.razaoSocial ?? "").trim() !== "";
  return (
    <div className="pousada">
      <h2>Pousada</h2>
      <p className="cq__aviso">Salve cada seção; para avançar, a razão social precisa estar salva.</p>
      {config.isError && <ErroAcao erro={config.error} />}
      {config.data ? (
        <>
          <SecaoDados config={config.data} aoMudarSujo={(dados) => setSujos((x) => ({ ...x, dados }))} />
          <SecaoHorarios config={config.data} aoMudarSujo={(horarios) => setSujos((x) => ({ ...x, horarios }))} />
        </>
      ) : (
        !config.isError && <p>Carregando…</p>
      )}
      {!preenchida && config.data && <p className="cq__aviso">Salve a razão social em Dados para avançar.</p>}
      {avisar && pendente && (
        <p className="cq__aviso" role="alert">
          Há alterações não salvas em {[sujos.dados && "Dados", sujos.horarios && "Horários"].filter(Boolean).join(" e ")}. Use o Salvar da seção antes de avançar.
        </p>
      )}
      <div className="assistente__acoes">
        <span />
        <Botao disabled={!preenchida} onClick={() => (pendente ? setAvisar(true) : aoAvancar())}>Avançar</Botao>
      </div>
    </div>
  );
}
