import { Link } from "react-router";
import { useTurnosRelatorio } from "../../api/consultas";
import { formatarInstante } from "./formatar";
import type { ItemCatalogo } from "./catalogo";

type Props = {
  item: ItemCatalogo;
  /** Valores atuais: data, inicio, fim, turno (a busca vem à parte, pois é digitada). */
  valores: Record<string, string>;
  aoMudar: (mudancas: Record<string, string>) => void;
  busca: string;
  aoMudarBusca: (texto: string) => void;
};

function FiltroPeriodo({ valores, aoMudar }: Pick<Props, "valores" | "aoMudar">) {
  const inicio = valores.inicio ?? "";
  const fim = valores.fim ?? "";
  const turnos = useTurnosRelatorio(inicio, fim, true);
  return (
    <>
      <label className="campo">
        De
        <input type="date" value={inicio} onChange={(e) => aoMudar({ inicio: e.target.value, turno: "" })} />
      </label>
      <label className="campo">
        Até
        <input type="date" value={fim} onChange={(e) => aoMudar({ fim: e.target.value, turno: "" })} />
      </label>
      <label className="campo">
        Turno
        <select value={valores.turno ?? ""} onChange={(e) => aoMudar({ turno: e.target.value })}>
          <option value="">Todos os turnos (resumo)</option>
          {(turnos.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>{`${t.operador} · ${formatarInstante(t.abertoEm)}`}</option>
          ))}
        </select>
      </label>
      <span className="rel-dica">Datas em branco valem para hoje.</span>
    </>
  );
}

export function FiltrosRelatorio({ item, valores, aoMudar, busca, aoMudarBusca }: Props) {
  if (item.filtros.length === 0) return null;
  return (
    <div className="rel-filtros rel-nao-imprimir" role="group" aria-label="Filtros">
      {item.filtros.includes("data") && (
        <label className="campo">
          Data
          <input type="date" value={valores.data ?? ""} onChange={(e) => aoMudar({ data: e.target.value })} />
        </label>
      )}
      {item.filtros.includes("busca") && (
        <label className="campo">
          Nome ou documento
          <input type="search" value={busca} onChange={(e) => aoMudarBusca(e.target.value)} />
        </label>
      )}
      {item.filtros.includes("periodo") && <FiltroPeriodo valores={valores} aoMudar={aoMudar} />}
      {item.filtros.includes("reserva") && valores.reserva && (
        <span className="rel-dica">
          Conta pedida pela tela da reserva. <Link to="/reservas">Escolher outra reserva</Link>
        </span>
      )}
    </div>
  );
}
