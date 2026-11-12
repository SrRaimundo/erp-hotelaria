import { useMemo, useState } from "react";
import { Botao } from "../componentes/Botao";
import { CampoDinheiro } from "../componentes/CampoDinheiro";
import { Cartao } from "../componentes/Cartao";
import { ErroAcao } from "../componentes/ErroAcao";
import { Etiqueta } from "../componentes/Etiqueta";
import { Gaveta } from "../componentes/Gaveta";
import { JanelaSupervisor } from "../componentes/JanelaSupervisor";
import { formatarReais } from "../lib/dinheiro";
import { CampoPercentual } from "../telas/tarifas/CampoPercentual";
import { CampoTexto, dataBr, Estado, ROTULO_FORMA, ROTULO_STATUS, rotulo, Selecao } from "./comuns";
import {
  dataLocal, useBaixarCartao, useCancelarLancamento, useCondicoesCartao, useCriarMovimentoCartao, useMovimentosCartao, type CondicaoCartao, type Conta, type MovimentoCartao,
} from "./useFinanceiro";

const STATUS = ["a_receber", "baixado"].map((valor) => ({ valor, rotulo: rotulo(ROTULO_STATUS, valor) }));
const tom = (s: string) => (s === "baixado" ? "verde" : s === "cancelado" ? "terracota" : "amarelo");
const nomeCondicao = (c: CondicaoCartao) => `${c.adquirente} · ${c.bandeira} · ${rotulo(ROTULO_FORMA, c.tipo)} · D+${c.prazo_dias} · ${String(c.taxa_percentual).replace(".", ",")}%`;

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

