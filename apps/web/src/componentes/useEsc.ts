import { useEffect, useRef } from "react";

// Painéis abertos: Esc fecha apenas o de maior prioridade (modal acima de não modal);
// em empate, o aberto por último. A prioridade evita depender da ordem dos efeitos no mesmo commit.
type Item = { id: symbol; prioridade: number };
const pilha: Item[] = [];

function topo(): symbol | undefined {
  let melhor: Item | undefined;
  for (const i of pilha) if (!melhor || i.prioridade >= melhor.prioridade) melhor = i;
  return melhor?.id;
}

export function useEsc(ativo: boolean, aoFechar: () => void, prioridade = 0): void {
  const ref = useRef(aoFechar);
  ref.current = aoFechar;
  useEffect(() => {
    if (!ativo) return;
    const id = Symbol("painel");
    pilha.push({ id, prioridade });
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" && topo() === id) ref.current();
    };
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("keydown", tecla);
      const i = pilha.findIndex((x) => x.id === id);
      if (i >= 0) pilha.splice(i, 1);
    };
  }, [ativo, prioridade]);
}
