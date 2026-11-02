import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useReserva } from "../../api/consultas";
import type { ReservaDetalhe } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Etiqueta } from "../../componentes/Etiqueta";
import { Gaveta } from "../../componentes/Gaveta";
import { formatarData } from "../../lib/datas";
import { ESTADOS_RESERVA } from "../../lib/estados";
import { AbaConta } from "./AbaConta";
import { AbaHospedes } from "./AbaHospedes";
import { AbaResumo } from "./AbaResumo";
import { AcoesReserva } from "./AcoesReserva";
import { FluxoCheckin } from "./FluxoCheckin";
import { FluxoCheckout } from "./FluxoCheckout";
import "./reserva.css";

type Aba = "resumo" | "conta" | "hospedes";
type Fluxo = "checkin" | "checkout";
type Mudancas = Record<string, string | undefined>;

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "resumo", rotulo: "Resumo" },
  { id: "conta", rotulo: "Conta" },
  { id: "hospedes", rotulo: "Hóspedes" },
];

const PARAMETROS = ["reserva", "aba", "fluxo", "receber"];

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Ponto único de troca: as Tarefas 11, 12 e 13 substituem estes marcadores pelas telas reais. */
function Conteudo({ reserva, aba, fluxo, receber, aoReceber, aoMudar }: { reserva: ReservaDetalhe; aba: Aba; fluxo: Fluxo | null; receber: number | null; aoReceber: () => void; aoMudar: (m: Mudancas) => void }) {
  if (fluxo === "checkin") return <FluxoCheckin reserva={reserva} aoMudarUrl={aoMudar} />;
  if (fluxo === "checkout") return <FluxoCheckout reserva={reserva} aoMudarUrl={aoMudar} />;
  if (aba === "conta") return <AbaConta reserva={reserva} receberInicial={receber} aoReceber={aoReceber} />;
  if (aba === "hospedes") return <AbaHospedes reserva={reserva} />;
  return <AbaResumo reserva={reserva} />;
}

/** Painel da reserva: aparece em qualquer rota que tenha ?reserva=<id>. */
export function GavetaReserva() {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const id = params.get("reserva");
  // Em /relatorios/conta o ?reserva é o filtro do relatório, não o pedido de abrir o painel.
  if (!id || pathname.startsWith("/relatorios")) return null;

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

  const receberParam = params.get("receber");
  const receber = receberParam && /^\d+$/.test(receberParam) && Number(receberParam) > 0 ? Number(receberParam) : null;

  return <PainelReserva key={id} id={id} aba={aba} fluxo={fluxo} receber={receber} aoMudar={mudar} aoFechar={fechar} />;
}

type PainelProps = { id: string; aba: Aba; fluxo: Fluxo | null; receber: number | null; aoMudar: (m: Mudancas) => void; aoFechar: () => void };

function PainelReserva({ id, aba, fluxo, receber, aoMudar, aoFechar }: PainelProps) {
  const consulta = useReserva(id);
  const navegar = useNavigate();
  const r = consulta.data;
  if (!r) {
    return (
      <Gaveta aberta aoFechar={aoFechar} titulo="Reserva">
        {consulta.error ? <ErroAcao erro={consulta.error} /> : <p className="reserva-suave">Carregando…</p>}
      </Gaveta>
    );
  }
  const estado = ESTADOS_RESERVA[r.estado];
  return (
    <Gaveta aberta aoFechar={aoFechar} titulo={`#${r.codigo} · ${r.titular.nome} · ${r.quartoNumero ? `Qto ${r.quartoNumero}` : "sem quarto"}`}>
      <div className="reserva-cabecalho">
        <span>{`${formatarData(r.chegada)} → ${formatarData(r.saida)} · ${plural(r.adultos, "adulto", "adultos")} + ${plural(r.criancasNascimento.length, "criança", "crianças")}`}</span>
        <Etiqueta tom={estado.tom}>{estado.rotulo}</Etiqueta>
        <Botao variante="contorno" tamanho="pequeno" ignorarConexao onClick={() => navegar(`/relatorios/conta?reserva=${encodeURIComponent(r.id)}`)}>
          Imprimir conta
        </Botao>
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
        <Conteudo reserva={r} aba={aba} fluxo={fluxo} receber={receber} aoReceber={() => aoMudar({ receber: undefined })} aoMudar={aoMudar} />
      </div>
    </Gaveta>
  );
}
