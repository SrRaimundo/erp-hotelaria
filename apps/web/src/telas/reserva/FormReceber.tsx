import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { chamarApi } from "../../api/cliente";
import { useAcao, useCaixa, useFormasPagamento } from "../../api/consultas";
import type { FormaPagamento } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { CampoDinheiro } from "../../componentes/CampoDinheiro";
import { ErroAcao } from "../../componentes/ErroAcao";

type Props = { contaId: string; reservaId: string; receberInicial: number | null; aoReceber: () => void };

/** Carrega caixa e formas; só monta o formulário (e foca o valor) quando tudo está pronto. */
export function FormReceber(props: Props) {
  const caixa = useCaixa();
  const formas = useFormasPagamento();
  if (caixa.error) return <ErroAcao erro={caixa.error} />;
  if (caixa.data === undefined || !formas.data) return formas.error ? <ErroAcao erro={formas.error} /> : <p className="reserva-suave">Carregando…</p>;
  if (caixa.data === null) {
    return (
      <div className="conta-aviso" role="status">
        <p>Abra o caixa para receber pagamentos</p>
        <Link to="/caixa">Ir para o caixa</Link>
      </div>
    );
  }
  return <Formulario {...props} formas={formas.data.filter((f) => f.ativa && f.codigo !== "faturado")} />;
}

function Formulario({ contaId, reservaId, receberInicial, aoReceber, formas }: Props & { formas: FormaPagamento[] }) {
  const receber = useAcao((c: { reservaId: string; formaCodigo: string; valor: number }) =>
    chamarApi("POST", `/api/contas/${encodeURIComponent(contaId)}/pagamentos`, c),
  );
  const ref = useRef<HTMLFormElement>(null);
  const [forma, setForma] = useState<string>(formas[0]?.codigo ?? "");
  const [valor, setValor] = useState<number | null>(receberInicial);
  const [erro, setErro] = useState<Error | null>(null);

  useEffect(() => {
    if (receberInicial !== null) ref.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (valor === null || valor < 1) {
      setErro(new Error("Informe o valor a receber."));
      return;
    }
    try {
      await receber.mutateAsync({ reservaId, formaCodigo: forma, valor });
      setValor(null);
      aoReceber();
    } catch (x) {
      setErro(x instanceof Error ? x : new Error("Não foi possível registrar o pagamento."));
    }
  }

  return (
    <form ref={ref} className="formulario conta-form" onSubmit={(e) => void enviar(e)} aria-labelledby="titulo-receber">
      <h4 id="titulo-receber">Receber pagamento</h4>
      <CampoDinheiro rotulo="Valor a receber" valor={valor} aoMudar={setValor} />
      <div className="campo">
        <label htmlFor="receber-forma">Forma de pagamento</label>
        <select id="receber-forma" value={forma} onChange={(e) => setForma(e.target.value)}>
          {formas.map((f) => (
            <option key={f.codigo} value={f.codigo}>{f.nome}</option>
          ))}
        </select>
      </div>
      <ErroAcao erro={erro} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={receber.isPending || formas.length === 0}>Receber</Botao>
      </div>
    </form>
  );
}
