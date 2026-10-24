import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { chamarApi } from "../../api/cliente";
import { useAcao, useCaixa, useFormasPagamento } from "../../api/consultas";
import type { FormaPagamento, PreviaCheckout, ReservaDetalhe } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { CampoDinheiro } from "../../componentes/CampoDinheiro";
import { ErroAcao } from "../../componentes/ErroAcao";
import { formatarReais } from "../../lib/dinheiro";

type Props = {
  reserva: ReservaDetalhe;
  /** Muda parâmetros da URL (undefined remove) preservando os demais. */
  aoMudarUrl: (mudancas: Record<string, string | undefined>) => void;
};

type Linha = { chave: number; forma: string; valor: number | null };
type Corpo = {
  pagamentos: { formaCodigo: string; valor: number }[];
  faturado?: { nome: string; documento: string; valor: number };
  cobrarLateCheckout: boolean;
};

const ATRASO_VOLTA_MS = 1200;

/** Carrega prévia, formas e caixa; só monta o formulário quando tudo está pronto. */
export function FluxoCheckout({ reserva, aoMudarUrl }: Props) {
  const previa = useQuery({
    queryKey: ["checkout-previa", reserva.id],
    queryFn: () => chamarApi<PreviaCheckout>("GET", `/api/reservas/${encodeURIComponent(reserva.id)}/checkout`),
    // A prévia vale para esta abertura do fluxo: não refaz sozinha enquanto há valores digitados.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const formas = useFormasPagamento();
  const caixa = useCaixa();

  const erro = previa.error ?? formas.error ?? caixa.error;
  const pronto = previa.data && formas.data && caixa.data !== undefined;
  if (!pronto) {
    return (
      <div className="checkin">
        <h3>Check-out</h3>
        {erro ? <ErroAcao erro={erro} /> : <p className="reserva-suave">Carregando…</p>}
        {erro && (
          <div className="formulario__acoes">
            <Botao variante="contorno" ignorarConexao onClick={() => aoMudarUrl({ fluxo: undefined })}>Cancelar</Botao>
          </div>
        )}
      </div>
    );
  }
  return (
    <Formulario
      reserva={reserva}
      aoMudarUrl={aoMudarUrl}
      previa={previa.data!}
      formas={formas.data!.filter((f) => f.ativa && f.codigo !== "faturado")}
      caixaAberto={caixa.data !== null}
    />
  );
}

function Formulario({ reserva, aoMudarUrl, previa, formas, caixaAberto }: Props & { previa: PreviaCheckout; formas: FormaPagamento[]; caixaAberto: boolean }) {
  const proxima = useRef(2);
  const [cobrarLate, setCobrarLate] = useState(true);
  // A prévia já inclui a taxa de late check-out; desmarcar a retira do saldo.
  const taxa = previa.lateCheckout ?? 0;
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    previa.saldo > 0 && formas[0] ? [{ chave: 1, forma: formas[0].codigo, valor: previa.saldo }] : [],
  );
  const [faturar, setFaturar] = useState(false);
  const [nome, setNome] = useState("");
  const [documento, setDocumento] = useState("");
  const [valorFaturado, setValorFaturado] = useState<number | null>(null);
  const [erro, setErro] = useState<Error | null>(null);
  const [concluido, setConcluido] = useState<string | null>(null);

  const checkout = useAcao((corpo: Corpo) => chamarApi("POST", `/api/reservas/${encodeURIComponent(reserva.id)}/checkout`, corpo));

  // Depois do sucesso, deixa a confirmação visível um instante e fecha a gaveta.
  useEffect(() => {
    if (concluido === null) return;
    const t = setTimeout(() => aoMudarUrl({ reserva: undefined, aba: undefined, fluxo: undefined, receber: undefined }), ATRASO_VOLTA_MS);
    return () => clearTimeout(t);
    // aoMudarUrl muda a cada render da gaveta; o temporizador só depende da conclusão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concluido]);

  const devido = previa.saldo - (cobrarLate ? 0 : taxa);
  const somaPagamentos = linhas.reduce((s, l) => s + (l.valor ?? 0), 0);
  const restante = devido - somaPagamentos - (faturar ? (valorFaturado ?? 0) : 0);

  const linhasValidas = linhas.every((l) => l.forma !== "" && l.valor !== null && l.valor >= 1);
  const faturadoValido = !faturar || (nome.trim() !== "" && documento.trim() !== "" && valorFaturado !== null && valorFaturado >= 1);
  const semCaixa = !caixaAberto && linhas.some((l) => (l.valor ?? 0) > 0);
  const podeConcluir = restante === 0 && linhasValidas && faturadoValido && !semCaixa && !checkout.isPending;

  const mudarLinha = (chave: number, mudanca: Partial<Linha>) =>
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, ...mudanca } : l)));

  function adicionarLinha() {
    setLinhas((atual) => [...atual, { chave: proxima.current++, forma: formas[0]?.codigo ?? "", valor: restante > 0 ? restante : null }]);
  }

  function abrirFaturar(ligado: boolean) {
    setFaturar(ligado);
    if (ligado) setValorFaturado(restante > 0 ? restante : null);
  }

  async function concluir() {
    setErro(null);
    const corpo: Corpo = {
      pagamentos: linhas.map((l) => ({ formaCodigo: l.forma, valor: l.valor! })),
      cobrarLateCheckout: cobrarLate,
      ...(faturar ? { faturado: { nome: nome.trim(), documento: documento.trim(), valor: valorFaturado! } } : {}),
    };
    try {
      await checkout.mutateAsync(corpo);
      setConcluido(reserva.quartoNumero ?? "");
    } catch (x) {
      setErro(x instanceof Error ? x : new Error("Não foi possível concluir o check-out."));
    }
  }

  if (concluido !== null) {
    return (
      <p role="status" className="checkin-ok">
        {`Check-out concluído · quarto ${concluido} enviado para limpeza`}
      </p>
    );
  }

  const situacao =
    restante > 0
      ? { texto: `Falta ${formatarReais(restante)}`, classe: "checkout-restante checkout-restante--pendente" }
      : restante < 0
        ? { texto: `Sobra ${formatarReais(-restante)}`, classe: "checkout-restante checkout-restante--pendente" }
        : { texto: `Tudo certo: ${formatarReais(0)}`, classe: "checkout-restante checkout-restante--ok" };

  return (
    <div className="checkin">
      <h3>Check-out</h3>

      <section aria-labelledby="checkout-conta" className="checkin-secao">
        <h4 id="checkout-conta">Conta</h4>
        {previa.saidaAntecipada && (
          <p className="conta-aviso" role="status">Saída antecipada — as noites seguintes serão canceladas</p>
        )}
        <ul className="checkout-extrato">
          {previa.extrato.map((l) => (
            <li key={l.id}>
              <span>{l.descricao}</span>
              <span className={l.natureza === "credito" ? "conta-valor conta-valor--credito" : "conta-valor"}>
                {`${l.natureza === "credito" ? "−" : ""}${formatarReais(l.valor)}`}
              </span>
            </li>
          ))}
        </ul>
        {taxa > 0 && (
          <>
            <label className="checkin-opcao">
              <input type="checkbox" checked={cobrarLate} onChange={(e) => setCobrarLate(e.target.checked)} />
              Cobrar late check-out
            </label>
            <p className="reserva-suave">{`Late check-out: ${formatarReais(taxa)}`}</p>
          </>
        )}
        <p className="checkout-devido">
          <strong>Total a pagar</strong> <strong>{formatarReais(devido)}</strong>
        </p>
      </section>

      <section aria-labelledby="checkout-pagamentos" className="checkin-secao">
        <h4 id="checkout-pagamentos">Pagamentos</h4>
        {linhas.map((l, i) => (
          <div key={l.chave} className="checkout-linha">
            <div className="campo">
              <label htmlFor={`checkout-forma-${l.chave}`}>{`Forma de pagamento ${i + 1}`}</label>
              <select id={`checkout-forma-${l.chave}`} value={l.forma} onChange={(e) => mudarLinha(l.chave, { forma: e.target.value })}>
                {formas.map((f) => (
                  <option key={f.codigo} value={f.codigo}>{f.nome}</option>
                ))}
              </select>
            </div>
            <CampoDinheiro rotulo={`Valor da forma ${i + 1}`} valor={l.valor} aoMudar={(v) => mudarLinha(l.chave, { valor: v })} />
            <Botao variante="contorno" tamanho="pequeno" aria-label={`Remover forma ${i + 1}`} onClick={() => setLinhas((atual) => atual.filter((x) => x.chave !== l.chave))}>
              Remover
            </Botao>
          </div>
        ))}
        {semCaixa && (
          <div className="conta-aviso" role="status">
            <p>Abra o caixa para receber pagamentos</p>
            <Link to="/caixa">Ir para o caixa</Link>
          </div>
        )}
        <div>
          <Botao variante="contorno" disabled={formas.length === 0} onClick={adicionarLinha}>+ outra forma</Botao>
        </div>
      </section>

      <section aria-labelledby="checkout-faturar" className="checkin-secao">
        <h4 id="checkout-faturar">Faturar</h4>
        <label className="checkin-opcao">
          <input type="checkbox" checked={faturar} onChange={(e) => abrirFaturar(e.target.checked)} />
          Faturar para empresa
        </label>
        {faturar && (
          <>
            <div className="campo">
              <label htmlFor="checkout-fat-nome">Nome do responsável</label>
              <input id="checkout-fat-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
            </div>
            <div className="campo">
              <label htmlFor="checkout-fat-doc">Documento do responsável</label>
              <input id="checkout-fat-doc" value={documento} onChange={(e) => setDocumento(e.target.value)} autoComplete="off" />
            </div>
            <CampoDinheiro rotulo="Valor faturado" valor={valorFaturado} aoMudar={setValorFaturado} />
          </>
        )}
      </section>

      <section aria-labelledby="checkout-confirmar" className="checkin-secao">
        <h4 id="checkout-confirmar">Confirmar</h4>
        <p className={situacao.classe} role="status">{situacao.texto}</p>
        <ErroAcao erro={erro} />
        <div className="formulario__acoes">
          <Botao variante="contorno" ignorarConexao onClick={() => aoMudarUrl({ fluxo: undefined })}>Cancelar</Botao>
          <Botao disabled={!podeConcluir} onClick={() => void concluir()}>Concluir check-out</Botao>
        </div>
      </section>
    </div>
  );
}
