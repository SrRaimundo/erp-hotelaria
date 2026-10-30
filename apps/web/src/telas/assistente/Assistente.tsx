import { useQuery } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import { useState } from "react";
import { useNavigate } from "react-router";
import { rotaInicial, useSessao } from "../../auth/SessaoProvider";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import "../configuracoes/configuracoes.css";
import { PassoEquipe, type EstadoEquipe } from "./PassoEquipe";
import { PassoPousada } from "./PassoPousada";
import { PassoPronto } from "./PassoPronto";
import { PassoQuartos } from "./PassoQuartos";

export type EstadoAssistente = {
  pousada: boolean;
  quartos: boolean;
  equipe: boolean;
  categorias: { id: string; nome: string; quartos: string[] }[];
};

const PASSOS = ["Pousada", "Quartos", "Equipe", "Pronto"] as const;

export const useEstadoAssistente = (ativo = true) =>
  useQuery({ queryKey: ["assistente"], queryFn: () => chamarApi<EstadoAssistente>("GET", "/api/assistente"), enabled: ativo });

/** Primeiro passo incompleto (0 a 3); tudo completo cai em "Pronto". */
const primeiroIncompleto = (e: EstadoAssistente): number => (!e.pousada ? 0 : !e.quartos ? 1 : !e.equipe ? 2 : 3);

function Corpo({ estado }: { estado: EstadoAssistente }) {
  const { usuario } = useSessao();
  const navegar = useNavigate();
  const [equipe, setEquipe] = useState<EstadoEquipe | null>(null);
  const [passo, setPasso] = useState(() => primeiroIncompleto(estado));
  const avancar = () => setPasso((p) => Math.min(p + 1, 3));
  const voltar = () => setPasso((p) => Math.max(p - 1, 0));

  return (
    <>
      <ol className="assistente__passos" aria-label="Passos">
        {PASSOS.map((nome, i) => (
          <li key={nome} className="assistente__passo" aria-current={i === passo ? "step" : undefined}>
            {i + 1} {nome}
          </li>
        ))}
      </ol>
      {passo === 0 && <PassoPousada aoAvancar={avancar} />}
      {passo === 1 && <PassoQuartos estado={estado} aoAvancar={avancar} aoVoltar={voltar} />}
      {passo === 2 && <PassoEquipe equipe={equipe} aoMudar={setEquipe} aoAvancar={avancar} aoVoltar={voltar} />}
      {passo === 3 && <PassoPronto estado={estado} aoVoltar={voltar} />}
      <div>
        <Botao variante="contorno" ignorarConexao onClick={() => void navegar(usuario ? rotaInicial(usuario) : "/")}>
          Sair do assistente
        </Botao>
      </div>
    </>
  );
}

/** Assistente de primeira configuração: pousada, categorias e quartos, equipe e resumo (spec §4). */
export function Assistente() {
  const estado = useEstadoAssistente();
  return (
    <div className="assistente">
      <h1>Primeira configuração</h1>
      {estado.isError && <ErroAcao erro={estado.error} />}
      {estado.data ? <Corpo estado={estado.data} /> : !estado.isError && <p>Carregando…</p>}
    </div>
  );
}
