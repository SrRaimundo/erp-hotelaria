import type { Resposta } from "./rascunho";

export type ItemModelo = { id: string; texto: string };

export function EtapaSimNao({ itens, respostas, aoMudar }: { itens: ItemModelo[]; respostas: Record<string, Resposta>; aoMudar: (id: string, r: Partial<Resposta>) => void }) {
  return (
    <ul className="checklist__itens">
      {itens.map((i) => {
        const v = respostas[i.id]?.simNao;
        return (
          <li key={i.id} className="checklist__item">
            <div role="group" aria-label={i.texto} className="checklist__grupo">
              <span className="checklist__texto">{i.texto}</span>
              <div className="checklist__opcoes">
                <button type="button" className="checklist__opcao" aria-pressed={v === true} onClick={() => aoMudar(i.id, { simNao: true })}>
                  Sim
                </button>
                <button type="button" className="checklist__opcao" aria-pressed={v === false} onClick={() => aoMudar(i.id, { simNao: false })}>
                  Não
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
