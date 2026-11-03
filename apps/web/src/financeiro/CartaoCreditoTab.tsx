import { useMemo, useState } from "react";
import { Botao } from "../componentes/Botao";
import { CampoDinheiro } from "../componentes/CampoDinheiro";
import { Cartao } from "../componentes/Cartao";
import { ErroAcao } from "../componentes/ErroAcao";
import { Etiqueta } from "../componentes/Etiqueta";
import { Gaveta } from "../componentes/Gaveta";
import { formatarReais } from "../lib/dinheiro";
import { CampoPercentual } from "../telas/tarifas/CampoPercentual";
import { CampoTexto, dataBr, Estado, ROTULO_FORMA, ROTULO_STATUS, rotulo, Selecao } from "./comuns";
import {
  dataLocal, useBaixarCartao, useCriarMovimentoCartao, useMovimentosCartao, type Conta, type MovimentoCartao, type TipoCartao,
} from "./useFinanceiro";

const TIPOS = (["credito", "debito", "voucher"] as const).map((valor) => ({ valor, rotulo: rotulo(ROTULO_FORMA, valor) }));
const BANDEIRAS = ["Visa", "Mastercard", "Elo", "American Express", "Hipercard", "Outra"].map((b) => ({ valor: b, rotulo: b }));
const STATUS = ["a_receber", "baixado"].map((valor) => ({ valor, rotulo: rotulo(ROTULO_STATUS, valor) }));
const tom = (s: string) => (s === "baixado" ? "verde" : s === "cancelado" ? "terracota" : "amarelo");

/** Mesma conta do servidor, só para mostrar o resultado antes de gravar. */
function previa(valor: number | null, informado: "bruto" | "liquido", taxa: number | null) {
  if (!valor || taxa === null || taxa >= 100) return null;
  if (informado === "bruto") {
    const t = Math.round((valor * taxa) / 100);
    return { bruto: valor, taxa: t, liquido: valor - t };
  }
  const bruto = Math.round(valor / (1 - taxa / 100));
  return { bruto, taxa: bruto - valor, liquido: valor };
}

