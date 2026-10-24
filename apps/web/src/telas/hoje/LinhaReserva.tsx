import type { ReactNode } from "react";

type Props = { quarto: string | null; titulo: string; detalhe: string; etiqueta?: ReactNode; acao?: ReactNode };

/** Linha padrão das listas de chegadas e saídas: número do quarto, nome e linha suave, etiqueta e botão. */
export function LinhaReserva({ quarto, titulo, detalhe, etiqueta, acao }: Props) {
  return (
    <li className="hoje-linha">
      <span className="hoje-linha__quarto">{quarto ?? "—"}</span>
      <div className="hoje-linha__texto">
        <strong>{titulo}</strong>
        <span className="hoje-suave">{detalhe}</span>
      </div>
      {etiqueta}
      {acao}
    </li>
  );
}
