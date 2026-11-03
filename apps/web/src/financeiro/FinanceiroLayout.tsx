import { useEffect, useState } from "react";
import { Cartao } from "../componentes/Cartao";
import { ErroAcao } from "../componentes/ErroAcao";
import { CaixaBancoTab } from "./CaixaBancoTab";
import { CartaoCreditoTab } from "./CartaoCreditoTab";
import { ContasPagarTab } from "./ContasPagarTab";
import { ContasReceberTab } from "./ContasReceberTab";
import { FaturamentoTab } from "./FaturamentoTab";
import { LocalTab } from "./LocalTab";
import { RelatoriosTab } from "./RelatoriosTab";
import { Selecao } from "./comuns";
import { useContas, useLocais } from "./useFinanceiro";
import "./financeiro.css";

export type AbaId = "local" | "pagar" | "receber" | "cartao" | "caixa" | "faturamento" | "relatorios";

const TITULOS: Record<AbaId, string> = {
  local: "Local",
  pagar: "Contas a Pagar",
  receber: "Contas a Receber",
  cartao: "Cartão de Crédito",
  caixa: "Caixa e Banco",
  faturamento: "Faturamento",
  relatorios: "Relatórios do Financeiro",
};

const CHAVE_LOCAL = "erp.financeiro.local";
const CHAVE_CONTA = "erp.financeiro.conta";
const ler = (k: string) => {
  try { return localStorage.getItem(k) ?? ""; } catch { return ""; }
};
const gravar = (k: string, v: string) => {
  try { localStorage.setItem(k, v); } catch { /* sem armazenamento: só não lembra */ }
};

/** Abas que mostram a conta escolhida no topo. */
const USA_CONTA: AbaId[] = ["caixa", "relatorios"];

/** A seção vem do menu lateral (uma rota por item), não de abas internas. */
export function FinanceiroLayout({ aba }: { aba: AbaId }) {
  const [localSalvo, setLocalSalvo] = useState(() => ler(CHAVE_LOCAL));
  const [contaSalva, setContaSalva] = useState(() => ler(CHAVE_CONTA));
  const locais = useLocais();
  const ativos = (locais.data ?? []).filter((l) => l.ativo);
  // O local lembrado só vale se ainda existir e estiver ativo; senão, o primeiro da lista.
  const localId = ativos.find((l) => l.id === localSalvo)?.id ?? ativos[0]?.id ?? "";
  const contas = useContas(aba === "local" ? "" : localId);
  const listaContas = contas.data ?? [];
  const contaId = listaContas.find((c) => c.id === contaSalva)?.id ?? listaContas[0]?.id ?? "";

  useEffect(() => { if (localId) gravar(CHAVE_LOCAL, localId); }, [localId]);
  useEffect(() => { if (contaId) gravar(CHAVE_CONTA, contaId); }, [contaId]);

  const semLocal = aba !== "local" && !locais.isLoading && !locais.error && ativos.length === 0;
  return (
    <div className="fin">
      {/* A tela Local traz o próprio título na lista. */}
      {aba !== "local" && (
      <header className="fin__topo">
        <h1>{TITULOS[aba]}</h1>
        {ativos.length > 0 && (
          <div className="fin__seletores">
            <Selecao rotulo="Local" valor={localId} aoMudar={setLocalSalvo} opcoes={ativos.map((l) => ({ valor: l.id, rotulo: l.nome }))} />
            {USA_CONTA.includes(aba) && (
              <Selecao rotulo="Conta (caixa/banco)" valor={contaId} aoMudar={setContaSalva} opcoes={listaContas.map((c) => ({ valor: c.id, rotulo: c.nome }))} />
            )}
          </div>
        )}
      </header>
      )}

      <div id="fin-painel">
        {locais.error ? <ErroAcao erro={locais.error} /> : null}
        {semLocal ? (
          <Cartao>Nenhum local ativo. Cadastre um na tela Local para começar.</Cartao>
        ) : (
          <>
            {aba === "local" && <LocalTab />}
            {aba !== "local" && !localId ? null : (
              <>
                {aba === "pagar" && <ContasPagarTab localId={localId} contas={listaContas} />}
                {aba === "receber" && <ContasReceberTab localId={localId} contas={listaContas} contaInicial={contaId} />}
                {aba === "cartao" && <CartaoCreditoTab localId={localId} contas={listaContas} contaInicial={contaId} />}
                {aba === "caixa" && <CaixaBancoTab localId={localId} contaId={contaId} contas={listaContas} />}
                {aba === "faturamento" && <FaturamentoTab localId={localId} />}
                {aba === "relatorios" && <RelatoriosTab localId={localId} contaId={contaId} />}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
