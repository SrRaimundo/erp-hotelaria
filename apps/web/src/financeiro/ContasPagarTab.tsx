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
import { SecaoParcelamento, useParcelamento } from "./Parcelamento";
import { TituloDetalhe } from "./TituloDetalhe";
import { CampoTexto, dataBr, Estado, ROTULO_FORMA, ROTULO_STATUS, rotulo, Selecao } from "./comuns";
import {
  dataLocal, useBaixarContaPagar, useCancelarLancamento, useEstornarLancamento, useCriarContaPagar, useCriarTitulo, useCriarFornecedor, useFornecedores, useLancamentos,
  type Conta, type Lancamento,
} from "./useFinanceiro";

const CATEGORIAS = [
  { valor: "fornecedor", rotulo: "Fornecedor" },
  { valor: "servico", rotulo: "Serviço" },
  { valor: "funcionario", rotulo: "Funcionário" },
  { valor: "contrato", rotulo: "Contrato" },
];
/** Registro automático do Cartão de Crédito: não é uma opção de escolha ao lançar. */
const ROTULO_TAXA_CARTAO = "Cartão de Crédito (taxa)";
const ROTULO_CATEGORIA: Record<string, string> = { ...Object.fromEntries(CATEGORIAS.map((c) => [c.valor, c.rotulo])), taxa_cartao: ROTULO_TAXA_CARTAO };
const FORMAS_PAGAR = ["pix", "boleto", "dinheiro", "transferencia", "cheque", "debito", "credito"].map((valor) => ({ valor, rotulo: rotulo(ROTULO_FORMA, valor) }));
const STATUS = ["pendente", "confirmado", "liquidado", "cancelado"].map((valor) => ({ valor, rotulo: rotulo(ROTULO_STATUS, valor) }));
/** Parcela de título: "<documento> – parcela 2/4" (e "– saldo" na parcela do saldo de um pagamento parcial). */
const rotuloConta = (l: Lancamento) =>
  l.titulo_id && l.parcela_num && l.parcela_total ? `${l.descricao} – parcela ${l.parcela_num}/${l.parcela_total}${l.parcela_de ? " – saldo" : ""}` : l.descricao || "—";
const tom = (s: string) => (s === "cancelado" ? "terracota" : s === "pendente" ? "amarelo" : "verde");

function NovoFornecedor({ localId, aoCriar, aoFechar }: { localId: string; aoCriar: (id: string) => void; aoFechar: () => void }) {
  const [razao, setRazao] = useState("");
  const [cnpj, setCnpj] = useState("");
  const criar = useCriarFornecedor();
  return (
    <Janela aberta aoFechar={aoFechar} titulo="Novo fornecedor">
      <form className="formulario" onSubmit={(e) => {
        e.preventDefault();
        if (!razao.trim()) return;
        criar.mutate({ local_id: localId, razao_social: razao.trim(), cnpj: cnpj.trim() || undefined }, {
          onSuccess: (f) => { aoCriar((f as { id: string }).id); aoFechar(); },
        });
      }}>
        <CampoTexto rotulo="Razão social" valor={razao} aoMudar={setRazao} />
        <CampoTexto rotulo="CNPJ (opcional)" valor={cnpj} aoMudar={setCnpj} />
        <ErroAcao erro={criar.error} />
        <div className="formulario__acoes">
          <Botao variante="contorno" ignorarConexao onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" disabled={!razao.trim() || criar.isPending}>Cadastrar</Botao>
        </div>
      </form>
    </Janela>
  );
}

