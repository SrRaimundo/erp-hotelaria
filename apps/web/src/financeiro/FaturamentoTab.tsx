import { useMemo, useState } from "react";
import { Botao } from "../componentes/Botao";
import { Cartao } from "../componentes/Cartao";
import { ErroAcao } from "../componentes/ErroAcao";
import { Etiqueta } from "../componentes/Etiqueta";
import { Gaveta } from "../componentes/Gaveta";
import { formatarReais } from "../lib/dinheiro";
import { CampoTexto, dataBr, Estado, FORMAS_COBRANCA, Selecao } from "./comuns";
import { dataLocal, useFaturamentos, useFecharFatura, type Faturamento, type FormaCobranca } from "./useFinanceiro";

const SITUACOES = [{ valor: "abertas", rotulo: "Para fechar" }, { valor: "fechadas", rotulo: "Fechadas" }];
const PRAZO_PADRAO = 30;

const somarDias = (dias: number) => dataLocal(dias);

function PainelFechar({ item, aoFechar }: { item: Faturamento; aoFechar: () => void }) {
  const pol = item.cliente_politica;
  const [email, setEmail] = useState(item.cliente_contato.email ?? "");
  const [telefone, setTelefone] = useState(item.cliente_contato.telefone ?? "");
  const [endereco, setEndereco] = useState(item.cliente_contato.endereco ?? "");
  const [prazo, setPrazo] = useState(String(pol.prazo_dias ?? PRAZO_PADRAO));
  const [forma, setForma] = useState<FormaCobranca>(pol.forma_cobranca ?? "boleto");
  const [obs, setObs] = useState(pol.observacoes ?? "");
  const [vencimento, setVencimento] = useState(() => somarDias(pol.prazo_dias ?? PRAZO_PADRAO));
  const fechar = useFecharFatura();
  const prazoNumero = Number(prazo);
  const prazoValido = prazo.trim() !== "" && Number.isInteger(prazoNumero) && prazoNumero >= 0 && prazoNumero <= 365;
  const invalido = !vencimento || !prazoValido;
  return (
    <form className="formulario" onSubmit={(e) => {
      e.preventDefault();
      if (invalido) return;
      fechar.mutate({
        id: item.id, clienteId: item.cliente_id, forma, data_vencimento: vencimento,
        contato: { email: email.trim(), telefone: telefone.trim(), endereco: endereco.trim() },
        politica: { prazo_dias: prazoNumero, forma_cobranca: forma, observacoes: obs.trim() },
      }, { onSuccess: aoFechar });
    }}>
      <p><strong>{item.cliente_nome}</strong>{item.cliente_documento ? ` — ${item.cliente_documento}` : ""}</p>
      <p className="fin__suave">Valor da fatura: {formatarReais(item.valor_liquido)}{item.reserva_codigo ? ` · reserva ${item.reserva_codigo}` : ""}</p>
      <fieldset className="fin__grupo">
        <legend>Dados do cliente</legend>
        <CampoTexto rotulo="E-mail para cobrança" tipo="email" valor={email} aoMudar={setEmail} />
        <CampoTexto rotulo="Telefone" tipo="tel" valor={telefone} aoMudar={setTelefone} />
        <CampoTexto rotulo="Endereço" valor={endereco} aoMudar={setEndereco} />
      </fieldset>
      <fieldset className="fin__grupo">
        <legend>Política do cliente</legend>
        <CampoTexto rotulo="Prazo de pagamento (dias)" tipo="number" valor={prazo} aoMudar={(v) => {
          setPrazo(v);
          const n = Number(v);
          if (v.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 365) setVencimento(somarDias(n));
        }} />
        <Selecao rotulo="Forma de cobrança" valor={forma} aoMudar={(v) => setForma(v as FormaCobranca)} opcoes={FORMAS_COBRANCA} />
        <CampoTexto rotulo="Observações" valor={obs} aoMudar={setObs} />
      </fieldset>
      <CampoTexto rotulo="Vencimento desta fatura" tipo="date" valor={vencimento} aoMudar={setVencimento} />
      {!prazoValido && <p className="fin__suave">Informe um prazo entre 0 e 365 dias.</p>}
      <ErroAcao erro={fechar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={invalido || fechar.isPending}>Fechar fatura</Botao>
      </div>
    </form>
  );
}

export function FaturamentoTab({ localId }: { localId: string }) {
  const [situacao, setSituacao] = useState("abertas");
  const [alvo, setAlvo] = useState<Faturamento | null>(null);
  const q = useFaturamentos(localId);
  const linhas = useMemo(() => (q.data ?? []).filter((f) => f.status !== "cancelado" && (situacao === "fechadas" ? f.fechada : !f.fechada)), [q.data, situacao]);
  const total = linhas.reduce((s, f) => s + f.valor_liquido, 0);
  return (
    <Cartao className="fin__bloco">
      <div className="fin__filtros">
        <Selecao rotulo="Mostrar" valor={situacao} aoMudar={setSituacao} opcoes={SITUACOES} />
      </div>
      <Estado carregando={q.isLoading} erro={q.error}>
        {linhas.length === 0 ? (
          <p className="fin__suave">
            {situacao === "abertas" ? "Nenhum fechamento marcado para faturar. Checkouts faturados da hospedagem aparecem aqui." : "Nenhuma fatura fechada ainda."}
          </p>
        ) : (
          <>
            <p className="fin__suave">Total: {formatarReais(total)}</p>
            <div className="fin__rolagem">
              <table className="fin__tabela">
                <thead><tr><th>Cliente</th><th>Reserva</th><th className="fin__num">Valor</th><th>Documento</th><th>Vencimento</th><th>Situação</th><th><span className="fin__oculto">Ações</span></th></tr></thead>
                <tbody>
                  {linhas.map((f) => (
                    <tr key={f.id}>
                      <td>{f.cliente_nome}</td>
                      <td>{f.reserva_codigo ?? "—"}</td>
                      <td className="fin__num">{formatarReais(f.valor_liquido)}</td>
                      <td>{f.numero_documento || "—"}</td>
                      <td>{f.fechada ? dataBr(f.data_vencimento) : "—"}</td>
                      <td>
                        {f.fechada
                          ? <Etiqueta tom={f.status === "pago" ? "verde" : "amarelo"}>{f.status === "pago" ? "Recebida" : "Em Contas a Receber"}</Etiqueta>
                          : <Etiqueta tom="amarelo">Para fechar</Etiqueta>}
                      </td>
                      <td className="fin__acoes">{!f.fechada && <Botao tamanho="pequeno" onClick={() => setAlvo(f)}>Fechar fatura</Botao>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Estado>
      <Gaveta aberta={alvo !== null} aoFechar={() => setAlvo(null)} titulo="Fechar fatura">
        {alvo && <PainelFechar item={alvo} aoFechar={() => setAlvo(null)} />}
      </Gaveta>
    </Cartao>
  );
}
