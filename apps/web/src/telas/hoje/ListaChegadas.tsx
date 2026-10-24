import type { Painel } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { Etiqueta } from "../../componentes/Etiqueta";
import { LinhaReserva } from "./LinhaReserva";
import { SecaoHoje } from "./SecaoHoje";

type Chegada = Painel["chegadas"][number];
type Props = {
  chegadas: Chegada[];
  horaCheckin?: string;
  /** Recebe a consulta da URL (ex.: `reserva=r1&fluxo=checkin`). */
  aoAbrir: (consulta: string) => void;
};

type Marca = { texto: string; tom: "verde" | "terracota" | "amarelo" };

function etiquetasDe(c: Chegada): Marca[] {
  if (c.estado === "hospedada") return [{ texto: "hospedada", tom: "verde" }];
  const sinal: Marca = { texto: "aguardando sinal", tom: "terracota" };
  // FNRH e sinal são pendências independentes: quando as duas existem, mostra as duas.
  if (c.pendenciasFnrh) return [{ texto: "FNRH pendente", tom: "amarelo" }, ...(c.sinalPendente > 0 ? [sinal] : [])];
  if (c.quartoNumero === null) return [{ texto: "sem quarto", tom: "amarelo" }];
  if (c.sinalPendente > 0) return [sinal];
  return [{ texto: "sinal pago", tom: "verde" }];
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
            const reserva = encodeURIComponent(c.reservaId);
            return (
              <LinhaReserva
                key={c.reservaId}
                quarto={c.quartoNumero}
                titulo={c.titular}
                detalhe={detalheDe(c)}
                etiqueta={
                  <>
                    {etiquetasDe(c).map((e) => (
                      <Etiqueta key={e.texto} tom={e.tom}>{e.texto}</Etiqueta>
                    ))}
                  </>
                }
                acao={
                  c.estado === "hospedada" ? undefined : c.estado === "pre_reserva" ? (
                    // Pré-reserva ainda não pode fazer check-in: o próximo passo é receber o sinal.
                    <Botao tamanho="pequeno" onClick={() => aoAbrir(`reserva=${reserva}&aba=conta&receber=${c.sinalPendente}`)}>
                      Registrar sinal
                    </Botao>
                  ) : (
                    <Botao tamanho="pequeno" onClick={() => aoAbrir(`reserva=${reserva}&fluxo=checkin`)}>
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
