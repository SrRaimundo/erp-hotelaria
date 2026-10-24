import { useSearchParams } from "react-router";
import { useReserva } from "../../api/consultas";
import type { ReservaDetalhe } from "../../api/tipos";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Etiqueta } from "../../componentes/Etiqueta";
import { Gaveta } from "../../componentes/Gaveta";
import { formatarData } from "../../lib/datas";
import { AbaHospedes } from "./AbaHospedes";
import { AbaResumo } from "./AbaResumo";
import { AcoesReserva } from "./AcoesReserva";
import "./reserva.css";

type Aba = "resumo" | "conta" | "hospedes";
type Fluxo = "checkin" | "checkout";
type Mudancas = Record<string, string | undefined>;

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "resumo", rotulo: "Resumo" },
  { id: "conta", rotulo: "Conta" },
  { id: "hospedes", rotulo: "Hóspedes" },
];

const ESTADOS: Record<ReservaDetalhe["estado"], { rotulo: string; tom: "neutro" | "verde" | "terracota" | "amarelo" }> = {
  pre_reserva: { rotulo: "pré-reserva", tom: "amarelo" },
  confirmada: { rotulo: "confirmada", tom: "verde" },
  hospedada: { rotulo: "hospedada", tom: "verde" },
  finalizada: { rotulo: "finalizada", tom: "neutro" },
  cancelada: { rotulo: "cancelada", tom: "terracota" },
  no_show: { rotulo: "no-show", tom: "terracota" },
};

const PARAMETROS = ["reserva", "aba", "fluxo", "receber"];

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Ponto único de troca: as Tarefas 11, 12 e 13 substituem estes marcadores pelas telas reais. */
function Conteudo({ reserva, aba, fluxo }: { reserva: ReservaDetalhe; aba: Aba; fluxo: Fluxo | null }) {
  if (fluxo === "checkin") return <h3>Check-in</h3>;
  if (fluxo === "checkout") return <h3>Check-out</h3>;
  if (aba === "conta") return <h3>Conta</h3>;
  if (aba === "hospedes") return <AbaHospedes reserva={reserva} />;
  return <AbaResumo reserva={reserva} />;
}

/** Painel da reserva: aparece em qualquer rota que tenha ?reserva=<id>. */
export function GavetaReserva() {
  const [params, setParams] = useSearchParams();
  const id = params.get("reserva");
  if (!id) return null;

  function mudar(mudancas: Mudancas) {
    setParams((atual) => {
      const novo = new URLSearchParams(atual);
      for (const [k, v] of Object.entries(mudancas)) {
        if (v === undefined) novo.delete(k);
        else novo.set(k, v);
      }
      return novo;
    });
  }
  const fechar = () => mudar(Object.fromEntries(PARAMETROS.map((p) => [p, undefined])));

  const abaParam = params.get("aba");
  const aba: Aba = ABAS.some((a) => a.id === abaParam) ? (abaParam as Aba) : "resumo";
  const fluxoParam = params.get("fluxo");
  const fluxo: Fluxo | null = fluxoParam === "checkin" || fluxoParam === "checkout" ? fluxoParam : null;

  return <PainelReserva key={id} id={id} aba={aba} fluxo={fluxo} aoMudar={mudar} aoFechar={fechar} />;
}

type PainelProps = { id: string; aba: Aba; fluxo: Fluxo | null; aoMudar: (m: Mudancas) => void; aoFechar: () => void };

function PainelReserva({ id, aba, fluxo, aoMudar, aoFechar }: PainelProps) {
  const consulta = useReserva(id);
  const r = consulta.data;
  if (!r) {
    return (
      <Gaveta aberta aoFechar={aoFechar} titulo="Reserva">
        {consulta.error ? <ErroAcao erro={consulta.error} /> : <p className="reserva-suave">Carregando…</p>}
      </Gaveta>
    );
  }
  const estado = ESTADOS[r.estado];
  return (
    <Gaveta aberta aoFechar={aoFechar} titulo={`#${r.codigo} · ${r.titular.nome} · ${r.quartoNumero ? `Qto ${r.quartoNumero}` : "sem quarto"}`}>
      <div className="reserva-cabecalho">
        <span>{`${formatarData(r.chegada)} → ${formatarData(r.saida)} · ${plural(r.adultos, "adulto", "adultos")} + ${plural(r.criancasNascimento.length, "criança", "crianças")}`}</span>
        <Etiqueta tom={estado.tom}>{estado.rotulo}</Etiqueta>
      </div>
      {!fluxo && <AcoesReserva reserva={r} aoMudarUrl={aoMudar} />}
      {!fluxo && (
        <div role="tablist" aria-label="Seções da reserva" className="reserva-abas">
          {ABAS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              id={`aba-${a.id}`}
              aria-selected={aba === a.id}
              aria-controls="reserva-painel"
              className={aba === a.id ? "reserva-aba reserva-aba--ativa" : "reserva-aba"}
              onClick={() => aoMudar({ aba: a.id, fluxo: undefined, receber: undefined })}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      )}
      <div id="reserva-painel" role={fluxo ? undefined : "tabpanel"} aria-labelledby={fluxo ? undefined : `aba-${aba}`}>
        <Conteudo reserva={r} aba={aba} fluxo={fluxo} />
      </div>
    </Gaveta>
  );
}
