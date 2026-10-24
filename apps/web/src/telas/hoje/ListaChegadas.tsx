import type { Painel } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { Etiqueta } from "../../componentes/Etiqueta";
import { LinhaReserva } from "./LinhaReserva";
import { SecaoHoje } from "./SecaoHoje";

type Chegada = Painel["chegadas"][number];
type Props = { chegadas: Chegada[]; horaCheckin?: string; aoAbrir: (reservaId: string) => void };

function etiquetaDe(c: Chegada): { texto: string; tom: "verde" | "terracota" | "amarelo" } {
  if (c.estado === "hospedada") return { texto: "hospedada", tom: "verde" };
  if (c.pendenciasFnrh) return { texto: "FNRH pendente", tom: "amarelo" };
  if (c.quartoNumero === null) return { texto: "sem quarto", tom: "amarelo" };
  if (c.sinalPendente > 0) return { texto: "aguardando sinal", tom: "terracota" };
  return { texto: "sinal pago", tom: "verde" };
}

function plural(n: number, singular: string, pluralTxt: string): string {
  return `${n} ${n === 1 ? singular : pluralTxt}`;
}

function detalheDe(c: Chegada): string {
  const hospedes = [plural(c.adultos, "adulto", "adultos"), c.criancas > 0 ? plural(c.criancas, "criança", "crianças") : null].filter(Boolean).join(" + ");
  return `${plural(c.noites, "noite", "noites")} · ${hospedes} · ${c.canal}`;
}

export function ListaChegadas({ chegadas, horaCheckin, aoAbrir }: Props) {
  return (
    <SecaoHoje titulo="Chegadas de hoje" subtitulo={horaCheckin ? `check-in a partir das ${horaCheckin}` : undefined}>
      {chegadas.length === 0 ? (
        <p className="hoje-suave">Nenhuma chegada hoje.</p>
      ) : (
        <ul className="hoje-lista">
          {chegadas.map((c) => {
            const e = etiquetaDe(c);
            return (
              <LinhaReserva
                key={c.reservaId}
                quarto={c.quartoNumero}
                titulo={c.titular}
                detalhe={detalheDe(c)}
                etiqueta={<Etiqueta tom={e.tom}>{e.texto}</Etiqueta>}
                acao={
                  c.estado === "hospedada" ? undefined : (
                    <Botao tamanho="pequeno" onClick={() => aoAbrir(c.reservaId)}>
                      {c.quartoNumero === null ? "Escolher quarto" : "Check-in"}
                    </Botao>
                  )
                }
              />
            );
          })}
        </ul>
      )}
    </SecaoHoje>
  );
}
