import { useMemo, useState } from "react";
import { Botao } from "../componentes/Botao";
import { CampoDinheiro } from "../componentes/CampoDinheiro";
import { Cartao } from "../componentes/Cartao";
import { ErroAcao } from "../componentes/ErroAcao";
import { Etiqueta } from "../componentes/Etiqueta";
import { Gaveta } from "../componentes/Gaveta";
import { Janela } from "../componentes/Janela";
import { JanelaSupervisor } from "../componentes/JanelaSupervisor";
import { formatarReais } from "../lib/dinheiro";
import { CampoTexto, dataBr, Estado, ROTULO_STATUS, rotulo, Selecao } from "./comuns";
import {
  dataLocal, useCancelarContaReceber, useClientes, useConfirmarPagamento, useContasReceber, useCriarCliente, useEstornarLancamento, useSalvarContaReceber,
  type Conta, type ContasReceber, type SituacaoReceber,
} from "./useFinanceiro";

type Item = ContasReceber["itens"][number];
const SITUACOES: SituacaoReceber[] = ["aberto", "vencido", "parcialmente_recebido", "recebido"];
const CATEGORIAS = [
  { valor: "servico", rotulo: "Serviço" }, { valor: "aluguel", rotulo: "Aluguel" }, { valor: "evento", rotulo: "Evento" },
  { valor: "convenio", rotulo: "Convênio" }, { valor: "outros", rotulo: "Outros" },
];
const ROTULO_CATEGORIA: Record<string, string> = Object.fromEntries(CATEGORIAS.map((c) => [c.valor, c.rotulo]));
const tom = (s: SituacaoReceber) => (s === "recebido" ? "verde" : s === "vencido" ? "terracota" : s === "aberto" ? "neutro" : "amarelo");

function NovoCliente({ localId, aoCriar, aoFechar }: { localId: string; aoCriar: (id: string) => void; aoFechar: () => void }) {
  const [nome, setNome] = useState("");
  const [documento, setDocumento] = useState("");
  const criar = useCriarCliente();
  return (
    <Janela aberta aoFechar={aoFechar} titulo="Novo cliente">
      <form className="formulario" onSubmit={(e) => {
        e.preventDefault();
        if (!nome.trim()) return;
        criar.mutate({ local_id: localId, nome: nome.trim(), cpf_cnpj: documento.trim() || undefined }, { onSuccess: (c) => { aoCriar((c as { id: string }).id); aoFechar(); } });
      }}>
        <CampoTexto rotulo="Nome do cliente" valor={nome} aoMudar={setNome} />
        <CampoTexto rotulo="CPF ou CNPJ (opcional)" valor={documento} aoMudar={setDocumento} />
        <ErroAcao erro={criar.error} />
        <div className="formulario__acoes">
          <Botao variante="contorno" ignorarConexao onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" disabled={!nome.trim() || criar.isPending}>Cadastrar</Botao>
        </div>
      </form>
    </Janela>
  );
}