function PainelNovo({ localId, aoFechar }: { localId: string; aoFechar: () => void }) {
  const [data, setData] = useState(() => dataLocal());
  const [bandeira, setBandeira] = useState("Visa");
  const [tipo, setTipo] = useState<TipoCartao>("credito");
  const [valor, setValor] = useState<number | null>(null);
  const [informado, setInformado] = useState<"bruto" | "liquido">("bruto");
  const [taxa, setTaxa] = useState<number | null>(0);
  const [previsao, setPrevisao] = useState("");
  const criar = useCriarMovimentoCartao();
  const calc = previa(valor, informado, taxa);
  const motivo = !valor ? "Informe o valor." : taxa === null || taxa >= 100 ? "Informe uma taxa entre 0% e 99,99%." : !data ? "Informe a data da venda." : "";
  return (
    <form className="formulario" onSubmit={(e) => {
      e.preventDefault();
      if (motivo || valor === null || taxa === null) return;
      criar.mutate({ local_id: localId, data, bandeira, tipo, valor, informado, taxa_percentual: taxa, previsao: previsao || undefined }, { onSuccess: aoFechar });
    }}>
      <CampoTexto rotulo="Data da venda" tipo="date" valor={data} aoMudar={setData} />
      <Selecao rotulo="Bandeira" valor={bandeira} aoMudar={setBandeira} opcoes={BANDEIRAS} />
      <Selecao rotulo="Tipo" valor={tipo} aoMudar={(v) => setTipo(v as TipoCartao)} opcoes={TIPOS} />
      <Selecao rotulo="O valor informado é" valor={informado} aoMudar={(v) => setInformado(v as "bruto" | "liquido")}
        opcoes={[{ valor: "bruto", rotulo: "Bruto (antes da taxa)" }, { valor: "liquido", rotulo: "Líquido (já sem a taxa)" }]} />
      <CampoDinheiro rotulo="Valor" valor={valor} aoMudar={setValor} />
      <CampoPercentual rotulo="Taxa da operadora (%)" valor={taxa} aoMudar={setTaxa} />
      <CampoTexto rotulo="Previsão de recebimento (opcional)" tipo="date" valor={previsao} aoMudar={setPrevisao} />
      {calc && (
        <ul className="fin__resumo" aria-label="Conferência dos valores">
          <li><span>Bruto</span><strong>{formatarReais(calc.bruto)}</strong></li>
          <li><span>Taxa</span><strong>{formatarReais(calc.taxa)}</strong></li>
          <li><span>Líquido</span><strong>{formatarReais(calc.liquido)}</strong></li>
        </ul>
      )}
      {motivo && <p className="fin__suave">{motivo}</p>}
      <ErroAcao erro={criar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={!!motivo || criar.isPending}>Registrar movimento</Botao>
      </div>
    </form>
  );
}

function PainelBaixar({ item, contas, contaInicial, aoFechar }: { item: MovimentoCartao; contas: Conta[]; contaInicial: string; aoFechar: () => void }) {
  const [contaId, setContaId] = useState(contaInicial || contas[0]?.id || "");
  const [taxa, setTaxa] = useState<number | null>(item.taxa_percentual);
  const baixar = useBaixarCartao();
  const calc = previa(item.valor_bruto, "bruto", taxa);
  return (
    <form className="formulario" onSubmit={(e) => {
      e.preventDefault();
      if (!contaId || taxa === null || taxa >= 100) return;
      baixar.mutate({ id: item.id, conta_id: contaId, taxa_percentual: taxa }, { onSuccess: aoFechar });
    }}>
      <p>{item.bandeira} {rotulo(ROTULO_FORMA, item.tipo).toLowerCase()} — bruto <strong>{formatarReais(item.valor_bruto)}</strong></p>
      <CampoPercentual rotulo="Taxa cobrada (%)" valor={taxa} aoMudar={setTaxa} />
      <Selecao rotulo="Conta que recebeu" valor={contaId} aoMudar={setContaId} opcoes={contas.map((c) => ({ valor: c.id, rotulo: c.nome }))} />
      {calc && <p>Entra na conta: <strong>{formatarReais(calc.liquido)}</strong> (taxa {formatarReais(calc.taxa)})</p>}
      <ErroAcao erro={baixar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={!contaId || taxa === null || taxa >= 100 || baixar.isPending}>Baixar no Caixa e Banco</Botao>
      </div>
    </form>
  );
}

export function CartaoCreditoTab({ localId, contas, contaInicial }: { localId: string; contas: Conta[]; contaInicial: string }) {
  const [status, setStatus] = useState("");
  const [novo, setNovo] = useState(false);
  const [alvo, setAlvo] = useState<MovimentoCartao | null>(null);
  const q = useMovimentosCartao(localId);
  const linhas = useMemo(() => (q.data ?? []).filter((m) => m.status !== "cancelado" && (!status || m.status === status)), [q.data, status]);
  const aReceber = linhas.filter((m) => m.status === "a_receber").reduce((s, m) => s + m.valor_liquido, 0);

  return (
    <Cartao className="fin__bloco">
      <div className="fin__filtros">
        <Selecao rotulo="Situação" valor={status} aoMudar={setStatus} vazio="Todas" opcoes={STATUS} />
        <div className="fin__acao-topo"><Botao onClick={() => setNovo(true)}>+ Novo movimento</Botao></div>
      </div>
      <Estado carregando={q.isLoading} erro={q.error}>
        {linhas.length === 0 ? (
          <p className="fin__suave">Nenhum movimento de cartão. Pagamentos em cartão da hospedagem aparecem aqui sozinhos.</p>
        ) : (
          <>
            <p className="fin__suave">Líquido a receber das operadoras: {formatarReais(aReceber)}</p>
            <div className="fin__rolagem">
              <table className="fin__tabela">
                <thead><tr><th>Venda</th><th>Bandeira</th><th>Tipo</th><th className="fin__num">Bruto</th><th className="fin__num">Taxa</th><th className="fin__num">Líquido</th><th>Previsão</th><th>Situação</th><th><span className="fin__oculto">Ações</span></th></tr></thead>
                <tbody>
                  {linhas.map((m) => (
                    <tr key={m.id}>
                      <td>{dataBr(m.data)}</td><td>{m.bandeira}</td><td>{rotulo(ROTULO_FORMA, m.tipo)}</td>
                      <td className="fin__num">{formatarReais(m.valor_bruto)}</td>
                      <td className="fin__num">{formatarReais(m.valor_taxa)}</td>
                      <td className="fin__num">{formatarReais(m.valor_liquido)}</td>
                      <td>{dataBr(m.previsao)}</td>
                      <td><Etiqueta tom={tom(m.status)}>{rotulo(ROTULO_STATUS, m.status)}</Etiqueta></td>
                      <td className="fin__acoes">{m.status === "a_receber" && <Botao tamanho="pequeno" onClick={() => setAlvo(m)}>Baixar</Botao>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Estado>
      <Gaveta aberta={novo} aoFechar={() => setNovo(false)} titulo="Novo movimento de cartão">
        {novo && <PainelNovo localId={localId} aoFechar={() => setNovo(false)} />}
      </Gaveta>
      <Gaveta aberta={alvo !== null} aoFechar={() => setAlvo(null)} titulo="Baixar cartão">
        {alvo && <PainelBaixar item={alvo} contas={contas} contaInicial={contaInicial} aoFechar={() => setAlvo(null)} />}
      </Gaveta>
    </Cartao>
  );
}
