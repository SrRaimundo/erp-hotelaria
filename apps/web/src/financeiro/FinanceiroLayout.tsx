import { useEffect, useState } from "react";
import { Cartao } from "../componentes/Cartao";
import { CaixaBancoTab } from "./CaixaBancoTab";
import { ContasReceberTab } from "./ContasReceberTab";
import { LancamentosTab } from "./LancamentosTab";
import { RelatoriosTab } from "./RelatoriosTab";
import { dataLocal, useConsolidado } from "./useFinanceiro";
import "./financeiro.css";

const ABAS = [
  { id: "lancamentos", rotulo: "Lançamentos" },
  { id: "caixa", rotulo: "Caixa/Banco" },
  { id: "receber", rotulo: "Contas a Receber" },
  { id: "relatorios", rotulo: "Relatórios" },
] as const;
type AbaId = (typeof ABAS)[number]["id"];

const CHAVE_LOCAL = "erp.financeiro.local";
const CHAVE_CONTA = "erp.financeiro.conta";
const ler = (k: string) => {
  try { return localStorage.getItem(k) ?? ""; } catch { return ""; }
};
const gravar = (k: string, v: string) => {
  try { localStorage.setItem(k, v); } catch { /* sem armazenamento: só não lembra */ }
};

export function FinanceiroLayout() {
  const [aba, setAba] = useState<AbaId>("lancamentos");
  const [localId, setLocalId] = useState(() => ler(CHAVE_LOCAL));
  const [contaId, setContaId] = useState(() => ler(CHAVE_CONTA));
  // A API não lista locais; o consolidado devolve todos (id + nome) e serve de fonte do seletor.
  const [periodo] = useState(() => ({ inicio: dataLocal(-30), fim: dataLocal() }));
  const locais = useConsolidado(periodo);
  const lista = locais.data?.locais;

  useEffect(() => {
    if (!localId && lista && lista.length > 0) setLocalId(lista[0]!.local_id);
  }, [localId, lista]);
  useEffect(() => gravar(CHAVE_LOCAL, localId), [localId]);
  useEffect(() => gravar(CHAVE_CONTA, contaId), [contaId]);

  return (
    <div className="fin">
      <header className="fin__topo">
        <h1>Financeiro</h1>
        <div className="fin__seletores">
          <div className="campo">
            <label htmlFor="fin-local">Local</label>
            {lista && lista.length > 0 ? (
              <select id="fin-local" value={localId} onChange={(e) => setLocalId(e.target.value)}>
                {lista.map((l) => (
                  <option key={l.local_id} value={l.local_id}>{l.nome}</option>
                ))}
              </select>
            ) : (
              <input id="fin-local" value={localId} onChange={(e) => setLocalId(e.target.value.trim())} placeholder="ID do local" />
            )}
          </div>
          <div className="campo">
            <label htmlFor="fin-conta">Conta (caixa/banco)</label>
            <input id="fin-conta" value={contaId} onChange={(e) => setContaId(e.target.value.trim())} placeholder="ID da conta" />
          </div>
        </div>
      </header>

      <div role="tablist" aria-label="Seções do financeiro" className="fin__abas">
        {ABAS.map((a) => (
          <button key={a.id} type="button" role="tab" id={`fin-aba-${a.id}`} aria-selected={aba === a.id} aria-controls="fin-painel"
            className={aba === a.id ? "fin__aba fin__aba--ativa" : "fin__aba"} onClick={() => setAba(a.id)}>
            {a.rotulo}
          </button>
        ))}
      </div>

      <div id="fin-painel" role="tabpanel" aria-labelledby={`fin-aba-${aba}`}>
        {!localId && (aba === "lancamentos" || aba === "receber") ? (
          <Cartao>Selecione um local para começar.</Cartao>
        ) : (
          <>
            {aba === "lancamentos" && <LancamentosTab localId={localId} />}
            {aba === "caixa" && <CaixaBancoTab contaId={contaId} />}
            {aba === "receber" && <ContasReceberTab localId={localId} contaId={contaId} />}
            {aba === "relatorios" && <RelatoriosTab localId={localId} contaId={contaId} />}
          </>
        )}
      </div>
    </div>
  );
}