function PainelNova({ localId, aoFechar }: { localId: string; aoFechar: () => void }) {
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("fornecedor");
  const [fornecedorId, setFornecedorId] = useState("");
  const [valor, setValor] = useState<number | null>(null);
  const [vencimento, setVencimento] = useState(() => dataLocal(7));
  const [novoFornecedor, setNovoFornecedor] = useState(false);
  const fornecedores = useFornecedores(localId);
  const criar = useCriarContaPagar();
  const criarTitulo = useCriarTitulo();
  const parc = useParcelamento(valor, vencimento);
  const motivos = [
    ...(descricao.trim() === "" ? ["Informe a descrição."] : []),
    ...(!valor ? ["Informe o valor."] : []),
    ...(!vencimento ? ["Informe o vencimento."] : []),
  ];
  return (
    <>
    <form className="formulario" onSubmit={(e) => {
      e.preventDefault();
      if (motivos.length > 0 || parc.motivos.length > 0 || valor === null) return;
      if (parc.parcelado) {
        criarTitulo.mutate({ tipo: "pagar", local_id: localId, documento: descricao.trim(), categoria, valor_total: valor, fornecedor_id: fornecedorId || undefined, ...parc.corpo() }, { onSuccess: aoFechar });
        return;
      }
      criar.mutate({ local_id: localId, descricao: descricao.trim(), categoria, valor, vencimento, fornecedor_id: fornecedorId || undefined }, { onSuccess: aoFechar });
    }}>
      <Selecao rotulo="Tipo" valor={categoria} aoMudar={setCategoria} opcoes={CATEGORIAS} />
      <CampoTexto rotulo="Descrição" valor={descricao} aoMudar={setDescricao} />
      <Selecao
        rotulo="Fornecedor"
        valor={fornecedorId}
        aoMudar={setFornecedorId}
        vazio="Sem fornecedor"
        opcoes={(fornecedores.data ?? []).map((f) => ({ valor: f.id, rotulo: f.razao_social }))}
      />
      <div><Botao variante="contorno" tamanho="pequeno" onClick={() => setNovoFornecedor(true)}>+ Novo fornecedor</Botao></div>
      <CampoDinheiro rotulo="Valor" valor={valor} aoMudar={setValor} />
      <SecaoParcelamento p={parc} total={valor} vencimento={<CampoTexto rotulo={parc.parcelado ? "Primeiro vencimento" : "Vencimento"} tipo="date" valor={vencimento} aoMudar={setVencimento} />} />
      {motivos.length > 0 && <p className="fin__suave">{motivos[0]}</p>}
      <ErroAcao erro={criar.error ?? criarTitulo.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={motivos.length > 0 || parc.motivos.length > 0 || criar.isPending || criarTitulo.isPending}>Lançar conta a pagar</Botao>
      </div>
    </form>
    {novoFornecedor && <NovoFornecedor localId={localId} aoCriar={setFornecedorId} aoFechar={() => setNovoFornecedor(false)} />}
    </>
  );
}

function PainelPagar({ item, contas, aoFechar }: { item: Lancamento; contas: Conta[]; aoFechar: () => void }) {
  const [contaId, setContaId] = useState(contas[0]?.id ?? "");
  const [forma, setForma] = useState(item.forma_pagamento === "boleto" ? "pix" : item.forma_pagamento);
  const [valor, setValor] = useState<number | null>(item.valor);
  const [novoVenc, setNovoVenc] = useState("");
  const baixar = useBaixarContaPagar();
  const parcial = valor !== null && valor > 0 && valor < item.valor;
  const invalido = !contaId || !valor || valor > item.valor || (parcial && !novoVenc);
  return (
    <form className="formulario" onSubmit={(e) => {
      e.preventDefault();
      if (invalido || valor === null) return;
      baixar.mutate(
        { id: item.id, conta_id: contaId, forma_pagamento: forma, ...(parcial ? { valor, novo_vencimento: novoVenc } : {}) },
        { onSuccess: aoFechar },
      );
    }}>
      <p>{item.descricao} — <strong>{formatarReais(item.valor)}</strong></p>
      <Selecao rotulo="Pagar com a conta" valor={contaId} aoMudar={setContaId} opcoes={contas.map((c) => ({ valor: c.id, rotulo: `${c.nome} (${formatarReais(c.saldo)})` }))} />
      <Selecao rotulo="Forma de pagamento" valor={forma} aoMudar={setForma} opcoes={FORMAS_PAGAR} />
      <CampoDinheiro rotulo="Valor a pagar agora" valor={valor} aoMudar={setValor} />
      {valor !== null && valor > item.valor && <p role="alert" className="erro-acao">O valor é maior que o devido ({formatarReais(item.valor)}).</p>}
      {parcial && (
        <>
          <p className="fin__suave">Fica um saldo de {formatarReais(item.valor - valor!)} em uma nova parcela, ligada a esta conta.</p>
          <CampoTexto rotulo="Novo vencimento do saldo" tipo="date" valor={novoVenc} aoMudar={setNovoVenc} />
        </>
      )}
      <ErroAcao erro={baixar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={invalido || baixar.isPending}>Confirmar pagamento</Botao>
      </div>
    </form>
  );
}

export function ContasPagarTab({ localId, contas }: { localId: string; contas: Conta[] }) {
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [status, setStatus] = useState("");
  const [novo, setNovo] = useState(false);
  const [pagar, setPagar] = useState<Lancamento | null>(null);
  const [cancelar, setCancelar] = useState<Lancamento | null>(null);
  const [estornar, setEstornar] = useState<Lancamento | null>(null);
  const [titulo, setTitulo] = useState<Lancamento | null>(null);
  const estorno = useEstornarLancamento();
  const q = useLancamentos(localId, { inicio, fim }, "pagamento");
  const cancelamento = useCancelarLancamento();

  // Os lançamentos de estorno (contrapartida de uma reversão) não são contas a pagar.
  const linhas = useMemo(() => (q.data ?? []).filter((l) => l.referencia_tipo !== "estorno" && (!status || l.status === status)), [q.data, status]);
  const pendente = linhas.filter((l) => l.status === "pendente").reduce((s, l) => s + l.valor, 0);

  return (
    <Cartao className="fin__bloco">
      <div className="fin__filtros">
        <CampoTexto rotulo="De" tipo="date" valor={inicio} aoMudar={setInicio} />
        <CampoTexto rotulo="Até" tipo="date" valor={fim} aoMudar={setFim} />
        <Selecao rotulo="Situação" valor={status} aoMudar={setStatus} vazio="Todas" opcoes={STATUS} />
        <div className="fin__acao-topo"><Botao onClick={() => setNovo(true)}>+ Nova conta a pagar</Botao></div>
      </div>
      <Estado carregando={q.isLoading} erro={q.error}>
        {linhas.length === 0 ? (
          <p className="fin__suave">Nenhuma conta a pagar encontrada.</p>
        ) : (
          <>
            <p className="fin__suave">A pagar neste filtro: {formatarReais(pendente)}</p>
            <div className="fin__rolagem">
              <table className="fin__tabela">
                <thead><tr><th>Vencimento</th><th>Descrição</th><th>Tipo</th><th>Favorecido</th><th className="fin__num">Valor</th><th>Situação</th><th><span className="fin__oculto">Ações</span></th></tr></thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.id}>
                      <td>{dataBr(l.vencimento_dia ?? l.dia)}</td>
                      <td>{rotuloConta(l)}{l.valor_total ? <span className="fin__suave"> · pago parcial ({formatarReais(l.valor)} de {formatarReais(l.valor_total)})</span> : null}{l.parcela_de && !l.titulo_id ? <span className="fin__suave"> · saldo de pagamento parcial</span> : null}</td>
                      <td>{l.categoria ? rotulo(ROTULO_CATEGORIA, l.categoria) : "—"}</td>
                      <td>{l.fornecedor_nome ?? "—"}</td>
                      <td className="fin__num">{formatarReais(l.valor)}</td>
                      <td><Etiqueta tom={tom(l.status)}>{rotulo(ROTULO_STATUS, l.status)}</Etiqueta></td>
                      <td className="fin__acoes">
                        {l.titulo_id && <Botao variante="contorno" tamanho="pequeno" onClick={() => setTitulo(l)}>Ver título</Botao>}
                        {l.categoria !== "taxa_cartao" && l.status === "pendente" && <Botao tamanho="pequeno" onClick={() => setPagar(l)}>Pagar</Botao>}
                        {l.categoria !== "taxa_cartao" && l.status === "pendente" && <Botao variante="contorno" tamanho="pequeno" onClick={() => setCancelar(l)}>Cancelar</Botao>}
                        {l.categoria !== "taxa_cartao" && l.status === "confirmado" && <Botao variante="contorno" tamanho="pequeno" onClick={() => setEstornar(l)}>Estornar pagamento</Botao>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Estado>
      <Gaveta aberta={novo} aoFechar={() => setNovo(false)} titulo="Nova conta a pagar">
        {novo && <PainelNova localId={localId} aoFechar={() => setNovo(false)} />}
      </Gaveta>
      <Gaveta aberta={titulo !== null} aoFechar={() => setTitulo(null)} titulo={`Título ${titulo?.descricao ?? ""}`}>
        {titulo?.titulo_id && <TituloDetalhe id={titulo.titulo_id} />}
      </Gaveta>
      <Gaveta aberta={pagar !== null} aoFechar={() => setPagar(null)} titulo="Pagar conta">
        {pagar && <PainelPagar item={pagar} contas={contas} aoFechar={() => setPagar(null)} />}
      </Gaveta>
      <JanelaSupervisor
        aberta={estornar !== null}
        titulo="Estornar pagamento"
        aoCancelar={() => setEstornar(null)}
        aoConfirmar={async (aut) => {
          if (!estornar) return;
          await estorno.mutateAsync({ id: estornar.id, aut });
          setEstornar(null);
        }}
      />
      <JanelaSupervisor
        aberta={cancelar !== null}
        titulo="Cancelar lançamento"
        aoCancelar={() => setCancelar(null)}
        aoConfirmar={async (aut) => {
          if (!cancelar) return;
          await cancelamento.mutateAsync({ id: cancelar.id, aut });
          setCancelar(null);
        }}
      />
    </Cartao>
  );
}
