import type { Painel } from "../../api/tipos";
import { Etiqueta } from "../../componentes/Etiqueta";
import { formatarData, nomeDiaSemana } from "../../lib/datas";
import { SecaoHoje } from "./SecaoHoje";

const plural = (n: number, singular: string, mais: string) => `${n} ${n === 1 ? singular : mais}`;

export function ProximosDias({ dias }: { dias: Painel["proximosDias"] }) {
  return (
    <SecaoHoje titulo="Próximos dias">
      <ul className="hoje-lista">
        {dias.map((d, i) => (
          <li key={d.dia} className="hoje-linha">
            <div className="hoje-linha__texto">
              <strong>{`${i === 0 ? "Amanhã" : nomeDiaSemana(d.dia)} (${formatarData(d.dia)})`}</strong>
              <span className="hoje-suave">{`${plural(d.chegadas, "chegada", "chegadas")} · ${plural(d.saidas, "saída", "saídas")} · ocupação ${d.ocupacaoPct}%`}</span>
            </div>
            {d.ocupacaoPct >= 100 && <Etiqueta tom="terracota">lotado</Etiqueta>}
          </li>
        ))}
      </ul>
    </SecaoHoje>
  );
}
