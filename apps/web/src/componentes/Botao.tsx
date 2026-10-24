import type { ButtonHTMLAttributes } from "react";
import { useConexao } from "../api/useConexao";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "principal" | "secundario" | "contorno";
  tamanho?: "normal" | "pequeno";
  /** Mantém o botão habilitado mesmo sem conexão (ex.: Cancelar, Sair). */
  ignorarConexao?: boolean;
};

export function Botao({ variante = "principal", tamanho = "normal", ignorarConexao = false, disabled, type = "button", className, ...resto }: Props) {
  const { online } = useConexao();
  const classes = ["botao", `botao--${variante}`, `botao--${tamanho}`, className].filter(Boolean).join(" ");
  return <button {...resto} type={type} className={classes} disabled={disabled || (!online && !ignorarConexao)} />;
}
