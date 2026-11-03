import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { chamarApi } from "../../api/cliente";
import { usePainel, useReservas } from "../../api/consultas";
import type { Canal } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Etiqueta } from "../../componentes/Etiqueta";
import { formatarData, somarDiasIso } from "../../lib/datas";
import { formatarReais } from "../../lib/dinheiro";
import { ESTADOS_RESERVA, type EstadoReservaId } from "../../lib/estados";
import "./reservas.css";

const POR_PAGINA = 50;
const ORDEM_ESTADOS: EstadoReservaId[] = ["pre_reserva", "confirmada", "hospedada", "finalizada", "cancelada", "no_show"];
const ESTADOS_PADRAO: EstadoReservaId[] = ["pre_reserva", "confirmada", "hospedada", "finalizada"];
const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function TelaReservas() {
  const painel = usePainel();
  const [params, setParams] = useSearchParams();
  const canaisQ = useQuery({ queryKey: ["canais"], queryFn: () => chamarApi<Canal[]>("GET", "/api/tarifas/canais"), staleTime: 300_000, refetchInterval: false });

  const dia = painel.data?.dia;
  const inicio = params.get("inicio") ?? (dia ? somarDiasIso(dia, -7) : "");
  const fim = params.get("fim") ?? (dia ? somarDiasIso(dia, 30) : "");
  const estadoParam = params.get("estado");
  const estados = estadoParam === null ? ESTADOS_PADRAO : ORDEM_ESTADOS.filter((e) => estadoParam.split(",").includes(e));
  const canal = params.get("canal") ?? "";
  const q = params.get("q") ?? "";
  const pagina = Math.max(1, Number(params.get("pagina")) || 1);

  /** Altera filtros na URL (sempre voltando à página 1); preserva os demais parâmetros, como `reserva`. */
  const mudar = (mudancas: Record<string, string | undefined>, manterPagina = false) =>
    setParams(
      (atual) => {
        const novo = new URLSearchParams(atual);
        for (const [k, v] of Object.entries(mudancas)) v === undefined || v === "" ? novo.delete(k) : novo.set(k, v);
        if (!manterPagina) novo.delete("pagina");
        return novo;
      },
      { replace: true },
    );

  // Texto digitado: só vira filtro (URL e API) 300 ms depois da última tecla.
  const [texto, setTexto] = useState(q);
  useEffect(() => setTexto(q), [q]);
  useEffect(() => {
    if (texto === q) return;
    const t = setTimeout(() => mudar({ q: texto.trim() === "" ? undefined : texto }), 300);
    return () => clearTimeout(t);
  }, [texto]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sem painel não há o "hoje" da operação nem período padrão: espera antes de consultar.
  const pronto = !!dia || (params.get("inicio") !== null && params.get("fim") !== null);
  const lista = useReservas({ inicio, fim, estado: estados.join(","), canal, q, pagina, porPagina: POR_PAGINA }, pronto);

  const alternar = (e: EstadoReservaId) => {
    if (estados.length === 1 && estados[0] === e) return; // ao menos um estado fica marcado
    const novos = estados.includes(e) ? estados.filter((x) => x !== e) : ORDEM_ESTADOS.filter((x) => estados.includes(x) || x === e);
    mudar({ estado: novos.join(",") });
  };
  const abrir = (id: string) => mudar({ reserva: id, aba: undefined, fluxo: undefined, receber: undefined }, true);

  const total = lista.data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="reservas">
      <div className="reservas-topo">
        <h1>Reservas</h1>
        <Link to="/reservas/tarifas/simulador" className="botao botao--contorno botao--normal">Simular</Link>
      </div>
      <div className="reservas-filtros">
        <div className="campo">
          <label htmlFor="res-de">De</label>
          <input id="res-de" type="date" value={inicio} onChange={(e) => mudar({ inicio: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="res-ate">Até</label>
          <input id="res-ate" type="date" value={fim} onChange={(e) => mudar({ fim: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="res-canal">Canal</label>
          <select id="res-canal" value={canal} onChange={(e) => mudar({ canal: e.target.value })}>
            <option value="">Todos os canais</option>
            {(canaisQ.data ?? []).map((c) => (
              <option key={c.id} value={c.nome}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="campo reservas-busca">
          <label htmlFor="res-busca">Buscar</label>
          <input id="res-busca" type="search" placeholder="Nome do titular ou código" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
      </div>
      <div className="reservas-chips" role="group" aria-label="Estados">
        {ORDEM_ESTADOS.map((e) => (
          <button key={e} type="button" className="reservas-chip" aria-pressed={estados.includes(e)} onClick={() => alternar(e)}>
            {capitalizar(ESTADOS_RESERVA[e].rotulo)}
          </button>
        ))}
      </div>

      {lista.isError && <ErroAcao erro={lista.error} />}
      {painel.isError && !dia && <ErroAcao erro={painel.error} />}
      {painel.isError && !dia ? null : !pronto || (lista.isPending && !lista.isError) ? (
        <p>Carregando…</p>
      ) : lista.data && lista.data.itens.length === 0 ? (
        <p className="reservas-suave">Nenhuma reserva encontrada.</p>
      ) : (
        lista.data && (
          <div className="reservas-rolagem">
            <table className="reservas-tabela">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Titular</th>
                  <th>Quarto</th>
                  <th>Categoria</th>
                  <th>Chegada</th>
                  <th>Saída</th>
                  <th>Estado</th>
                  <th className="reservas-num">Total</th>
                </tr>
              </thead>
              <tbody>
                {lista.data.itens.map((r) => {
                  const est = ESTADOS_RESERVA[r.estado];
                  return (
                    <tr key={r.reservaId} onClick={() => abrir(r.reservaId)}>
                      <td>
                        <button type="button" className="reservas-codigo" aria-label={`Abrir reserva ${r.codigo}`}>
                          {r.codigo}
                        </button>
                      </td>
                      <td>{r.titular}</td>
                      <td>{r.quartoNumero ?? "—"}</td>
                      <td>{r.categoria}</td>
                      <td>{formatarData(r.chegada, true)}</td>
                      <td>{formatarData(r.saida, true)}</td>
                      <td>
                        <Etiqueta tom={est.tom}>{est.rotulo}</Etiqueta>
                      </td>
                      <td className="reservas-num">{formatarReais(r.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      <div className="reservas-paginacao">
        <Botao variante="contorno" tamanho="pequeno" disabled={pagina <= 1} onClick={() => mudar({ pagina: String(pagina - 1) }, true)}>
          Anterior
        </Botao>
        <span className="reservas-suave">{`Página ${pagina} de ${paginas}`}</span>
        <Botao variante="contorno" tamanho="pequeno" disabled={pagina >= paginas} onClick={() => mudar({ pagina: String(pagina + 1) }, true)}>
          Próxima
        </Botao>
      </div>
    </div>
  );
}
