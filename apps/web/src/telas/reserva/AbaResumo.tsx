import { useState } from "react";
import type { ReservaDetalhe } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { formatarData } from "../../lib/datas";
import { formatarReais } from "../../lib/dinheiro";

const dois = (n: number) => String(n).padStart(2, "0");

/** ISO UTC -> "DD/MM HH:MM" no fuso do navegador. */
function dataHora(iso: string): string {
  const d = new Date(iso);
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

export function AbaResumo({ reserva }: { reserva: ReservaDetalhe }) {
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(new Set());
  const alternar = (data: string) =>
    setAbertas((atual) => {
      const novo = new Set(atual);
      if (!novo.delete(data)) novo.add(data);
      return novo;
    });

  const sinal =
    reserva.estado === "pre_reserva"
      ? [formatarReais(reserva.valorSinal), `pago ${formatarReais(reserva.pago)}`, ...(reserva.prazoSinal ? [`prazo ${dataHora(reserva.prazoSinal)}`] : [])].join(" · ")
      : null;

  return (
    <div className="reserva-resumo">
      <dl className="reserva-dados">
        <dt>Canal</dt>
        <dd>{reserva.canal}</dd>
        {reserva.observacoes && (
          <>
            <dt>Observações</dt>
            <dd>{reserva.observacoes}</dd>
          </>
        )}
        {sinal && (
          <>
            <dt>Sinal</dt>
            <dd>{sinal}</dd>
          </>
        )}
      </dl>
      <h3>Diárias</h3>
      <table className="reserva-diarias">
        <thead>
          <tr>
            <th scope="col">Noite</th>
            <th scope="col">Valor</th>
            <th scope="col">
              <span className="sr-only">Cálculo</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {reserva.noites.map((n) => {
            const aberta = abertas.has(n.data);
            return [
              <tr key={n.data}>
                <td>{formatarData(n.data)}</td>
                <td>{formatarReais(n.valor)}</td>
                <td>
                  <Botao variante="contorno" tamanho="pequeno" ignorarConexao aria-expanded={aberta} onClick={() => alternar(n.data)}>
                    Ver cálculo
                  </Botao>
                </td>
              </tr>,
              aberta && (
                <tr key={`${n.data}-passos`} className="reserva-diarias__passos">
                  <td colSpan={3}>{n.passos.map((p) => `${p.rotulo} ${formatarReais(p.valor)}`).join(" → ")}</td>
                </tr>
              ),
            ];
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td colSpan={2}>{formatarReais(reserva.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
