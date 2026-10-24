import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useCategorias, useMapa, usePainel } from "../../api/consultas";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { formatarData, somarDiasIso } from "../../lib/datas";
import { GradeMapa } from "./GradeMapa";
import "./mapa.css";

const PERIODOS = [7, 14, 30];
const PERIODO_PADRAO = 14;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Espera o dia da operação (vem do servidor) antes de pedir o mapa, para nunca consultar com período vazio. */
export function TelaMapa() {
  const painel = usePainel();
  if (!painel.data) return painel.isError ? <ErroAcao erro={painel.error} /> : <p>Carregando…</p>;
  return <MapaDoPeriodo hoje={painel.data.dia} />;
}

function MapaDoPeriodo({ hoje }: { hoje: string }) {
  const categorias = useCategorias();
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();

  const dias = PERIODOS.includes(Number(params.get("dias"))) ? Number(params.get("dias")) : PERIODO_PADRAO;
  const inicioParam = params.get("inicio");
  const inicio = inicioParam && DATA.test(inicioParam) ? inicioParam : somarDiasIso(hoje, -1);
  const categoriaId = params.get("categoria") ?? "";
  // O servidor trata `fim` como inclusivo: último dia exibido.
  const fim = somarDiasIso(inicio, dias - 1);

  const mapa = useMapa({ inicio, fim, categoriaId: categoriaId || undefined });
  const nomesCategoria = useMemo(() => Object.fromEntries((categorias.data ?? []).map((c) => [c.id, c.nome])), [categorias.data]);

  /** Troca só os parâmetros dados (vazio/null remove), preservando os demais (ex.: `reserva`). */
  const alterar = (mudancas: Record<string, string | null>) =>
    setParams((atual) => {
      const novo = new URLSearchParams(atual);
      for (const [k, v] of Object.entries(mudancas)) {
        if (v === null || v === "") novo.delete(k);
        else novo.set(k, v);
      }
      return novo;
    });

  return (
    <div className="mapa">
      <header className="mapa-topo">
        <h1>Mapa de ocupação</h1>
        <div className="mapa-controles">
          <Botao variante="contorno" tamanho="pequeno" onClick={() => alterar({ inicio: somarDiasIso(inicio, -dias) })}>◀</Botao>
          <Botao variante="contorno" tamanho="pequeno" onClick={() => alterar({ inicio: null })}>Hoje</Botao>
          <Botao variante="contorno" tamanho="pequeno" onClick={() => alterar({ inicio: somarDiasIso(inicio, dias) })}>▶</Botao>
          <span className="mapa-suave">{`${formatarData(inicio)} a ${formatarData(fim)}`}</span>
          <label className="mapa-campo">
            <span>Período</span>
            <select aria-label="Período" value={dias} onChange={(e) => alterar({ dias: e.target.value === String(PERIODO_PADRAO) ? null : e.target.value })}>
              {PERIODOS.map((p) => <option key={p} value={p}>{`${p} dias`}</option>)}
            </select>
          </label>
          <label className="mapa-campo">
            <span>Categoria</span>
            <select aria-label="Categoria" value={categoriaId} onChange={(e) => alterar({ categoria: e.target.value })}>
              <option value="">Todas as categorias</option>
              {(categorias.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
        </div>
      </header>
      {mapa.isError && <ErroAcao erro={new Error(`Não foi possível carregar o mapa. ${mapa.error.message}`)} />}
      {mapa.data && !categorias.isPending ? (
        <GradeMapa
          mapa={mapa.data}
          inicio={inicio}
          dias={dias}
          hoje={hoje}
          nomesCategoria={nomesCategoria}
          aoAbrirReserva={(id) => alterar({ reserva: id })}
          aoCriarReserva={(quarto, data) => void navegar(`/reservas/nova?quarto=${encodeURIComponent(quarto)}&chegada=${data}`)}
        />
      ) : (
        !mapa.isError && <p>Carregando…</p>
      )}
    </div>
  );
}
