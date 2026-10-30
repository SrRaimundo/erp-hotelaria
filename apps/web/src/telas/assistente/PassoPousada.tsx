import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { useConfig } from "../../api/consultas";
import { SecaoDados, SecaoHorarios } from "../configuracoes/TelaPousada";

/** Passo 1: reaproveita as seções Dados e Horários da tela Pousada (cada uma grava no seu Salvar). */
export function PassoPousada({ aoAvancar }: { aoAvancar: () => void }) {
  const config = useConfig();
  const preenchida = (config.data?.razaoSocial ?? "").trim() !== "";
  return (
    <div className="pousada">
      <h2>Pousada</h2>
      <p className="cq__aviso">Salve cada seção; para avançar, a razão social precisa estar salva.</p>
      {config.isError && <ErroAcao erro={config.error} />}
      {config.data ? (
        <>
          <SecaoDados config={config.data} />
          <SecaoHorarios config={config.data} />
        </>
      ) : (
        !config.isError && <p>Carregando…</p>
      )}
      {!preenchida && config.data && <p className="cq__aviso">Salve a razão social em Dados para avançar.</p>}
      <div className="assistente__acoes">
        <span />
        <Botao disabled={!preenchida} onClick={aoAvancar}>Avançar</Botao>
      </div>
    </div>
  );
}
