import { ErroAcao } from "../../../componentes/ErroAcao";
import type { ItemModelo } from "./EtapaSimNao";
import type { Resposta } from "./rascunho";

export type OpcaoResposta = { valor: string; rotulo: string; problema?: boolean };

type ListaProps = {
  itens: ItemModelo[];
  respostas: Record<string, Resposta>;
  campo: "equipamento" | "presenca";
  opcoes: OpcaoResposta[];
  /** Itens com chamada em andamento: novos toques são ignorados até ela terminar. */
  pendentes: ReadonlySet<string>;
  erros: Record<string, Error | undefined>;
  online: boolean;
  /** Texto exibido quando o chamado/aviso já existe (ex.: "Chamado aberto"). */
  rotuloRegistrado: string;
  /** Campo de observação mostrado quando o item está em problema (só equipamentos). */
  perguntaObservacao?: string;
  aoEscolher: (id: string, valor: string) => void;
  aoObservar?: (id: string, texto: string) => void;
  /** Quando existe, o chamado só abre ao tocar em "Abrir chamado" (ou ao sair da etapa), levando a observação. */
  aoAbrir?: (id: string) => void;
};

/** Lista de itens com botões de resposta e o estado do chamado/aviso ligado ao item. */
export function ListaOpcoes({ itens, respostas, campo, opcoes, pendentes, erros, online, rotuloRegistrado, perguntaObservacao, aoEscolher, aoObservar, aoAbrir }: ListaProps) {
  return (
    <ul className="checklist__itens">
      {itens.map((i) => {
        const r = respostas[i.id];
        const atual = r?.[campo];
        const problema = opcoes.find((o) => o.valor === atual)?.problema === true;
        const registrado = r?.chamadoId !== undefined || r?.alertaId !== undefined;
        return (
          <li key={i.id} className="checklist__item">
            <div role="group" aria-label={i.texto} className="checklist__grupo">
              <span className="checklist__texto">{i.texto}</span>
              <div className="checklist__opcoes">
                {opcoes.map((o) => (
                  <button key={o.valor} type="button" className="checklist__opcao" aria-pressed={atual === o.valor} disabled={pendentes.has(i.id)} onClick={() => aoEscolher(i.id, o.valor)}>
                    {o.rotulo}
                  </button>
                ))}
              </div>
              {problema && registrado && <span className="checklist__nota checklist__nota--aviso">{rotuloRegistrado}</span>}
              {problema && !registrado && pendentes.has(i.id) && <span className="checklist__nota">Registrando…</span>}
              {problema && !registrado && !pendentes.has(i.id) && !online && <span className="checklist__nota">Será registrado ao concluir</span>}
              <ErroAcao erro={erros[i.id]} />
              {problema && aoAbrir && !registrado && online && !pendentes.has(i.id) && (
                <button type="button" className="checklist__opcao" onClick={() => aoAbrir(i.id)}>
                  Abrir chamado
                </button>
              )}
              {problema && perguntaObservacao && aoObservar && (
                <label className="checklist__observacao">
                  {perguntaObservacao}
                  <textarea value={r?.observacao ?? ""} readOnly={r?.chamadoId !== undefined} onChange={(e) => aoObservar(i.id, e.target.value)} rows={2} />
                </label>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

type Props = Omit<ListaProps, "campo" | "opcoes" | "rotuloRegistrado" | "perguntaObservacao"> & { aoAbrir: (id: string) => void };

const OPCOES: OpcaoResposta[] = [
  { valor: "funciona", rotulo: "Funciona" },
  { valor: "nao_funciona", rotulo: "Não funciona", problema: true },
  { valor: "nao_se_aplica", rotulo: "Não se aplica" },
];

export function EtapaEquipamentos(props: Props) {
  return <ListaOpcoes {...props} campo="equipamento" opcoes={OPCOES} rotuloRegistrado="Chamado aberto" perguntaObservacao="O que aconteceu? (opcional)" />;
}
