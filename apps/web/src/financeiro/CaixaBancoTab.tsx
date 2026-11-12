import { useState } from "react";
import { Botao } from "../componentes/Botao";
import { CampoDinheiro } from "../componentes/CampoDinheiro";
import { Cartao } from "../componentes/Cartao";
import { ErroAcao } from "../componentes/ErroAcao";
import { Janela } from "../componentes/Janela";
import { formatarReais } from "../lib/dinheiro";
import { dataBr, Estado } from "./comuns";
import { dataLocal, useMovimento, useSaldo, useTransferir } from "./useFinanceiro";

function JanelaTransferir({ contaId, aoFechar }: { contaId: string; aoFechar: () => void }) {
  const [origem, setOrigem] = useState(contaId);
  const [destino, setDestino] = useState("");
  const [valor, setValor] = useState<number | null>(null);
  const transferir = useTransferir();
  const invalido = !origem || !destino || origem === destino || !valor;
  return (
    <Janela aberta aoFechar={aoFechar} titulo="Transferir entre contas">
      <form className="formulario" onSubmit={(e) => {
        e.preventDefault();
        if (invalido || valor === null) return;
        transferir.mutate({ origem, destino, valor }, { onSuccess: aoFechar });
      }}>
        <label htmlFor="tr-ori">Conta de origem</label>
        <input id="tr-ori" value={origem} onChange={(e) => setOrigem(e.target.value.trim())} />
        <label htmlFor="tr-des">Conta de destino</label>
        <input id="tr-des" value={destino} onChange={(e) => setDestino(e.target.value.trim())} />
        <CampoDinheiro rotulo="Valor" valor={valor} aoMudar={setValor} />
        {origem && origem === destino && <p role="alert" className="erro-acao">Origem e destino devem ser diferentes.</p>}
        <ErroAcao erro={transferir.error} />
        <div className="formulario__acoes">
          <Botao variante="contorno" ignorarConexao onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" disabled={invalido || transferir.isPending}>Transferir</Botao>
        </div>
      </form>
    </Janela>
  );
}

export function CaixaBancoTab({ contaId }: { contaId: string }) {
  const [aberta, setAberta] = useState(false);
  const [periodo] = useState(() => ({ inicio: dataLocal(-30), fim: dataLocal() }));
  const saldo = useSaldo(contaId);
  const mov = useMovimento(contaId, periodo);

  if (!contaId) return <Cartao>Informe o ID da conta no topo para ver saldo e movimentos.</Cartao>;
  return (
    <div className="fin__coluna">
      <Cartao className="fin__bloco">
        <h2>Saldo atual</h2>
        <Estado carregando={saldo.isLoading} erro={saldo.error}>
          <p className="fin__destaque">{saldo.data ? formatarReais(saldo.data.saldo) : "—"}</p>
        </Estado>
        <div><Botao onClick={() => setAberta(true)}>Transferir</Botao></div>
      </Cartao>
      <Cartao className="fin__bloco">
        <h2>Movimentos (últimos 30 dias)</h2>
        <Estado carregando={mov.isLoading} erro={mov.error}>
          {(mov.data?.movimentos.length ?? 0) === 0 ? <p className="fin__suave">Sem movimentos no período.</p> : (
            <div className="fin__rolagem">
              <table className="fin__tabela">
                <thead><tr><th>Tipo</th><th className="fin__num">Valor</th><th>Data</th><th className="fin__num">Saldo posterior</th></tr></thead>
                <tbody>
                  {mov.data!.movimentos.map((m) => (
                    <tr key={m.id}>
                      <td>{m.tipo.replace(/_/g, " ")}</td>
                      <td className="fin__num">{formatarReais(m.credito > 0 ? m.credito : -m.debito)}</td>
                      <td>{dataBr(m.data)}</td>
                      <td className="fin__num">{formatarReais(m.saldo_posterior)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Estado>
      </Cartao>
      {aberta && <JanelaTransferir contaId={contaId} aoFechar={() => setAberta(false)} />}
    </div>
  );
}
