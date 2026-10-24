import type { Categoria, Quarto } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";

/** Acomodação de uma reserva. `null` em categoria/quarto = ainda não mexeu (vale o padrão/URL). */
export type Acomodacao = { categoriaId: string | null; quartoId: string | null; adultos: string; criancas: string[] };

export const acomodacaoInicial = (): Acomodacao => ({ categoriaId: null, quartoId: null, adultos: "2", criancas: [] });

export function dataValida(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function adultosValidos(s: string): number | null {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) && n >= 1 ? n : null;
}

type Props = {
  /** Sufixo dos rótulos (" da linha 2") para distinguir linhas de grupo; vazio na reserva simples. */
  sufixo?: string;
  valor: Acomodacao;
  /** Categoria e quarto já resolvidos (padrões aplicados). */
  categoriaId: string;
  quartoId: string;
  categorias: Categoria[];
  quartos: Quarto[];
  aoMudar: (a: Acomodacao) => void;
};

export function CamposAcomodacao({ sufixo = "", valor, categoriaId, quartoId, categorias, quartos, aoMudar }: Props) {
  const daCategoria = quartos.filter((q) => q.categoriaId === categoriaId);
  const base: Acomodacao = { ...valor, categoriaId, quartoId };
  return (
    <div className="nova-acomodacao">
      <div className="campo">
        <label htmlFor={`aco-cat${sufixo}`}>{`Categoria${sufixo}`}</label>
        <select id={`aco-cat${sufixo}`} value={categoriaId} onChange={(e) => aoMudar({ ...base, categoriaId: e.target.value, quartoId: "" })}>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor={`aco-quarto${sufixo}`}>{`Quarto${sufixo}`}</label>
        <select id={`aco-quarto${sufixo}`} value={quartoId} onChange={(e) => aoMudar({ ...base, quartoId: e.target.value })}>
          <option value="">Qualquer quarto livre</option>
          {daCategoria.map((q) => (
            <option key={q.id} value={q.id}>
              {q.numero}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor={`aco-adultos${sufixo}`}>{`Adultos${sufixo}`}</label>
        <input id={`aco-adultos${sufixo}`} type="number" min={1} value={valor.adultos} onChange={(e) => aoMudar({ ...base, adultos: e.target.value })} />
      </div>
      <div className="nova-criancas">
        {valor.criancas.map((nasc, i) => (
          <div className="campo nova-crianca" key={i}>
            <label htmlFor={`aco-crianca-${i}${sufixo}`}>{`Nascimento da criança ${i + 1}${sufixo}`}</label>
            <input
              id={`aco-crianca-${i}${sufixo}`}
              type="date"
              value={nasc}
              onChange={(e) => aoMudar({ ...base, criancas: valor.criancas.map((c, j) => (j === i ? e.target.value : c)) })}
            />
            <Botao variante="contorno" tamanho="pequeno" aria-label={`Remover criança ${i + 1}${sufixo}`} onClick={() => aoMudar({ ...base, criancas: valor.criancas.filter((_, j) => j !== i) })}>
              Remover
            </Botao>
          </div>
        ))}
        <Botao variante="contorno" tamanho="pequeno" onClick={() => aoMudar({ ...base, criancas: [...valor.criancas, ""] })}>
          {`+ criança${sufixo}`}
        </Botao>
      </div>
    </div>
  );
}
