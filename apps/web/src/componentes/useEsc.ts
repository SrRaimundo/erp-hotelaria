import { useEffect, useRef } from "react";

// Pilha de painéis abertos: Esc fecha apenas o de cima.
const pilha: symbol[] = [];

export function useEsc(ativo: boolean, aoFechar: () => void): void {
  const ref = useRef(aoFechar);
  ref.current = aoFechar;
  useEffect(() => {
    if (!ativo) return;
    const id = Symbol("painel");
    pilha.push(id);
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pilha[pilha.length - 1] === id) ref.current();
    };
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("keydown", tecla);
      const i = pilha.indexOf(id);
      if (i >= 0) pilha.splice(i, 1);
    };
  }, [ativo]);
}