function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number) as [number, number, number];
  const r = new Date(Date.UTC(a, m - 1, d + dias));
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, "0")}-${String(r.getUTCDate()).padStart(2, "0")}`;
}

function PainelNovo({ localId, condicoes, aoFechar }: { localId: string; condicoes: CondicaoCartao[]; aoFechar: () => void }) {
  const ativas = condicoes.filter((c) => c.ativo);
  const [data, setData] = useState(() => dataLocal());
  const [condicaoId, setCondicaoId] = useState(ativas[0]?.id ?? "");
  const [valor, setValor] = useState<number | null>(null);
  const [informado, setInformado] = useState<"bruto" | "liquido">("bruto");
  const criar = useCriarMovimentoCartao();
  const c = ativas.find((x) => x.id === condicaoId);
  const calc = previa(valor, informado, c?.taxa_percentual ?? null);
  const motivo = ativas.length === 0 ? "Cadastre as condições de cobrança em Cadastros, Cobrança." : !c ? "Escolha a condição de cobrança." : !valor ? "Informe o valor." : !data ? "Informe a data da venda." : "";
  return (
    <form className="formulario" onSubmit={(e) => {
      e.preventDefault();
      if (motivo || valor === null) return;
      criar.mutate({ local_id: localId, data, valor, informado, condicao_id: condicaoId }, { onSuccess: aoFechar });
    }}>
      <CampoTexto rotulo="Data da venda" tipo="date" valor={data} aoMudar={setData} />
      <Selecao rotulo="Condição de cobrança" valor={condicaoId} aoMudar={setCondicaoId} opcoes={ativas.map((x) => ({ valor: x.id, rotulo: nomeCondicao(x) }))} vazio={ativas.length === 0 ? "Nenhuma condição cadastrada" : undefined} />
      <Selecao rotulo="O valor informado é" valor={informado} aoMudar={(v) => setInformado(v as "bruto" | "liquido")}
        opcoes={[{ valor: "bruto", rotulo: "Bruto (antes da taxa)" }, { valor: "liquido", rotulo: "Líquido (já sem a taxa)" }]} />
      <CampoDinheiro rotulo="Valor" valor={valor} aoMudar={setValor} />
      {c && data && <p className="fin__suave">Previsão de recebimento: {dataBr(somarDias(data, c.prazo_dias))} (D+{c.prazo_dias})</p>}
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

function PainelBaixar({ item, contas, contaInicial, condicoes, aoFechar }: { item: MovimentoCartao; contas: Conta[]; contaInicial: string; condicoes: CondicaoCartao[]; aoFechar: () => void }) {
  const doTipo = condicoes.filter((c) => c.ativo && c.tipo === item.tipo);
  const [contaId, setContaId] = useState(contaInicial || contas[0]?.id || "");
  const [taxa, setTaxa] = useState<number | null>(item.taxa_percentual);
  const [condicaoId, setCondicaoId] = useState("");
  const baixar = useBaixarCartao();
  const revisar = item.revisar === 1;
  const efetiva = revisar ? doTipo.find((c) => c.id === condicaoId)?.taxa_percentual ?? null : taxa;
  const calc = previa(item.valor_bruto, "bruto", efetiva);
  const invalido = !contaId || efetiva === null || efetiva >= 100 || (revisar && !condicaoId);
  return (
    <form className="formulario" onSubmit={(e) => {
      e.preventDefault();
      if (invalido || efetiva === null) return;
      baixar.mutate(revisar ? { id: item.id, conta_id: contaId, condicao_id: condicaoId } : { id: item.id, conta_id: contaId, taxa_percentual: efetiva }, { onSuccess: aoFechar });
    }}>
      <p>{item.bandeira} {rotulo(ROTULO_FORMA, item.tipo).toLowerCase()} — bruto <strong>{formatarReais(item.valor_bruto)}</strong></p>
      {revisar ? (
        <>
          <p role="note" className="erro-acao">Este pagamento entrou sem condição de cobrança cadastrada. Escolha a condição para calcular a taxa.</p>
          <Selecao rotulo="Condição de cobrança" valor={condicaoId} aoMudar={setCondicaoId} opcoes={doTipo.map((x) => ({ valor: x.id, rotulo: nomeCondicao(x) }))} vazio="Escolha a condição" />
        </>
      ) : (
        <CampoPercentual rotulo="Taxa cobrada (%)" valor={taxa} aoMudar={setTaxa} />
      )}
      <Selecao rotulo="Conta que recebeu" valor={contaId} aoMudar={setContaId} opcoes={contas.map((c) => ({ valor: c.id, rotulo: c.nome }))} />
      {calc && <p>Entra na conta: <strong>{formatarReais(calc.liquido)}</strong> (taxa {formatarReais(calc.taxa)})</p>}
      <ErroAcao erro={baixar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={invalido || baixar.isPending}>Baixar no Caixa e Banco</Botao>
      </div>
    </form>
  );
}

export function CartaoCreditoTab({ localId, contas, contaInicial }: { localId: string; contas: Conta[]; contaInicial: string }) {
  const [status, setStatus] = useState("");
  const [novo, setNovo] = useState(false);
  const [alvo, setAlvo] = useState<MovimentoCartao | null>(null);
  const [cancelar, setCancelar] = useState<MovimentoCartao | null>(null);
  const cancelamento = useCancelarLancamento();
  const q = useMovimentosCartao(localId);
  const conds = useCondicoesCartao(localId);
  const condicoes = conds.data ?? [];
  const linhas = useMemo(() => (q.data ?? []).filter((m) => m.status !== "cancelado" && (!status || m.status === status)), [q.data, status]);
  const aReceber = linhas.filter((m) => m.status === "a_receber").reduce((s, m) => s + m.valor_liquido, 0);
  const aRevisar = linhas.filter((m) => m.status === "a_receber" && m.revisar === 1).length;

  return (
    <Cartao className="fin__bloco">
      <div className="fin__filtros">
        <Selecao rotulo="Situação" valor={status} aoMudar={setStatus} vazio="Todas" opcoes={STATUS} />
        <div className="fin__acao-topo"><Botao onClick={() => setNovo(true)}>+ Novo movimento</Botao></div>
      </div>
      <Estado carregando={q.isLoading || conds.isLoading} erro={q.error ?? conds.error}>
        {linhas.length === 0 ? (
          <p className="fin__suave">Nenhum movimento de cartão. Pagamentos em cartão da hospedagem aparecem aqui sozinhos.</p>
        ) : (
          <>
            <p className="fin__suave">Líquido a receber das operadoras: {formatarReais(aReceber)}</p>
            {aRevisar > 0 && <p role="note" className="erro-acao">{aRevisar === 1 ? "1 movimento entrou" : `${aRevisar} movimentos entraram`} sem condição de cobrança cadastrada e precisa de revisão antes da baixa.</p>}
            <div className="fin__rolagem">
              <table className="fin__tabela">
                <thead><tr><th>Venda</th><th>Adquirente</th><th>Bandeira</th><th>Tipo</th><th className="fin__num">Bruto</th><th className="fin__num">Taxa</th><th className="fin__num">Líquido</th><th>Prazo</th><th>Previsão</th><th>Situação</th><th><span className="fin__oculto">Ações</span></th></tr></thead>
                <tbody>
                  {linhas.map((m) => (
                    <tr key={m.id}>
                      <td>{dataBr(m.data)}</td><td>{m.adquirente || "—"}</td><td>{m.bandeira}</td><td>{rotulo(ROTULO_FORMA, m.tipo)}</td>
                      <td className="fin__num">{formatarReais(m.valor_bruto)}</td>
                      <td className="fin__num">{formatarReais(m.valor_taxa)}</td>
                      <td className="fin__num">{formatarReais(m.valor_liquido)}</td>
                      <td>D+{m.prazo_dias}</td>
                      <td>{dataBr(m.previsao)}</td>
                      <td>
                        <Etiqueta tom={tom(m.status)}>{rotulo(ROTULO_STATUS, m.status)}</Etiqueta>
                        {m.revisar === 1 && m.status === "a_receber" && <> <Etiqueta tom="terracota">Revisar condição</Etiqueta></>}
                      </td>
                      <td className="fin__acoes">
                        {m.status === "a_receber" && <Botao tamanho="pequeno" onClick={() => setAlvo(m)}>Baixar</Botao>}
                        {m.status === "a_receber" && <Botao variante="contorno" tamanho="pequeno" onClick={() => setCancelar(m)}>Cancelar</Botao>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Estado>
      <JanelaSupervisor
        aberta={cancelar !== null}
        titulo="Cancelar movimento de cartão"
        aoCancelar={() => setCancelar(null)}
        aoConfirmar={async (aut) => {
          if (!cancelar) return;
          await cancelamento.mutateAsync({ id: cancelar.lancamento_id, aut });
          setCancelar(null);
        }}
      />
      <Gaveta aberta={novo} aoFechar={() => setNovo(false)} titulo="Novo movimento de cartão">
        {novo && <PainelNovo localId={localId} condicoes={condicoes} aoFechar={() => setNovo(false)} />}
      </Gaveta>
      <Gaveta aberta={alvo !== null} aoFechar={() => setAlvo(null)} titulo="Baixar cartão">
        {alvo && <PainelBaixar item={alvo} contas={contas} contaInicial={contaInicial} condicoes={condicoes} aoFechar={() => setAlvo(null)} />}
      </Gaveta>
    </Cartao>
  );
}
