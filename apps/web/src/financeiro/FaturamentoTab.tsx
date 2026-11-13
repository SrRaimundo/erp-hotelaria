import { useMemo, useState } from "react";
import { Botao } from "../componentes/Botao";
import { Cartao } from "../componentes/Cartao";
import { ErroAcao } from "../componentes/ErroAcao";
import { Etiqueta } from "../componentes/Etiqueta";
import { Gaveta } from "../componentes/Gaveta";
import { Janela } from "../componentes/Janela";
import { formatarReais } from "../lib/dinheiro";
import { CampoTexto, dataBr, Estado, FORMAS_COBRANCA, rotulo, ROTULO_FORMA, Selecao } from "./comuns";
import { dataLocal, useExtratoCobranca, useFaturamentos, useFecharFatura, type Faturamento, type FormaCobranca } from "./useFinanceiro";

const SITUACOES = [{ valor: "abertas", rotulo: "Para fechar" }, { valor: "fechadas", rotulo: "Fechadas" }];
const PRAZO_PADRAO = 30;

const somarDias = (dias: number) => dataLocal(dias);

function PainelFechar({ itens, aoFechar }: { itens: Faturamento[]; aoFechar: () => void }) {
  const item = itens[0]!;
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
  const total = itens.reduce((s, f) => s + f.valor_liquido, 0);
  return (
    <form className="formulario" onSubmit={(e) => {
      e.preventDefault();
      if (invalido) return;
      fechar.mutate({
        ids: itens.map((f) => f.id), clienteId: item.cliente_id, forma, data_vencimento: vencimento,
        contato: { email: email.trim(), telefone: telefone.trim(), endereco: endereco.trim() },
        politica: { prazo_dias: prazoNumero, forma_cobranca: forma, observacoes: obs.trim() },
      }, { onSuccess: aoFechar });
    }}>
      <p><strong>{item.cliente_nome}</strong>{item.cliente_documento ? ` — ${item.cliente_documento}` : ""}</p>
      {itens.length === 1 ? (
        <p className="fin__suave">Valor da fatura: {formatarReais(item.valor_liquido)}{item.reserva_codigo ? ` · reserva ${item.reserva_codigo}` : ""}</p>
      ) : (
        <>
          <p className="fin__suave">{itens.length} fechamentos numa só fatura, uma conta a receber pela soma: <strong>{formatarReais(total)}</strong></p>
          <ul className="fin__resumo" aria-label="Fechamentos da fatura">
            {itens.map((f) => <li key={f.id}><span>Reserva {f.reserva_codigo ?? "—"}</span><strong>{formatarReais(f.valor_liquido)}</strong></li>)}
          </ul>
        </>
      )}
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

/** Extrato da cobrança: cada fechamento agrupado na fatura; imprime só o extrato. */
function ExtratoJanela({ localId, numero, aoFechar }: { localId: string; numero: string; aoFechar: () => void }) {
  const q = useExtratoCobranca(localId, numero);
  const e = q.data;
  return (
    <Janela aberta aoFechar={aoFechar} titulo="Extrato da cobrança">
      <Estado carregando={q.isLoading} erro={q.error}>
        {e && (
          <div className="extrato-cobranca">
            <h3>Fatura {e.numero_documento}</h3>
            <p><strong>{e.cliente.nome}</strong>{e.cliente.documento ? ` — ${e.cliente.documento}` : ""}</p>
            {(e.cliente.contato.email || e.cliente.contato.telefone || e.cliente.contato.endereco) && (
              <p className="fin__suave">{[e.cliente.contato.email, e.cliente.contato.telefone, e.cliente.contato.endereco].filter(Boolean).join(" · ")}</p>
            )}
            <p className="fin__suave">Vencimento {dataBr(e.data_vencimento)} · {rotulo(ROTULO_FORMA, e.forma_cobranca)}</p>
            <div className="fin__rolagem">
              <table className="fin__tabela">
                <thead><tr><th>Reserva</th><th>Hóspede</th><th>Período</th><th className="fin__num">Valor</th></tr></thead>
                <tbody>
                  {e.itens.map((i) => (
                    <tr key={i.id}>
                      <td>{i.reserva_codigo ?? "—"}</td><td>{i.hospede ?? "—"}</td>
                      <td>{i.chegada && i.saida ? `${dataBr(i.chegada)} a ${dataBr(i.saida)}` : "—"}</td>
                      <td className="fin__num">{formatarReais(i.valor)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><th colSpan={3}>Total da fatura</th><th className="fin__num">{formatarReais(e.total)}</th></tr></tfoot>
              </table>
            </div>
            <div className="formulario__acoes extrato-cobranca__acoes">
              <Botao onClick={() => window.print()}>Imprimir</Botao>
            </div>
          </div>
        )}
      </Estado>
    </Janela>
  );
}

export function FaturamentoTab({ localId }: { localId: string }) {
  const [situacao, setSituacao] = useState("abertas");
  const [fechando, setFechando] = useState<Faturamento[] | null>(null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [extrato, setExtrato] = useState("");
  const q = useFaturamentos(localId);
  const linhas = useMemo(() => (q.data ?? []).filter((f) => f.status !== "cancelado" && (situacao === "fechadas" ? f.fechada : !f.fechada)), [q.data, situacao]);
  const total = linhas.reduce((s, f) => s + f.valor_liquido, 0);
  const selecionados = linhas.filter((f) => marcados.includes(f.id));
  const clienteMarcado = selecionados[0]?.cliente_id;
  const alternar = (id: string) => setMarcados((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  return (
    <Cartao className="fin__bloco">
      <div className="fin__filtros">
        <Selecao rotulo="Mostrar" valor={situacao} aoMudar={(v) => { setSituacao(v); setMarcados([]); }} opcoes={SITUACOES} />
        {situacao === "abertas" && selecionados.length > 0 && (
          <div className="fin__acao-topo">
            <Botao onClick={() => setFechando(selecionados)}>
              {selecionados.length === 1 ? "Fechar fatura do selecionado" : `Fechar uma fatura com os ${selecionados.length} selecionados`}
            </Botao>
          </div>
        )}
      </div>
      <Estado carregando={q.isLoading} erro={q.error}>
        {linhas.length === 0 ? (
          <p className="fin__suave">
            {situacao === "abertas" ? "Nenhum fechamento marcado para faturar. Checkouts faturados da hospedagem aparecem aqui." : "Nenhuma fatura fechada ainda."}
          </p>
        ) : (
          <>
            <p className="fin__suave">Total: {formatarReais(total)}</p>
            {situacao === "abertas" && <p className="fin__suave">Para reunir vários fechamentos do mesmo cliente numa única fatura, marque-os e use o botão acima.</p>}
            <div className="fin__rolagem">
              <table className="fin__tabela">
                <thead><tr>{situacao === "abertas" && <th><span className="fin__oculto">Selecionar</span></th>}<th>Cliente</th><th>Reserva</th><th className="fin__num">Valor</th><th>Documento</th><th>Vencimento</th><th>Situação</th><th><span className="fin__oculto">Ações</span></th></tr></thead>
                <tbody>
                  {linhas.map((f) => (
                    <tr key={f.id}>
                      {situacao === "abertas" && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Selecionar ${f.cliente_nome}, reserva ${f.reserva_codigo ?? "sem código"}`}
                            checked={marcados.includes(f.id)}
                            disabled={!!clienteMarcado && clienteMarcado !== f.cliente_id}
                            onChange={() => alternar(f.id)}
                          />
                        </td>
                      )}
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
                      <td className="fin__acoes">
                        {!f.fechada && <Botao tamanho="pequeno" onClick={() => setFechando([f])}>Fechar fatura</Botao>}
                        {f.fechada && <Botao variante="contorno" tamanho="pequeno" onClick={() => setExtrato(f.numero_documento)}>Extrato</Botao>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Estado>
      <Gaveta aberta={fechando !== null} aoFechar={() => setFechando(null)} titulo="Fechar fatura">
        {fechando && <PainelFechar itens={fechando} aoFechar={() => { setFechando(null); setMarcados([]); }} />}
      </Gaveta>
      {extrato && <ExtratoJanela localId={localId} numero={extrato} aoFechar={() => setExtrato("")} />}
    </Cartao>
  );
}
