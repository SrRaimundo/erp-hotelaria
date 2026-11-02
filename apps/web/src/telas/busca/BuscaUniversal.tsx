import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { useBusca, usePainel } from "../../api/consultas";
import type { ResultadoBusca } from "../../api/tipos";
import { somarDiasIso } from "../../lib/datas";
import { Botao } from "../../componentes/Botao";
import { ROTA_CONTA_RELATORIO } from "../reserva/GavetaReserva";
import { ErroAcao } from "../../componentes/ErroAcao";
import "./busca.css";

const ROTULOS: Record<string, string> = {
  abrir: "Abrir",
  ver_quarto: "Ver no mapa",
  checkin: "Check-in",
  checkout: "Check-out",
  registrar_pagamento: "Receber",
  lancar_extra: "Lançar extra",
  nova_reserva: "Nova reserva",
  ver_historico: "Histórico",
};
const GRUPOS: { tipo: ResultadoBusca["tipo"]; titulo: string }[] = [
  { tipo: "quarto", titulo: "Quartos" },
  { tipo: "reserva", titulo: "Reservas" },
  { tipo: "hospede", titulo: "Hóspedes" },
];
const ATRASO_MS = 250;

/** Conteúdo da Janela de busca; montado só enquanto ela está aberta, então o estado nasce limpo a cada abertura. */
export function BuscaUniversal({ aoFechar }: { aoFechar: () => void }) {
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const [ativo, setAtivo] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), ATRASO_MS);
    return () => clearTimeout(t);
  }, [texto]);

  const busca = useBusca(q);
  const dia = usePainel().data?.dia;
  const grupos = useMemo(() => GRUPOS.map((g) => ({ ...g, itens: (busca.data ?? []).filter((r) => r.tipo === g.tipo) })).filter((g) => g.itens.length > 0), [busca.data]);
  const linhas = useMemo(() => grupos.flatMap((g) => g.itens), [grupos]);
  useEffect(() => setAtivo(0), [busca.data]);

  /** Reserva abre na rota atual (contrato da gaveta, R1); demais ações têm destino próprio. */
  const executar = (r: ResultadoBusca, acao: string) => {
    const reserva = `?reserva=${encodeURIComponent(r.id)}`;
    // No relatório da conta o ?reserva é o filtro do relatório: as ações do painel vão para o mapa, onde a gaveta abre.
    const base = pathname === ROTA_CONTA_RELATORIO ? "/mapa" : pathname;
    const destinos: Record<string, string> = {
      abrir: r.tipo === "quarto" ? "/mapa" : pathname + reserva,
      ver_quarto: "/mapa",
      checkin: `${base}${reserva}&fluxo=checkin`,
      checkout: `${base}${reserva}&fluxo=checkout`,
      registrar_pagamento: `${base}${reserva}&aba=conta`,
      lancar_extra: `${base}${reserva}&aba=conta`,
      nova_reserva: `/reservas/nova?hospede=${encodeURIComponent(r.id)}`,
      ver_historico: `/reservas?q=${encodeURIComponent(r.rotulo.split(" — ")[0] ?? r.rotulo)}${dia ? `&inicio=${somarDiasIso(dia, -365)}` : ""}&estado=finalizada`,
    };
    const destino = destinos[acao];
    if (!destino) return;
    aoFechar();
    void navegar(destino);
  };

  const teclas = (e: KeyboardEvent) => {
    if (linhas.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo((i) => (i + 1) % linhas.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((i) => (i - 1 + linhas.length) % linhas.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = linhas[ativo];
      const primeira = r?.acoes[0];
      if (r && primeira) executar(r, primeira);
    }
  };

  const idLinha = (r: ResultadoBusca) => `busca-${r.tipo}-${r.id}`;
  const vazio = q === "";

  return (
    <div className="busca">
      <input
        className="busca__campo"
        role="combobox"
        aria-label="Buscar"
        aria-expanded={linhas.length > 0}
        aria-controls="busca-lista"
        aria-autocomplete="list"
        aria-activedescendant={linhas[ativo] ? idLinha(linhas[ativo]) : undefined}
        placeholder="Quarto, hóspede, CPF ou nº da reserva"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={teclas}
      />
      {vazio && <p className="busca__dica">Digite para buscar…</p>}
      <ErroAcao erro={busca.error} />
      {!vazio && busca.data && linhas.length === 0 && <p className="busca__dica">Nenhum resultado.</p>}
      <div id="busca-lista" role="listbox" aria-label="Resultados" className="busca__lista" hidden={linhas.length === 0}>
        {grupos.map((g) => (
          <div key={g.tipo} role="group" aria-label={g.titulo} className="busca__grupo">
            <h3>{g.titulo}</h3>
            {g.itens.map((r) => (
              <div key={r.id} id={idLinha(r)} role="option" aria-selected={linhas[ativo] === r} className={`busca__linha${linhas[ativo] === r ? " busca__linha--ativa" : ""}`}>
                <span>{r.rotulo}</span>
                <span className="busca__acoes">
                  {r.acoes.map((a) => (
                    <Botao key={a} tamanho="pequeno" variante="contorno" onClick={() => executar(r, a)}>
                      {ROTULOS[a] ?? a}
                    </Botao>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
