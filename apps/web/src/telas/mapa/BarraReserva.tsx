import type { Barra } from "../../api/tipos";
import { formatarData } from "../../lib/datas";
import type { PosicaoBarra } from "./geometria";
import type { Deslocamento, usoArrastar } from "./usoArrastar";

const ESTADOS: Record<string, string> = {
  pre_reserva: "pré-reserva",
  confirmada: "confirmada",
  hospedada: "hospedada",
  finalizada: "finalizada",
};

/** Largura mínima (em colunas) para mostrar também o código da reserva. */
const COLUNAS_PARA_CODIGO = 3;

type Props = {
  barra: Barra;
  posicao: PosicaoBarra;
  pista?: number;
  aoAbrir: (reservaId: string) => void;
  /** Handlers de arrasto; ausente quando a reserva não pode ser movida. */
  arrasto?: ReturnType<ReturnType<typeof usoArrastar>["propsDaBarra"]>;
  deslocamento?: Deslocamento | null;
};

export function BarraReserva({ barra, posicao, pista = 0, aoAbrir, arrasto, deslocamento }: Props) {
  const descricao = `${barra.titular} · ${formatarData(barra.chegada)}–${formatarData(barra.saida)} · ${ESTADOS[barra.estado] ?? barra.estado}`;
  const classes = ["mapa-barra", posicao.cortadaInicio && "mapa-barra--corta-inicio", posicao.cortadaFim && "mapa-barra--corta-fim", arrasto && "mapa-barra--arrastavel", deslocamento && "mapa-barra--arrastando"].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={classes}
      data-estado={barra.estado}
      title={descricao}
      aria-label={descricao}
      style={{
        gridColumn: `${posicao.coluna + 2} / span ${posicao.largura}`,
        gridRow: pista + 1,
        ...(deslocamento?.tipo === "mover" && { transform: `translate(${deslocamento.dx}px, ${deslocamento.dy}px)` }),
        ...(deslocamento?.tipo === "esticar" && { width: `calc(100% - 2px + ${deslocamento.dx}px)` }),
      }}
      onPointerDown={arrasto?.onPointerDown}
      onPointerMove={arrasto?.onPointerMove}
      onPointerUp={arrasto?.onPointerUp}
      onPointerCancel={arrasto?.onPointerCancel}
      onClick={() => {
        if (arrasto?.engolirClique()) return;
        aoAbrir(barra.reservaId);
      }}
    >
      {posicao.largura >= COLUNAS_PARA_CODIGO ? `${barra.titular} #${barra.codigo}` : barra.titular}
      {arrasto && !posicao.cortadaFim && <span className="mapa-barra__alca" data-alca="esticar" aria-hidden="true" />}
    </button>
  );
}
