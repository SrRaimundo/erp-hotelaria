import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import type { Canal, ConfigPousada, Cotacao } from "../../api/tipos";
import { ErroAcao } from "../../componentes/ErroAcao";
import { formatarData } from "../../lib/datas";
import { formatarReais } from "../../lib/dinheiro";
import { useAtrasado } from "../../lib/useAtrasado";

export type PedidoCotacao = {
  categoriaId: string;
  chegada: string;
  saida: string;
  hospedes: { adultos: number; criancasNascimento: string[] };
  canal: string;
};

type Props = {
  /** `null` enquanto o formulário não está em condições de cotar. */
  pedido: PedidoCotacao | null;
  canal: Canal | undefined;
  config: ConfigPousada | undefined;
  /** Desconto em % já validado (0 = sem desconto). */
  desconto: number;
  titulo?: string;
};

const comDesconto = (v: number, d: number) => Math.round(v * (1 - d / 100));

/** Sinal estimado no cliente (o simulador não o devolve); o servidor decide ao reservar. */
function calcularSinal(noites: number[], total: number, regra: ConfigPousada["sinal"]): number {
  if (regra.tipo === "primeira_diaria") return noites[0] ?? 0;
  return Math.round((total * regra.percentual) / 100);
}

function formatarPrazo(d: Date): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

export function QuadroCotacao({ pedido, canal, config, desconto, titulo = "Cotação" }: Props) {
  const atual = pedido ? JSON.stringify(pedido) : "";
  const chave = useAtrasado(atual, 400);
  const consulta = useQuery({
    queryKey: ["cotacao", chave],
    queryFn: () => chamarApi<Cotacao>("POST", "/api/tarifas/simular", JSON.parse(chave)),
    enabled: chave !== "",
    refetchInterval: false,
    placeholderData: keepPreviousData,
  });

  if (!pedido) {
    return (
      <section className="nova-cotacao" aria-label={titulo}>
        <h3>{titulo}</h3>
        <p className="reserva-suave">Preencha as datas e a acomodação para ver o valor.</p>
      </section>
    );
  }
  const cot = consulta.data;
  const noites = cot?.noites.map((n) => ({ ...n, final: comDesconto(n.valor, desconto) }));
  const total = noites?.reduce((s, n) => s + n.final, 0) ?? 0;
  const exigeSinal = !!canal?.exigeSinal && !!config?.sinal.exigir;

  return (
    <section className={`nova-cotacao${consulta.isPlaceholderData ? " nova-cotacao--atualizando" : ""}`} aria-label={titulo} aria-busy={consulta.isPlaceholderData}>
      <h3>{titulo}</h3>
      {!cot && !consulta.error && <p className="reserva-suave">Calculando…</p>}
      {consulta.error && (
        <>
          <p>
            <strong>Não foi possível calcular a cotação.</strong>
          </p>
          <ErroAcao erro={consulta.error} />
        </>
      )}
      {cot && noites && (
        <>
          {cot.violacoes.length > 0 && (
            <div className="conta-aviso" role="status">
              <p>
                <strong>Atenção: restrição de venda</strong>
              </p>
              {cot.violacoes.map((v, i) => (
                <p key={`${v.codigo}-${v.data}-${i}`}>{v.mensagem}</p>
              ))}
            </div>
          )}
          <table className="reserva-diarias">
            <thead>
              <tr>
                <th>Noite</th>
                <th>Valor</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {noites.map((n) => (
                <tr key={n.data}>
                  <td>{formatarData(n.data)}</td>
                  <td>{formatarReais(n.final)}</td>
                  <td>
                    {n.passos.length > 0 && (
                      <details>
                        <summary>Ver cálculo</summary>
                        <ul className="nova-passos">
                          {n.passos.map((p, i) => (
                            <li key={i}>
                              {p.rotulo}: {formatarReais(p.valor)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {desconto > 0 && (
                <tr>
                  <th scope="row">Desconto −{String(desconto).replace(".", ",")}%</th>
                  <td colSpan={2}>{formatarReais(total - cot.total)}</td>
                </tr>
              )}
              <tr>
                <th scope="row">Total</th>
                <td colSpan={2}>{formatarReais(total)}</td>
              </tr>
            </tfoot>
          </table>
          {exigeSinal && config && (
            <p className="nova-sinal">
              Sinal de {formatarReais(calcularSinal(noites.map((n) => n.final), total, config.sinal))} até{" "}
              {formatarPrazo(new Date(Date.now() + config.sinal.prazoHoras * 3_600_000))}
            </p>
          )}
        </>
      )}
    </section>
  );
}
