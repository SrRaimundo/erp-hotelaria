import type { ReactNode } from "react";
import { useEsc } from "./useEsc";

type Props = { aberta: boolean; aoFechar: () => void; titulo: string; children: ReactNode };

/** Painel lateral que não escurece nem bloqueia a página (o mapa segue utilizável). */
export function Gaveta({ aberta, aoFechar, titulo, children }: Props) {
  useEsc(aberta, aoFechar);
  if (!aberta) return null;
  return (
    <aside role="dialog" aria-label={titulo} className="gaveta">
      <h2 className="gaveta__titulo">{titulo}</h2>
      <div className="gaveta__corpo">{children}</div>
      <button type="button" className="gaveta__fechar" aria-label="Fechar" onClick={aoFechar}>
        ×
      </button>
    </aside>
  );
}
