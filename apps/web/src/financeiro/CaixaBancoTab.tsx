import { useState } from "react";
import { Botao } from "../componentes/Botao";
import { CampoDinheiro } from "../componentes/CampoDinheiro";
import { Cartao } from "../componentes/Cartao";
import { ErroAcao } from "../componentes/ErroAcao";
import { Gaveta } from "../componentes/Gaveta";
import { formatarReais } from "../lib/dinheiro";
import { CampoTexto, dataBr, Estado, Selecao } from "./comuns";
import { dataLocal, useCriarConta, useMovimento, useSaldo, useTransferir, type Conta } from "./useFinanceiro";

const TIPOS_CONTA = [
  { valor: "corrente", rotulo: "Conta corrente" },
  { valor: "poupanca", rotulo: "Poupança" },
  { valor: "aplicacao", rotulo: "Aplicação" },
  { valor: "caixa", rotulo: "Caixa (dinheiro)" },
];

function PainelTransferir({ contaId, contas, aoFechar }: { contaId: string; contas: Conta[]; aoFechar: () => void }) {
  const [origem, setOrigem] = useState(contaId);
  const [destino, setDestino] = useState(contas.find((c) => c.id !== contaId)?.id ?? "");
  const [valor, setValor] = useState<number | null>(null);
  const transferir = useTransferir();
  const invalido = !origem || !destino || origem === destino || !valor;
  const opcoes = contas.map((c) => ({ valor: c.id, rotulo: c.nome }));
  return (
    <form className="formulario" onSubmit={(e) => {
      e.preventDefault();
      if (invalido || valor === null) return;
      transferir.mutate({ origem, destino, valor }, { onSuccess: aoFechar });
    }}>
      <Selecao rotulo="Conta de origem" valor={origem} aoMudar={setOrigem} opcoes={opcoes} />
      <Selecao rotulo="Conta de destino" valor={destino} aoMudar={setDestino} opcoes={opcoes} vazio="Escolha a conta" />
      <CampoDinheiro rotulo="Valor" valor={valor} aoMudar={setValor} />
      {origem && origem === destino && <p role="alert" className="erro-acao">Origem e destino devem ser diferentes.</p>}
      <ErroAcao erro={transferir.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={invalido || transferir.isPending}>Transferir</Botao>
      </div>
    </form>
  );
}

function PainelNovaConta({ localId, aoFechar }: { localId: string; aoFechar: () => void }) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("corrente");
  const [banco, setBanco] = useState("");
  const [agencia, setAgencia] = useState("");
  const [numero, setNumero] = useState("");
  const [saldo, setSaldo] = useState<number | null>(0);
  const criar = useCriarConta();
  const invalido = !nome.trim() || !numero.trim() || saldo === null;
  return (
    <form className="formulario" onSubmit={(e) => {
      e.preventDefault();
      if (invalido || saldo === null) return;
      criar.mutate({ local_id: localId, nome: nome.trim(), tipo, banco: banco.trim(), agencia: agencia.trim(), numero: numero.trim(), saldo_inicial: saldo }, { onSuccess: aoFechar });
    }}>
      <CampoTexto rotulo="Nome da conta" valor={nome} aoMudar={setNome} />
      <Selecao rotulo="Tipo" valor={tipo} aoMudar={setTipo} opcoes={TIPOS_CONTA} />
      <CampoTexto rotulo="Banco" valor={banco} aoMudar={setBanco} />
      <CampoTexto rotulo="Agência" valor={agencia} aoMudar={setAgencia} />
      <CampoTexto rotulo="Número da conta" valor={numero} aoMudar={setNumero} />
      <CampoDinheiro rotulo="Saldo inicial" valor={saldo} aoMudar={setSaldo} />
      <ErroAcao erro={criar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={invalido || criar.isPending}>Criar conta</Botao>
      </div>
    </form>
  );
}

export function CaixaBancoTab({ localId, contaId, contas }: { localId: string; contaId: string; contas: Conta[] }) {
  const [painel, setPainel] = useState<"transferir" | "conta" | null>(null);
  const [periodo] = useState(() => ({ inicio: dataLocal(-30), fim: dataLocal() }));
  const saldo = useSaldo(contaId);
  const mov = useMovimento(contaId, periodo);
  const fechar = () => setPainel(null);

  return (
    <div className="fin__coluna">
      <Cartao className="fin__bloco">
        <h2>Saldo atual</h2>
        {contaId ? (
          <Estado carregando={saldo.isLoading} erro={saldo.error}>
            <p className="fin__destaque">{saldo.data ? formatarReais(saldo.data.saldo) : "—"}</p>
          </Estado>
        ) : (
          <p className="fin__suave">Este local ainda não tem conta. Crie a primeira para ver saldo e movimentos.</p>
        )}
        <div className="fin__acoes">
          <Botao onClick={() => setPainel("transferir")} disabled={contas.length < 2}>Transferir</Botao>
          <Botao variante="contorno" onClick={() => setPainel("conta")}>+ Nova conta</Botao>
        </div>
        {contas.length > 0 && (
          <ul className="fin__resumo" aria-label="Contas do local">
            {contas.map((c) => <li key={c.id}><span>{c.nome}</span><strong>{formatarReais(c.saldo)}</strong></li>)}
          </ul>
        )}
      </Cartao>
      {contaId && (
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
      )}
      <Gaveta aberta={painel === "transferir"} aoFechar={fechar} titulo="Transferir entre contas">
        {painel === "transferir" && <PainelTransferir contaId={contaId} contas={contas} aoFechar={fechar} />}
      </Gaveta>
      <Gaveta aberta={painel === "conta"} aoFechar={fechar} titulo="Nova conta">
        {painel === "conta" && <PainelNovaConta localId={localId} aoFechar={fechar} />}
      </Gaveta>
    </div>
  );
}
