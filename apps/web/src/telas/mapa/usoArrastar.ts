import { useRef, useState, type PointerEvent } from "react";
import type { Barra } from "../../api/tipos";
import { somarDiasIso } from "../../lib/datas";

export type Movimento = {
  reservaId: string;
  tipo: "mover" | "esticar";
  quartoId?: string;
  /** Só vai quando o quarto de destino é de outra categoria (o servidor exige quarto e categoria coerentes). */
  categoriaId?: string;
  chegada?: string;
  saida?: string;
};

export type LinhaArrasto = { quartoId: string | null; categoriaId: string };

type Opcoes = {
  larguraColuna: number;
  alturaLinha: number;
  /** Linhas renderizadas, de cima para baixo. */
  linhas: LinhaArrasto[];
  /** Primeiro dia visível; arrastar para antes dele conta como soltar fora da grade. */
  inicio: string;
  aoSoltar: (m: Movimento) => void;
};

type Alvo = Pick<Barra, "reservaId" | "quartoId" | "categoriaId" | "chegada" | "saida" | "estado">;
type Gesto = { reservaId: string; tipo: "mover" | "esticar"; x0: number; y0: number; arrastando: boolean };

/** Deslocamento já ajustado à grade (px), para a barra acompanhar o ponteiro por colunas/linhas inteiras. */
export type Deslocamento = { reservaId: string; tipo: "mover" | "esticar"; dx: number; dy: number };

/** Abaixo disto o gesto é um clique. */
export const LIMIAR_ARRASTO = 6;
const ESTADOS_ARRASTAVEIS = ["pre_reserva", "confirmada", "hospedada"];

export const arrastavel = (estado: string) => ESTADOS_ARRASTAVEIS.includes(estado);

/** Calcula o movimento resultante de soltar `alvo` com `colunas`/`linhas` de deslocamento; null = nada a fazer. */
export function calcularMovimento(alvo: Alvo, tipo: "mover" | "esticar", colunas: number, linhas: number, o: Pick<Opcoes, "linhas" | "inicio">): Movimento | null {
  if (tipo === "esticar") {
    const saida = somarDiasIso(alvo.saida, colunas);
    const minima = somarDiasIso(alvo.chegada, 1);
    const nova = saida < minima ? minima : saida;
    return nova === alvo.saida ? null : { reservaId: alvo.reservaId, tipo, saida: nova };
  }

  const hospedada = alvo.estado === "hospedada";
  const origem = o.linhas.findIndex((l) => (alvo.quartoId ? l.quartoId === alvo.quartoId : l.quartoId === null && l.categoriaId === alvo.categoriaId));
  const destino = origem + linhas;
  if (origem < 0 || destino < 0 || destino >= o.linhas.length) return null;
  const linha = o.linhas[destino]!;

  const deslocaDatas = !hospedada && colunas !== 0;
  const chegada = deslocaDatas ? somarDiasIso(alvo.chegada, colunas) : alvo.chegada;
  if (deslocaDatas && chegada < o.inicio && alvo.chegada >= o.inicio) return null;

  const m: Movimento = { reservaId: alvo.reservaId, tipo };
  if (linha.quartoId === null) {
    // Soltar sobre "sem quarto" só vale como mudança de datas de quem já está sem quarto naquela categoria.
    if (alvo.quartoId !== null || linha.categoriaId !== alvo.categoriaId || !deslocaDatas) return null;
  } else {
    if (linha.quartoId !== alvo.quartoId) {
      m.quartoId = linha.quartoId;
      if (linha.categoriaId !== alvo.categoriaId) m.categoriaId = linha.categoriaId;
    } else if (!deslocaDatas) {
      return null;
    }
  }
  if (!hospedada) {
    m.chegada = chegada;
    m.saida = somarDiasIso(alvo.saida, deslocaDatas ? colunas : 0);
  }
  return m;
}

export function usoArrastar(opcoes: Opcoes) {
  const { larguraColuna, alturaLinha } = opcoes;
  const gesto = useRef<Gesto | null>(null);
  const clique = useRef(false); // o clique que o navegador dispara depois de um arrasto deve ser ignorado
  const [deslocamento, setDeslocamento] = useState<Deslocamento | null>(null);

  const passos = (g: Gesto, e: PointerEvent) => ({
    colunas: Math.round((e.clientX - g.x0) / larguraColuna),
    linhas: Math.round((e.clientY - g.y0) / alturaLinha),
  });
  const distancia = (g: Gesto, e: PointerEvent) => Math.hypot(e.clientX - g.x0, e.clientY - g.y0);

  const propsDaBarra = (alvo: Alvo) => {
    if (!arrastavel(alvo.estado)) return undefined;
    return {
      onPointerDown(e: PointerEvent<HTMLElement>) {
        if (e.button !== 0) return;
        clique.current = false;
        const alca = (e.target as HTMLElement).closest("[data-alca]") !== null;
        gesto.current = { reservaId: alvo.reservaId, tipo: alca ? "esticar" : "mover", x0: e.clientX, y0: e.clientY, arrastando: false };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        const g = gesto.current;
        if (!g || g.reservaId !== alvo.reservaId) return;
        if (!g.arrastando && distancia(g, e) < LIMIAR_ARRASTO) return;
        g.arrastando = true;
        const { colunas, linhas } = passos(g, e);
        const hospedada = alvo.estado === "hospedada";
        setDeslocamento({
          reservaId: g.reservaId,
          tipo: g.tipo,
          dx: g.tipo === "mover" && hospedada ? 0 : colunas * larguraColuna,
          dy: g.tipo === "mover" ? linhas * alturaLinha : 0,
        });
      },
      onPointerUp(e: PointerEvent<HTMLElement>) {
        const g = gesto.current;
        gesto.current = null;
        setDeslocamento(null);
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        if (!g || g.reservaId !== alvo.reservaId || !g.arrastando) return; // abaixo do limiar: é clique
        clique.current = true;
        const { colunas, linhas } = passos(g, e);
        const m = calcularMovimento(alvo, g.tipo, colunas, g.tipo === "mover" ? linhas : 0, opcoes);
        if (m) opcoes.aoSoltar(m);
      },
      onPointerCancel() {
        gesto.current = null;
        setDeslocamento(null);
      },
      /** Devolve true se este clique é só o rescaldo de um arrasto. */
      engolirClique(): boolean {
        const foi = clique.current;
        clique.current = false;
        return foi;
      },
    };
  };

  return { deslocamento, propsDaBarra };
}
