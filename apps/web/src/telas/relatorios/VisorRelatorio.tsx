import type { Relatorio, Secao } from "../../api/tipos";
import { tabelaDaSecao } from "./formatar";

export const MENSAGEM_VAZIO = "Nada para mostrar neste filtro";

function TabelaSecao({ secao }: { secao: Secao }) {
  const t = tabelaDaSecao(secao);
  const classe = (i: number) => [t.alinhamentos[i] === "direita" ? "rel-num" : "", t.emBranco[i] ? "rel-em-branco" : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="rel-rolagem">
      <table className="rel-tabela">
        <thead>
          <tr>
            {t.titulos.map((titulo, i) => (
              <th key={i} className={classe(i)}>
                {titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.linhas.map((linha, r) => (
            <tr key={r}>
              {linha.map((celula, i) => (
                <td key={i} className={classe(i)}>
                  {celula}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {t.totais && (
          <tfoot>
            <tr>
              {t.totais.map((celula, i) => (
                <th key={i} className={classe(i)}>
                  {celula}
                </th>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Desenha qualquer `Relatorio` do servidor: resumo, e uma tabela por seção (ou a mensagem de vazio). */
export function VisorRelatorio({ relatorio }: { relatorio: Relatorio }) {
  return (
    <div className="rel-visor">
      {relatorio.resumo.length > 0 && (
        <dl className="rel-resumo">
          {relatorio.resumo.map((r) => (
            <div key={r.rotulo} className="rel-resumo__item">
              <dt>{r.rotulo}</dt>
              <dd>{r.valor}</dd>
            </div>
          ))}
        </dl>
      )}
      {relatorio.secoes.map((s, i) => (
        <section key={i} className="rel-secao">
          {s.titulo && <h2>{s.titulo}</h2>}
          {s.linhas.length === 0 ? <p className="rel-vazio">{MENSAGEM_VAZIO}</p> : <TabelaSecao secao={s} />}
        </section>
      ))}
    </div>
  );
}
