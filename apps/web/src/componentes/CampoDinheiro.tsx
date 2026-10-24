import { useEffect, useId, useState } from "react";
import { formatarReais, lerReais } from "../lib/dinheiro";

type Props = { rotulo: string; valor: number | null; aoMudar: (centavos: number | null) => void };

const comoTexto = (c: number | null) => (c === null ? "" : formatarReais(c).replace("R$ ", ""));
const ler = (t: string) => (t.trim() === "" ? null : lerReais(t));

export function CampoDinheiro({ rotulo, valor, aoMudar }: Props) {
  const id = useId();
  const [texto, setTexto] = useState(() => comoTexto(valor));
  // Mudança vinda de fora substitui o texto; texto inválido (valor null) não é sobrescrito.
  useEffect(() => {
    if (valor !== ler(texto)) setTexto(comoTexto(valor));
  }, [valor]); // eslint-disable-line react-hooks/exhaustive-deps
  const invalido = texto.trim() !== "" && lerReais(texto) === null;
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <input
        id={id}
        inputMode="decimal"
        placeholder="0,00"
        value={texto}
        aria-invalid={invalido}
        onChange={(e) => {
          setTexto(e.target.value);
          aoMudar(ler(e.target.value));
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
