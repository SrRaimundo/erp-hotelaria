import type { ReactNode } from "react";
import { ErroAcao } from "../componentes/ErroAcao";

export const dataBr = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return d && m && a ? `${d}/${m}/${a}` : iso;
};

/** Carregando / erro de uma consulta; renderiza `children` quando há dados. */
export function Estado({ carregando, erro, children }: { carregando: boolean; erro: Error | null | undefined; children: ReactNode }) {
  if (erro) return <ErroAcao erro={erro} />;
  if (carregando) return <p className="fin__suave" role="status">Carregando…</p>;
  return <>{children}</>;
}

export const rotuloStatus = (s: string) => s.replace(/_/g, " ");

/** Barras horizontais simples (CSS) para valores em centavos. */
export function Barras({ itens }: { itens: { rotulo: string; valor: number; tom?: "verde" | "terracota" | "amarelo" }[] }) {
  const max = Math.max(1, ...itens.map((i) => Math.abs(i.valor)));
  return (
    <ul className="fin__barras">
      {itens.map((i) => (
        <li key={i.rotulo}>
          <span className="fin__barra-rotulo">{i.rotulo}</span>
          <span className="fin__barra-trilho" role="img" aria-label={`${i.rotulo}: ${Math.round((Math.abs(i.valor) / max) * 100)}% do maior valor`}>
            <span className={`fin__barra fin__barra--${i.tom ?? "verde"}`} style={{ width: `${(Math.abs(i.valor) / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
