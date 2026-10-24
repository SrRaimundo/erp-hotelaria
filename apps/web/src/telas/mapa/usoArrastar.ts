import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Barra } from "../../api/tipos";
import { somarDiasIso } from "../../lib/datas";

export type Movimento = {
  reservaId: string;
  tipo: "mover" | "esticar" | "alterar";
  quartoId?: string;
  /** Só vai quando o quarto de destino é de outra categoria (o servidor exige quarto e categoria coerentes). */
  categoriaId?: string;
  chegada?: string;
  saida?: string;
  /** Só no formulário Alterar da gaveta. */
  adultos?: number;
  criancasNascimento?: string[];
};

/** Linha da grade; `categoriaId` fica indefinido quando o nome da categoria não identifica um id com segurança. */
export type LinhaArrasto = { quartoId: string | null; categoriaId?: string };

type Opcoes = {
  larguraColuna: number;
  alturaLinha: number;
  /** Linhas renderizadas, de cima para baixo; só usadas quando não há hit-test no DOM (jsdom). */
  linhas: LinhaArrasto[];
  /** Primeiro dia visível; arrastar para antes dele conta como soltar fora da grade. */
  inicio: string;
  aoSoltar: (m: Movimento) => void;
};

type Alvo = Pick<Barra, "reservaId" | "quartoId" | "categoriaId" | "chegada" | "saida" | "estado">;
type Gesto = { reservaId: string; tipo: "mover" | "esticar"; x0: number; y0: number; arrastando: boolean; linhaOrigem: Element | null; pointerId: number; captura: HTMLElement };

/** Deslocamento já ajustado à grade (px), para a barra acompanhar o ponteiro por colunas/linhas inteiras. */
export type Deslocamento = { reservaId: string; tipo: "mover" | "esticar"; dx: number; dy: number };

/** Abaixo disto o gesto é um clique. */
export const LIMIAR_ARRASTO = 6;
const ESTADOS_ARRASTAVEIS = ["pre_reserva", "confirmada", "hospedada"];

export const arrastavel = (estado: string) => ESTADOS_ARRASTAVEIS.includes(estado);

