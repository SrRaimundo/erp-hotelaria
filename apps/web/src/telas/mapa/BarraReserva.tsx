import type { Barra } from "../../api/tipos";
import { formatarData } from "../../lib/datas";
import type { PosicaoBarra } from "./geometria";

const ESTADOS: Record<string, string> = {
  pre_reserva: "pré-reserva",
  confirmada: "confirmada",
  hospedada: "hospedada",
  finalizada: "finalizada",
};

/** Largura mínima (em colunas) para mostrar também o código da reserva. */
const COLUNAS_PARA_CODIGO = 3;

type Props = { barra: Barra; posicao: PosicaoBarra; pista?: number; aoAbrir: (reservaId: string) => void };

export function BarraReserva({ barra, posicao, pista = 0, aoAbrir }: Props) {
  const descricao = `${barra.titular} · ${formatarData(barra.chegada)}–${formatarData(barra.saida)} · ${ESTADOS[barra.estado] ?? barra.estado}`;
  const classes = ["mapa-barra", posicao.cortadaInicio && "mapa-barra--corta-inicio", posicao.cortadaFim && "mapa-barra--corta-fim"].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={classes}
      data-estado={barra.estado}
      title={descricao}
      aria-label={descricao}
      style={{ gridColumn: `${posicao.coluna + 2} / span ${posicao.largura}`, gridRow: pista + 1 }}
      onClick={() => aoAbrir(barra.reservaId)}
    >
      {posicao.largura >= COLUNAS_PARA_CODIGO ? `${barra.titular} #${barra.codigo}` : barra.titular}
    </button>
  );
}
