import type { ReservaDetalhe } from "../../api/tipos";
import { Etiqueta } from "../../componentes/Etiqueta";

type Hospede = ReservaDetalhe["titular"];

const CAMPOS: Record<string, string> = { "endereco.cidade": "cidade" };

function Pessoa({ hospede, papel }: { hospede: Hospede; papel: string }) {
  const falta = hospede.pendenciasFnrh.map((c) => CAMPOS[c] ?? c);
  return (
    <li className="reserva-pessoa">
      <div className="reserva-pessoa__texto">
        <strong>{hospede.nome}</strong>
        <span className="reserva-suave">{papel}</span>
      </div>
      {falta.length === 0 ? <Etiqueta tom="verde">FNRH completa</Etiqueta> : <Etiqueta tom="terracota">{`FNRH incompleta: ${falta.join(", ")}`}</Etiqueta>}
    </li>
  );
}

export function AbaHospedes({ reserva }: { reserva: ReservaDetalhe }) {
  return (
    <ul className="reserva-pessoas">
      <Pessoa hospede={reserva.titular} papel="Titular" />
      {reserva.acompanhantes.map((a) => (
        <Pessoa key={a.id} hospede={a} papel="Acompanhante" />
      ))}
      {reserva.acompanhantes.length === 0 && <li className="reserva-suave">Nenhum acompanhante registrado.</li>}
    </ul>
  );
}