/** Calcula o movimento resultante de soltar `alvo` com `colunas`/`linhas` de deslocamento; null = nada a fazer. */
export function calcularMovimento(alvo: Alvo, tipo: "mover" | "esticar", colunas: number, linha: LinhaArrasto | null, inicio: string): Movimento | null {
  if (tipo === "esticar") {
    const saida = somarDiasIso(alvo.saida, colunas);
    const minima = somarDiasIso(alvo.chegada, 1);
    const nova = saida < minima ? minima : saida;
    return nova === alvo.saida ? null : { reservaId: alvo.reservaId, tipo, saida: nova };
  }

  const hospedada = alvo.estado === "hospedada";
  if (!linha) return null;

  const deslocaDatas = !hospedada && colunas !== 0;
  const chegada = deslocaDatas ? somarDiasIso(alvo.chegada, colunas) : alvo.chegada;
  if (deslocaDatas && chegada < inicio && alvo.chegada >= inicio) return null;

  const m: Movimento = { reservaId: alvo.reservaId, tipo };
  if (linha.quartoId === null) {
    // Soltar sobre "sem quarto" só vale como mudança de datas de quem já está sem quarto naquela categoria.
    if (alvo.quartoId !== null || linha.categoriaId !== alvo.categoriaId || !deslocaDatas) return null;
  } else {
    if (linha.quartoId !== alvo.quartoId) {
      m.quartoId = linha.quartoId;
      if (linha.categoriaId && linha.categoriaId !== alvo.categoriaId) m.categoriaId = linha.categoriaId;
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

/**
 * Linha da grade sob o ponteiro (ignorando a própria barra arrastada, que fica dentro da linha de origem).
 * undefined = o navegador/jsdom não oferece hit-test; null = o ponteiro não está sobre nenhuma linha.
 */
function linhaSob(x: number, y: number, barra: Element): HTMLElement | null | undefined {
  if (typeof document.elementsFromPoint !== "function") return undefined;
  for (const el of document.elementsFromPoint(x, y)) {
    if (barra.contains(el)) continue;
    const linha = el.closest<HTMLElement>("[data-linha]");
    if (linha) return linha;
  }
  return null;
}

const dadosDaLinha = (el: HTMLElement): LinhaArrasto => ({ quartoId: el.dataset.quartoId ?? null, categoriaId: el.dataset.categoriaId || undefined });

export function usoArrastar(opcoes: Opcoes) {
  const { larguraColuna, alturaLinha } = opcoes;
  const gesto = useRef<Gesto | null>(null);
  const clique = useRef(false); // o clique que o navegador dispara depois de um arrasto deve ser ignorado
  const [deslocamento, setDeslocamento] = useState<Deslocamento | null>(null);

  const encerrar = (g: Gesto | null) => {
    gesto.current = null;
    setDeslocamento(null);
    if (g) {
      try {
        g.captura.releasePointerCapture?.(g.pointerId);
      } catch {
        // captura já liberada pelo navegador
      }
    }
  };

  // Esc cancela o arrasto em andamento; ao desmontar, qualquer gesto pendente é descartado.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const g = gesto.current;
      if (e.key !== "Escape" || !g) return;
      if (g.arrastando) clique.current = true; // o clique do soltar seguinte não deve abrir a reserva
      encerrar(g);
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      gesto.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const passosDeColuna = (g: Gesto, e: PointerEvent) => Math.round((e.clientX - g.x0) / larguraColuna);
  const distancia = (g: Gesto, e: PointerEvent) => Math.hypot(e.clientX - g.x0, e.clientY - g.y0);

  /** Linha de destino: hit-test no DOM; sem ele (jsdom), cai no deslocamento uniforme por altura de linha. */
  const linhaDestino = (alvo: Alvo, g: Gesto, e: PointerEvent): LinhaArrasto | null => {
    const sob = linhaSob(e.clientX, e.clientY, g.captura);
    if (sob !== undefined) return sob ? dadosDaLinha(sob) : null;
    const origem = opcoes.linhas.findIndex((l) => (alvo.quartoId ? l.quartoId === alvo.quartoId : l.quartoId === null && l.categoriaId === alvo.categoriaId));
    const destino = origem + Math.round((e.clientY - g.y0) / alturaLinha);
    return origem < 0 ? null : (opcoes.linhas[destino] ?? null);
  };

  const propsDaBarra = (alvo: Alvo) => {
    if (!arrastavel(alvo.estado)) return undefined;
    return {
      onPointerDown(e: PointerEvent<HTMLElement>) {
        if (e.button !== 0) return;
        clique.current = false;
        const alca = (e.target as HTMLElement).closest("[data-alca]") !== null;
        gesto.current = {
          reservaId: alvo.reservaId, tipo: alca ? "esticar" : "mover", x0: e.clientX, y0: e.clientY, arrastando: false,
          linhaOrigem: e.currentTarget.closest("[data-linha]"), pointerId: e.pointerId, captura: e.currentTarget,
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        const g = gesto.current;
        if (!g || g.reservaId !== alvo.reservaId) return;
        if (!g.arrastando && distancia(g, e) < LIMIAR_ARRASTO) return;
        g.arrastando = true;
        const hospedada = alvo.estado === "hospedada";
        let dy = 0;
        if (g.tipo === "mover") {
          const sob = linhaSob(e.clientX, e.clientY, g.captura);
          // Com hit-test, a barra pula para o topo da linha sob o ponteiro (cabeçalhos e linhas altas incluídos).
          dy = sob && g.linhaOrigem
            ? sob.getBoundingClientRect().top - g.linhaOrigem.getBoundingClientRect().top
            : sob === null ? e.clientY - g.y0 : Math.round((e.clientY - g.y0) / alturaLinha) * alturaLinha;
        }
        setDeslocamento({ reservaId: g.reservaId, tipo: g.tipo, dx: g.tipo === "mover" && hospedada ? 0 : passosDeColuna(g, e) * larguraColuna, dy });
      },
      onPointerUp(e: PointerEvent<HTMLElement>) {
        const g = gesto.current;
        encerrar(g);
        if (!g || g.reservaId !== alvo.reservaId || !g.arrastando) return; // abaixo do limiar: é clique
        clique.current = true;
        const colunas = passosDeColuna(g, e);
        const linha = g.tipo === "mover" ? linhaDestino(alvo, g, e) : null;
        const m = calcularMovimento(alvo, g.tipo, colunas, linha, opcoes.inicio);
        if (m) opcoes.aoSoltar(m);
      },
      onPointerCancel() {
        const g = gesto.current;
        if (g?.arrastando) clique.current = true;
        encerrar(g);
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
