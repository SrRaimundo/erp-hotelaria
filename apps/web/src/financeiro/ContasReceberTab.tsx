import { useMemo, useState } from "react";
import { Botao } from "../componentes/Botao";
import { CampoDinheiro } from "../componentes/CampoDinheiro";
import { Cartao } from "../componentes/Cartao";
import { ErroAcao } from "../componentes/ErroAcao";
import { Etiqueta } from "../componentes/Etiqueta";
import { Gaveta } from "../componentes/Gaveta";
import { formatarReais } from "../lib/dinheiro";
import { CampoTexto, dataBr, Estado, ROTULO_STATUS, rotulo, Selecao } from "./comuns";
import { useConfirmarPagamento, useContasReceber, type Conta, type ContasReceber, type SituacaoReceber } from "./useFinanceiro";

type Item = ContasReceber["itens"][number];
const SITUACOES: SituacaoReceber[] = ["aberto", "vencido", "parcialmente_recebido", "recebido"];
const tom = (s: SituacaoReceber) => (s === "recebido" ? "verde" : s === "vencido" ? "terracota" : s === "aberto" ? "neutro" : "amarelo");

function PainelReceber({ item, contas, contaInicial, aoFechar }: { item: Item; contas: Conta[]; contaInicial: string; aoFechar: () => void }) {
  const [valor, setValor] = useState<number | null>(item.valor_pendente);
  const [contaId, setContaId] = useState(contaInicial || contas[0]?.id || "");
  const [novoVenc, setNovoVenc] = useState("");
  const confirmar = useConfirmarPagamento();
  const parcial = valor !== null && valor > 0 && valor < item.valor_pendente;
  const invalido = !valor || !contaId || (parcial && !novoVenc);
  return (
    <form className="formulario" onSubmit={(e) => {
      e.preventDefault();
      if (invalido || valor === null) return;
      confirmar.mutate({ id: item.id, valor, contaId, ...(parcial ? { novoVencimento: novoVenc } : {}) }, { onSuccess: aoFechar });
    }}>
      <p>{item.cliente_nome} — documento {item.numero_documento}</p>
      <p className="fin__suave">Pendente: {formatarReais(item.valor_pendente)}</p>
      <CampoDinheiro rotulo="Valor recebido" valor={valor} aoMudar={setValor} />
      {parcial && (
        <>
          <p className="fin__suave">Esta conta fica quitada por {formatarReais(valor!)} e o saldo de {formatarReais(item.valor_pendente - valor!)} vira uma nova parcela, ligada a ela.</p>
          <CampoTexto rotulo="Novo vencimento do saldo" tipo="date" valor={novoVenc} aoMudar={setNovoVenc} />
        </>
      )}
      <Selecao rotulo="Conta de destino" valor={contaId} aoMudar={setContaId} opcoes={contas.map((c) => ({ valor: c.id, rotulo: c.nome }))} />
      <ErroAcao erro={confirmar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={invalido || confirmar.isPending}>Confirmar</Botao>
      </div>
    </form>
  );
}

export function ContasReceberTab({ localId, contas, contaInicial }: { localId: string; contas: Conta[]; contaInicial: string }) {
  const [status, setStatus] = useState("");
  const [alvo, setAlvo] = useState<Item | null>(null);
  const q = useContasReceber(localId);
  const linhas = useMemo(() => (q.data?.itens ?? []).filter((i) => !status || i.situacao === status), [q.data, status]);
  return (
    <Cartao className="fin__bloco">
      <div className="fin__filtros">
        <Selecao rotulo="Situação" valor={status} aoMudar={setStatus} vazio="Todas" opcoes={SITUACOES.map((s) => ({ valor: s, rotulo: rotulo(ROTULO_STATUS, s) }))} />
      </div>
      <Estado carregando={q.isLoading} erro={q.error}>
        {linhas.length === 0 ? <p className="fin__suave">Nada a receber neste filtro. Faturas fechadas em Faturamento aparecem aqui.</p> : (
          <div className="fin__rolagem">
            <table className="fin__tabela">
              <thead><tr><th>Documento</th><th>Cliente</th><th className="fin__num">Valor original</th><th className="fin__num">Pendente</th><th>Situação</th><th>Vencimento</th><th><span className="fin__oculto">Ações</span></th></tr></thead>
              <tbody>
                {linhas.map((i) => (
                  <tr key={i.id}>
                    <td>{i.numero_documento}{i.valor_total ? <span className="fin__suave"> · recebido parcial de {formatarReais(i.valor_total)}</span> : null}{i.parcela_de ? <span className="fin__suave"> · saldo de recebimento parcial</span> : null}</td><td>{i.cliente_nome}</td>
                    <td className="fin__num">{formatarReais(i.valor_original)}</td>
                    <td className="fin__num">{formatarReais(i.valor_pendente)}</td>
                    <td><Etiqueta tom={tom(i.situacao)}>{rotulo(ROTULO_STATUS, i.situacao)}</Etiqueta></td>
                    <td>{dataBr(i.data_vencimento)}</td>
                    <td className="fin__acoes">{i.situacao !== "recebido" && <Botao tamanho="pequeno" onClick={() => setAlvo(i)}>Confirmar pagamento</Botao>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Estado>
      <Gaveta aberta={alvo !== null} aoFechar={() => setAlvo(null)} titulo="Confirmar pagamento">
        {alvo && <PainelReceber item={alvo} contas={contas} contaInicial={contaInicial} aoFechar={() => setAlvo(null)} />}
      </Gaveta>
    </Cartao>
  );
}
