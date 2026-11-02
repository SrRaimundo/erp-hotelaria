import { useEffect, useId, useState } from "react";

type Props = { rotulo: string; valor: number | null; aoMudar: (v: number | null) => void; aceitaNegativo?: boolean };

const comoTexto = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));
/** "12,5" -> 12.5; vazio ou inválido -> null. Até duas casas. */
export function lerPercentual(t: string, aceitaNegativo: boolean): number | null {
  const limpo = t.trim();
  const valido = (aceitaNegativo ? /^-?\d+(?:[,.]\d{1,2})?$/ : /^\d+(?:[,.]\d{1,2})?$/).test(limpo);
  return valido ? Number(limpo.replace(",", ".")) : null;
}

export function CampoPercentual({ rotulo, valor, aoMudar, aceitaNegativo = false }: Props) {
  const id = useId();
  const [texto, setTexto] = useState(() => comoTexto(valor));
  useEffect(() => {
    if (valor !== lerPercentual(texto, aceitaNegativo)) setTexto(comoTexto(valor));
  }, [valor]); // eslint-disable-line react-hooks/exhaustive-deps
  const invalido = texto.trim() !== "" && lerPercentual(texto, aceitaNegativo) === null;
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <input
        id={id}
        inputMode="decimal"
        placeholder="0"
        value={texto}
        aria-invalid={invalido}
        onChange={(e) => {
          setTexto(e.target.value);
          aoMudar(lerPercentual(e.target.value, aceitaNegativo));
        }}
      />
      {invalido && (
        <p role="alert" className="erro-acao">
          Valor inválido
        </p>
      )}
    </div>
  );
}
