import type { Painel } from "../../api/tipos";
import { SecaoHoje } from "./SecaoHoje";

function rotulo(q: Painel["governanca"][number]): string {
  if (q.situacao === "sujo") return `${q.numero} sujo`;
  const nome = q.situacao === "em_manutencao" ? "manutenção" : "bloqueado";
  return `${q.numero} ${nome}${q.motivo ? ` · ${q.motivo}` : ""}`;
}

export function BlocoGovernanca({ governanca, ocupadosSemArrumacao }: { governanca: Painel["governanca"]; ocupadosSemArrumacao: number }) {
  return (
    <SecaoHoje titulo="Governança agora">
      {governanca.length === 0 ? (
        <p className="hoje-suave">Todos os quartos estão limpos.</p>
      ) : (
        <ul className="hoje-pilulas">
          {governanca.map((q) => (
            <li key={q.quartoId} className={`hoje-pilula hoje-pilula--${q.situacao === "sujo" ? "sujo" : "neutro"}`}>
              {rotulo(q)}
            </li>
          ))}
        </ul>
      )}
      {ocupadosSemArrumacao > 0 && (
        <p className="hoje-suave">{`${ocupadosSemArrumacao} ${ocupadosSemArrumacao === 1 ? "ocupado" : "ocupados"} sem arrumação hoje`}</p>
      )}
    </SecaoHoje>
  );
}
