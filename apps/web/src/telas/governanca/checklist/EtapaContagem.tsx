import { useState } from "react";
import type { ItemModelo } from "./EtapaSimNao";

const LIMITE_CONFIRMACAO = 20;
const MAXIMO = 999;

type Props = {
  itens: ItemModelo[];
  valores: Record<string, number | undefined>;
  /** Maior valor com botão próprio (enxoval 4, frigobar 3); acima disso usa o "+". */
  maximoBotao: number;
  aoMudar: (id: string, quantidade: number) => void;
  /** Texto extra por item (ex.: preço). */
  detalhe?: (id: string) => string | undefined;
};

export function EtapaContagem({ itens, valores, maximoBotao, aoMudar, detalhe }: Props) {
  return (
    <ul className="checklist__itens">
      {itens.map((i) => (
        <LinhaContagem key={i.id} item={i} valor={valores[i.id]} maximoBotao={maximoBotao} aoMudar={(n) => aoMudar(i.id, n)} detalhe={detalhe?.(i.id)} />
      ))}
    </ul>
  );
}

function LinhaContagem({ item, valor, maximoBotao, aoMudar, detalhe }: { item: ItemModelo; valor: number | undefined; maximoBotao: number; aoMudar: (n: number) => void; detalhe?: string }) {
  const [digitando, setDigitando] = useState(false);
  const [texto, setTexto] = useState("");
  const [pendente, setPendente] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const botoes = Array.from({ length: maximoBotao + 1 }, (_, n) => n);
  const grande = valor !== undefined && valor > maximoBotao;

  function aplicar() {
    const t = texto.trim();
    const n = Number(t);
    if (t === "" || !Number.isInteger(n) || n < 0 || n > MAXIMO) {
      setErro(`Informe um número inteiro de 0 a ${MAXIMO}.`);
      return;
    }
    setErro(null);
    if (n > LIMITE_CONFIRMACAO) setPendente(n);
    else aceitar(n);
  }
  function aceitar(n: number) {
    aoMudar(n);
    setPendente(null);
    setDigitando(false);
    setTexto("");
  }

  return (
    <li className="checklist__item">
      <div role="group" aria-label={item.texto} className="checklist__grupo">
        <span className="checklist__texto">
          {item.texto}
          {detalhe && <small className="checklist__detalhe"> {detalhe}</small>}
        </span>
        <div className="checklist__opcoes">
          {botoes.map((n) => (
            <button key={n} type="button" className="checklist__opcao checklist__opcao--numero" aria-pressed={valor === n} onClick={() => { setDigitando(false); setPendente(null); aoMudar(n); }}>
              {n}
            </button>
          ))}
          <button type="button" className="checklist__opcao checklist__opcao--numero" aria-pressed={grande || digitando} onClick={() => setDigitando(true)}>
            +
          </button>
        </div>
        {grande && !digitando && <span className="checklist__nota">{valor} unidades</span>}
        {digitando && (
          <div className="checklist__quantidade">
            <label>
              Quantidade de {item.texto}
              <input type="number" inputMode="numeric" min={0} max={MAXIMO} value={texto} onChange={(e) => { setTexto(e.target.value); setPendente(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); aplicar(); } }} />
            </label>
            <button type="button" className="checklist__opcao" onClick={aplicar}>
              Aplicar
            </button>
          </div>
        )}
        {erro && <p role="alert" className="erro-acao">{erro}</p>}
        {pendente !== null && (
          <div className="checklist__confirmar" role="alert">
            <p>Confirmar {pendente} unidades?</p>
            <button type="button" className="checklist__opcao" onClick={() => aceitar(pendente)}>
              Confirmar
            </button>
            <button type="button" className="checklist__opcao" onClick={() => setPendente(null)}>
              Corrigir
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
