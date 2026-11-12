import { useMemo, useState } from "react";
import { Botao } from "../componentes/Botao";
import { CampoDinheiro } from "../componentes/CampoDinheiro";
import { Cartao } from "../componentes/Cartao";
import { ErroAcao } from "../componentes/ErroAcao";
import { Etiqueta } from "../componentes/Etiqueta";
import { Janela } from "../componentes/Janela";
import { formatarReais } from "../lib/dinheiro";
import { dataBr, Estado, rotuloStatus } from "./comuns";
import { useConfirmarPagamento, useContasReceber, type ContasReceber, type SituacaoReceber } from "./useFinanceiro";

type Item = ContasReceber["itens"][number];
const SITUACOES: SituacaoReceber[] = ["aberto", "vencido", "parcialmente_recebido", "recebido"];
const tom = (s: SituacaoReceber) => (s === "recebido" ? "verde" : s === "vencido" ? "terracota" : s === "aberto" ? "neutro" : "amarelo");

function JanelaConfirmar({ item, contaInicial, aoFechar }: { item: Item; contaInicial: string; aoFechar: () => void }) {
  const [valor, setValor] = useState<number | null>(item.valor_pendente);
  const [contaId, setContaId] = useState(contaInicial);
  const confirmar = useConfirmarPagamento();
  const invalido = !valor || !contaId;
  return (
    <Janela aberta aoFechar={aoFechar} titulo={`Confirmar pagamento ${item.numero_documento}`}>
      <form className="formulario" onSubmit={(e) => {
        e.preventDefault();
        if (invalido || valor === null) return;
        confirmar.mutate({ id: item.id, valor, contaId }, { onSuccess: aoFechar });
      }}>
        <p className="fin__suave">Pendente: {formatarReais(item.valor_pendente)}</p>
        <CampoDinheiro rotulo="Valor recebido" valor={valor} aoMudar={setValor} />
        <label htmlFor="cr-conta">Conta de destino</label>
        <input id="cr-conta" value={contaId} onChange={(e) => setContaId(e.target.value.trim())} />
        <ErroAcao erro={confirmar.error} />
        <div className="formulario__acoes">
          <Botao variante="contorno" ignorarConexao onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" disabled={invalido || confirmar.isPending}>Confirmar</Botao>
        </div>
      </form>
    </Janela>
  );
}

export function ContasReceberTab({ localId, contaId }: { localId: string; contaId: string }) {
  const [status, setStatus] = useState("");
  const [alvo, setAlvo] = useState<Item | null>(null);
  const q = useContasReceber(localId);
  const linhas = useMemo(() => (q.data?.itens ?? []).filter((i) => !status || i.situacao === status), [q.data, status]);
  return (
    <Cartao className="fin__bloco">
      <div className="fin__filtros">
        <div className="campo"><label htmlFor="cr-sta">Status</label>
          <select id="cr-sta" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            {SITUACOES.map((s) => <option key={s} value={s}>{rotuloStatus(s)}</option>)}
          </select></div>
      </div>
      <Estado carregando={q.isLoading} erro={q.error}>
        {linhas.length === 0 ? <p className="fin__suave">Nada a receber neste filtro.</p> : (
          <div className="fin__rolagem">
            <table className="fin__tabela">
              <thead><tr><th>Documento</th><th>Cliente</th><th className="fin__num">Valor original</th><th>Status</th><th>Vencimento</th><th><span className="fin__oculto">Ações</span></th></tr></thead>
              <tbody>
                {linhas.map((i) => (
                  <tr key={i.id}>
                    <td>{i.numero_documento}</td><td>{i.cliente_id}</td>
                    <td className="fin__num">{formatarReais(i.valor_original)}</td>
                    <td><Etiqueta tom={tom(i.situacao)}>{rotuloStatus(i.situacao)}</Etiqueta></td>
                    <td>{dataBr(i.data_vencimento)}</td>
                    <td>{i.situacao !== "recebido" && <Botao tamanho="pequeno" onClick={() => setAlvo(i)}>Confirmar Pagamento</Botao>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Estado>
      {alvo && <JanelaConfirmar item={alvo} contaInicial={contaId} aoFechar={() => setAlvo(null)} />}
    </Cartao>
  );
}
