import type { Mapa } from "../../api/tipos";
import { ehFimDeSemana, formatarData, nomeDiaCurto } from "../../lib/datas";
import { BarraReserva } from "./BarraReserva";
import { ALTURA_LINHA, LARGURA_COLUNA, LARGURA_ROTULO, colunasDoPeriodo, distribuirPistas, linhaDeQuarto, posicaoBarra, type LinhaMapa } from "./geometria";

const SITUACOES: Record<string, string> = { sujo: "sujo", em_manutencao: "manutenção", bloqueado: "bloqueado" };

type Props = {
  mapa: Mapa;
  inicio: string;
  dias: number;
  hoje: string;
  nomesCategoria: Record<string, string>;
  aoAbrirReserva: (reservaId: string) => void;
  aoCriarReserva: (quartoId: string, data: string) => void;
};

function classeDia(dia: string, hoje: string): string {
  return ["mapa-dia", dia === hoje && "mapa-dia--hoje", ehFimDeSemana(dia) && "mapa-dia--fds"].filter(Boolean).join(" ");
}

export function GradeMapa({ mapa, inicio, dias, hoje, nomesCategoria, aoAbrirReserva, aoCriarReserva }: Props) {
  const colunas = colunasDoPeriodo(inicio, dias);
  const grupos = linhaDeQuarto(mapa.quartos, mapa.barras, nomesCategoria);
  const modelo = `${LARGURA_ROTULO}px repeat(${dias}, ${LARGURA_COLUNA}px)`;

  const renderLinha = (linha: LinhaMapa) => {
    const posicionadas = linha.barras.flatMap((b) => {
      const posicao = posicaoBarra(b, inicio, dias);
      return posicao ? [{ barra: b, posicao }] : [];
    });
    const quarto = linha.quarto;
    const pistas = quarto ? posicionadas.map(() => 0) : distribuirPistas(posicionadas.map((p) => p.posicao));
    const nPistas = Math.max(1, ...pistas.map((p) => p + 1));
    const ocupadas = new Set(posicionadas.flatMap(({ posicao: p }) => Array.from({ length: p.largura }, (_, i) => p.coluna + i)));
    const situacao = quarto ? SITUACOES[quarto.situacao] : undefined;
    return (
      <div className="mapa-linha" key={linha.chave} style={{ gridTemplateColumns: modelo, gridTemplateRows: `repeat(${nPistas}, ${ALTURA_LINHA}px)` }}>
        <div className="mapa-rotulo" style={{ gridRow: `1 / span ${nPistas}` }}>
          <strong>{quarto ? quarto.numero : "Sem quarto"}</strong>
          {situacao && <span className={`mapa-situacao mapa-situacao--${quarto!.situacao}`}>{situacao}</span>}
        </div>
        {colunas.map((dia, i) => (
          <div key={dia} className={classeDia(dia, hoje)} style={{ gridColumn: i + 2, gridRow: `1 / span ${nPistas}` }}>
            {quarto && !ocupadas.has(i) && (
              <button
                type="button"
                className="mapa-celula"
                aria-label={`Nova reserva no quarto ${quarto.numero} em ${formatarData(dia)}`}
                onClick={() => aoCriarReserva(quarto.id, dia)}
              />
            )}
          </div>
        ))}
        {posicionadas.map(({ barra, posicao }, i) => (
          <BarraReserva key={barra.reservaId} barra={barra} posicao={posicao} pista={pistas[i]} aoAbrir={aoAbrirReserva} />
        ))}
      </div>
    );
  };

  return (
    <div className="mapa-rolagem">
      <div className="mapa-grade" role="table" aria-label="Mapa de ocupação" style={{ minWidth: LARGURA_ROTULO + dias * LARGURA_COLUNA }}>
        <div className="mapa-linha mapa-cabecalho" role="row" style={{ gridTemplateColumns: modelo }}>
          <div className="mapa-rotulo" role="presentation" />
          {colunas.map((dia) => (
            <div key={dia} role="columnheader" className={classeDia(dia, hoje)} aria-current={dia === hoje ? "date" : undefined}>
              {`${nomeDiaCurto(dia)} ${formatarData(dia)}`}
            </div>
          ))}
        </div>
        {grupos.map((g) => (
          <section key={g.categoria} className="mapa-grupo">
            <h2 className="mapa-grupo__titulo">{g.categoria}</h2>
            {g.linhas.map(renderLinha)}
          </section>
        ))}
      </div>
    </div>
  );
}
