import type { Painel } from "../../api/tipos";
import { SecaoHoje } from "./SecaoHoje";

/** Quartos hospedados agora por canal, na ordem do servidor (maior primeiro); sem hospedados, o bloco some. */
export function BlocoCanais({ canais }: { canais: Painel["ocupadosPorCanal"] }) {
  const total = canais.reduce((t, c) => t + c.quartos, 0);
  if (total === 0) return null;
  return (
    <SecaoHoje titulo="Ocupados por canal" subtitulo={`${total} ${total === 1 ? "ocupado" : "ocupados"}`}>
      <ul className="hoje-lista">
        {canais.map((c) => (
          <li key={c.canal} className="hoje-canal">
            <span className="hoje-canal__nome">{c.canal}</span>
            <span className="hoje-canal__barra" aria-hidden="true">
              <span className="hoje-canal__preenchimento" style={{ width: `${(c.quartos / total) * 100}%` }} />
            </span>
            <strong className="hoje-canal__qtd">{c.quartos}</strong>
          </li>
        ))}
      </ul>
    </SecaoHoje>
  );
}
