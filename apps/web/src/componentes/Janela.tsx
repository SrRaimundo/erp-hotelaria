import { useEffect, useRef, type ReactNode } from "react";
import { useEsc } from "./useEsc";

type Props = { aberta: boolean; aoFechar: () => void; titulo: string; children: ReactNode };

const FOCAVEIS = 'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])';

/** Modal centralizado com fundo escurecido. O botão de fechar vem por último no DOM para o foco inicial cair no conteúdo. */
export function Janela({ aberta, aoFechar, titulo, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEsc(aberta, aoFechar, 1); // modal: sempre acima da Gaveta
  useEffect(() => {
    if (!aberta) return;
    const anterior = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCAVEIS)?.focus();
    return () => anterior?.focus?.();
  }, [aberta]);
  if (!aberta) return null;
  return (
    <div className="janela__fundo">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={titulo} className="janela">
        <h2 className="janela__titulo">{titulo}</h2>
        <div className="janela__corpo">{children}</div>
        <button type="button" className="janela__fechar" aria-label="Fechar" onClick={aoFechar}>
          ×
        </button>
      </div>
    </div>
  );
}
