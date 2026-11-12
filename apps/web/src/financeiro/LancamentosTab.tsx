import { useMemo, useState } from "react";
import { Botao } from "../componentes/Botao";
import { Cartao } from "../componentes/Cartao";
import { Etiqueta } from "../componentes/Etiqueta";
import { JanelaSupervisor } from "../componentes/JanelaSupervisor";
import { formatarReais } from "../lib/dinheiro";
import { dataBr, Estado, rotuloStatus } from "./comuns";
import { useCancelarLancamento, useLancamentos, type Lancamento } from "./useFinanceiro";

const STATUS = ["pendente", "confirmado", "liquidado", "cancelado"];
const ORIGENS = ["hospedagem", "reserva", "bar", "lavanderia", "rh", "manual"];
const tom = (s: string) => (s === "cancelado" ? "terracota" : s === "pendente" ? "amarelo" : "verde");

export function LancamentosTab({ localId }: { localId: string }) {
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [origem, setOrigem] = useState("");
  const [status, setStatus] = useState("");
  const [alvo, setAlvo] = useState<Lancamento | null>(null);
  const q = useLancamentos(localId, { inicio, fim });
  const cancelar = useCancelarLancamento();

  const linhas = useMemo(
    () => (q.data ?? []).filter((l) => (!origem || l.origem === origem) && (!status || l.status === status)),
    [q.data, origem, status],
  );

  return (
    <Cartao className="fin__bloco">
      <div className="fin__filtros">
        <div className="campo"><label htmlFor="lan-ini">De</label><input id="lan-ini" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></div>
        <div className="campo"><label htmlFor="lan-fim">Até</label><input id="lan-fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></div>
        <div className="campo"><label htmlFor="lan-ori">Origem</label>
          <select id="lan-ori" value={origem} onChange={(e) => setOrigem(e.target.value)}>
            <option value="">Todas</option>{ORIGENS.map((o) => <option key={o}>{o}</option>)}
          </select></div>
        <div className="campo"><label htmlFor="lan-sta">Status</label>
          <select id="lan-sta" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>{STATUS.map((o) => <option key={o}>{o}</option>)}
          </select></div>
      </div>
      <Estado carregando={q.isLoading} erro={q.error}>
        {linhas.length === 0 ? (
          <p className="fin__suave">Nenhum lançamento encontrado.</p>
        ) : (
          <div className="fin__rolagem">
            <table className="fin__tabela">
              <thead><tr><th>Data</th><th>Tipo</th><th>Origem</th><th>Forma</th><th className="fin__num">Valor</th><th>Status</th><th><span className="fin__oculto">Ações</span></th></tr></thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.id}>
                    <td>{dataBr(l.data)}</td><td>{l.tipo}</td><td>{l.origem}</td><td>{l.forma_pagamento}</td>
                    <td className="fin__num">{formatarReais(l.valor)}</td>
                    <td><Etiqueta tom={tom(l.status)}>{rotuloStatus(l.status)}</Etiqueta></td>
                    <td>{l.status !== "cancelado" && <Botao variante="contorno" tamanho="pequeno" onClick={() => setAlvo(l)}>Cancelar</Botao>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Estado>
      <JanelaSupervisor
        aberta={alvo !== null}
        titulo="Cancelar lançamento"
        aoCancelar={() => setAlvo(null)}
        aoConfirmar={async (aut) => {
          if (!alvo) return;
          await cancelar.mutateAsync({ id: alvo.id, aut });
          setAlvo(null);
        }}
      />
    </Cartao>
  );
}