/** Lançamento manual (criar) ou edição da conta pendente: espelho do painel de Contas a Pagar. */
function PainelManual({ localId, item, aoFechar }: { localId: string; item: Item | null; aoFechar: () => void }) {
  const clientes = useClientes(localId);
  const [clienteId, setClienteId] = useState(item?.cliente_id ?? "");
  const [documento, setDocumento] = useState(item?.numero_documento ?? "");
  const [valor, setValor] = useState<number | null>(item?.valor_original ?? null);
  const [vencimento, setVencimento] = useState(item ? item.data_vencimento.slice(0, 10) : dataLocal(30));
  const [categoria, setCategoria] = useState(item?.categoria ?? "servico");
  const [observacao, setObservacao] = useState(item?.observacao ?? "");
  const [novoCliente, setNovoCliente] = useState(false);
  const salvar = useSalvarContaReceber();
  const motivos = [
    ...(!clienteId ? ["Escolha o cliente."] : []),
    ...(!documento.trim() ? ["Informe o número do documento."] : []),
    ...(!valor ? ["Informe o valor."] : []),
    ...(!vencimento ? ["Informe o vencimento."] : []),
  ];
  return (
    <>
      <form className="formulario" onSubmit={(e) => {
        e.preventDefault();
        if (motivos.length > 0 || valor === null) return;
        salvar.mutate(
          { id: item?.id, ...(item ? {} : { local_id: localId }), cliente_id: clienteId, numero_documento: documento.trim(), valor, vencimento, categoria, observacao: observacao.trim() || undefined },
          { onSuccess: aoFechar },
        );
      }}>
        <Selecao rotulo="Cliente" valor={clienteId} aoMudar={setClienteId} vazio="Escolha o cliente" opcoes={(clientes.data ?? []).map((c) => ({ valor: c.id, rotulo: c.cpf_cnpj ? `${c.nome} (${c.cpf_cnpj})` : c.nome }))} />
        <div><Botao variante="contorno" tamanho="pequeno" onClick={() => setNovoCliente(true)}>+ Novo cliente</Botao></div>
        <CampoTexto rotulo="Número do documento" valor={documento} aoMudar={setDocumento} />
        <Selecao rotulo="Categoria" valor={categoria} aoMudar={setCategoria} opcoes={CATEGORIAS} />
        <CampoDinheiro rotulo="Valor" valor={valor} aoMudar={setValor} />
        <CampoTexto rotulo="Vencimento" tipo="date" valor={vencimento} aoMudar={setVencimento} />
        <CampoTexto rotulo="Observação" valor={observacao} aoMudar={setObservacao} />
        {motivos.length > 0 && <p className="fin__suave">{motivos[0]}</p>}
        <ErroAcao erro={salvar.error} />
        <div className="formulario__acoes">
          <Botao type="submit" disabled={motivos.length > 0 || salvar.isPending}>{item ? "Salvar alterações" : "Lançar conta a receber"}</Botao>
        </div>
      </form>
      {novoCliente && <NovoCliente localId={localId} aoCriar={setClienteId} aoFechar={() => setNovoCliente(false)} />}
    </>
  );
}

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
  const [manual, setManual] = useState<{ item: Item | null } | null>(null);
  const [cancelar, setCancelar] = useState<Item | null>(null);
  const [estornar, setEstornar] = useState<Item | null>(null);
  const cancelamento = useCancelarContaReceber();
  const estorno = useEstornarLancamento();
  const q = useContasReceber(localId);
  const linhas = useMemo(() => (q.data?.itens ?? []).filter((i) => !status || i.situacao === status), [q.data, status]);
  return (
    <Cartao className="fin__bloco">
      <div className="fin__filtros">
        <Selecao rotulo="Situação" valor={status} aoMudar={setStatus} vazio="Todas" opcoes={SITUACOES.map((s) => ({ valor: s, rotulo: rotulo(ROTULO_STATUS, s) }))} />
        <div className="fin__acao-topo"><Botao onClick={() => setManual({ item: null })}>+ Nova conta a receber</Botao></div>
      </div>
      <Estado carregando={q.isLoading} erro={q.error}>
        {linhas.length === 0 ? <p className="fin__suave">Nada a receber neste filtro. Faturas fechadas em Faturamento e contas lançadas aqui aparecem nesta lista.</p> : (
          <div className="fin__rolagem">
            <table className="fin__tabela">
              <thead><tr><th>Documento</th><th>Cliente</th><th>Categoria</th><th className="fin__num">Valor original</th><th className="fin__num">Pendente</th><th>Situação</th><th>Vencimento</th><th><span className="fin__oculto">Ações</span></th></tr></thead>
              <tbody>
                {linhas.map((i) => (
                  <tr key={i.id}>
                    <td>{i.numero_documento}{i.valor_total ? <span className="fin__suave"> · recebido parcial de {formatarReais(i.valor_total)}</span> : null}{i.parcela_de ? <span className="fin__suave"> · saldo de recebimento parcial</span> : null}</td><td>{i.cliente_nome}</td><td>{i.categoria ? rotulo(ROTULO_CATEGORIA, i.categoria) : i.origem === "faturamento" ? "Hospedagem (fatura)" : "—"}{i.observacao ? <span className="fin__suave"> · {i.observacao}</span> : null}</td>
                    <td className="fin__num">{formatarReais(i.valor_original)}</td>
                    <td className="fin__num">{formatarReais(i.valor_pendente)}</td>
                    <td><Etiqueta tom={tom(i.situacao)}>{rotulo(ROTULO_STATUS, i.situacao)}</Etiqueta></td>
                    <td>{dataBr(i.data_vencimento)}</td>
                    <td className="fin__acoes">
                      {i.situacao !== "recebido" && <Botao tamanho="pequeno" onClick={() => setAlvo(i)}>Confirmar pagamento</Botao>}
                      {i.editavel && <Botao variante="contorno" tamanho="pequeno" onClick={() => setManual({ item: i })}>Editar</Botao>}
                      {i.editavel && <Botao variante="contorno" tamanho="pequeno" onClick={() => setCancelar(i)}>Cancelar</Botao>}
                      {i.lancamento_id && i.valor_recebido > 0 && <Botao variante="contorno" tamanho="pequeno" onClick={() => setEstornar(i)}>Estornar recebimento</Botao>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Estado>
      <Gaveta aberta={manual !== null} aoFechar={() => setManual(null)} titulo={manual?.item ? "Editar conta a receber" : "Nova conta a receber"}>
        {manual && <PainelManual localId={localId} item={manual.item} aoFechar={() => setManual(null)} />}
      </Gaveta>
      <JanelaSupervisor
        aberta={cancelar !== null}
        titulo="Cancelar conta a receber"
        aoCancelar={() => setCancelar(null)}
        aoConfirmar={async (aut) => {
          if (!cancelar) return;
          await cancelamento.mutateAsync({ id: cancelar.id, aut });
          setCancelar(null);
        }}
      />
      <JanelaSupervisor
        aberta={estornar !== null}
        titulo="Estornar recebimento"
        aoCancelar={() => setEstornar(null)}
        aoConfirmar={async (aut) => {
          if (!estornar?.lancamento_id) return;
          await estorno.mutateAsync({ id: estornar.lancamento_id, aut });
          setEstornar(null);
        }}
      />
      <Gaveta aberta={alvo !== null} aoFechar={() => setAlvo(null)} titulo="Confirmar pagamento">
        {alvo && <PainelReceber item={alvo} contas={contas} contaInicial={contaInicial} aoFechar={() => setAlvo(null)} />}
      </Gaveta>
    </Cartao>
  );
}
