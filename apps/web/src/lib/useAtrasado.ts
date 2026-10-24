import { useEffect, useState } from "react";

/** Devolve `valor` só depois de `ms` sem mudar (debounce para buscas e cotações). */
export function useAtrasado<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}
