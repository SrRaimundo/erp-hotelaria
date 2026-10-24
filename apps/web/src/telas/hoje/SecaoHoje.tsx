import type { ReactNode } from "react";

/** Cartão com título (e subtítulo suave) usado pelos blocos da tela Hoje. */
export function SecaoHoje({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <section className="cartao hoje-secao">
      <header className="hoje-secao__cabecalho">
        <h2>{titulo}</h2>
        {subtitulo && <span className="hoje-suave">{subtitulo}</span>}
      </header>
      {children}
    </section>
  );
}
