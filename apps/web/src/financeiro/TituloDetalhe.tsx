import { useState } from "react";
import { Botao } from "../componentes/Botao";
import { Etiqueta } from "../componentes/Etiqueta";
import { JanelaSupervisor } from "../componentes/JanelaSupervisor";
import { formatarReais } from "../lib/dinheiro";
import { dataBr, Estado } from "./comuns";
import { useCancelarTitulo, useTitulo, type TituloDetalhe as Detalhe } from "./useFinanceiro";

const ACOES: Record<string, string> = {
  "fin_titulo.criar": "Título criado",
  "fin_titulo.cancelar": "Título cancelado",
  "fin_conta_pagar.baixar": "Pagamento",
  "fin_conta_pagar.estornar_pagamento": "Pagamento estornado",
  "fin_conta_receber.confirmar_pagamento": "Recebimento",
  "fin_conta_receber.parcela_saldo": "Saldo em nova parcela",
  "fin_conta_receber.cancelar_manual": "Parcela cancelada",
  "fin_lancamento.cancelar": "Parcela cancelada",
  "fin_lancamento.estornar": "Estorno",
  "fin_lancamento.criar": "Parcela lançada",
};
const SITUACAO: Record<Detalhe["parcelas"][number]["situacao"], string> = { pendente: "Pendente", parcial: "Parcial", pago: "Pago", cancelado: "Cancelado" };
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Aviso do cancelamento: o que será cancelado e o que continua por já ter pagamento. */
function aviso(t: Detalhe) {
  const pendentes = t.parcelas.filter((p) => p.situacao === "pendente");
  const ficam = t.parcelas.filter((p) => p.situacao === "pago" || p.situacao === "parcial").filter((p) => !p.saldo_de);
  const n = pendentes.length;
  return (
    <>
      <p>{`${plural(n, "parcela pendente será cancelada", "parcelas pendentes serão canceladas")} (${formatarReais(pendentes.reduce((s, p) => s + p.restante, 0))}).`}</p>
      {ficam.length > 0 && <p>{`Continuam como estão, por já terem pagamento: ${ficam.map((p) => p.rotulo).join(", ")}.`}</p>}
    </>
  );
}

/** Detalhe de um título: parcelas, pago, restante e histórico; cancela o que ainda está pendente. */
export function TituloDetalhe({ id }: { id: string }) {
  const q = useTitulo(id);
  const cancelamento = useCancelarTitulo();
  const [cancelando, setCancelando] = useState(false);
  const t = q.data;
  return (
    <Estado carregando={q.isLoading} erro={q.error}>
      {t && (
        <div className="fin__coluna">
          <p>
            <strong>{t.documento}</strong> {t.status === "cancelado" ? <Etiqueta tom="terracota">Cancelado</Etiqueta> : <Etiqueta tom="verde">Ativo</Etiqueta>}
          </p>
          <ul className="fin__resumo">
            <li>{`Total: ${formatarReais(t.valor_total)}`}</li>
            <li>{`Pago: ${formatarReais(t.pago)}`}</li>
            <li>{`Falta: ${formatarReais(t.restante)}`}</li>
          </ul>
          <div className="fin__rolagem">
            <table className="fin__tabela">
              <thead><tr><th>Parcela</th><th>Vencimento</th><th className="fin__num">Valor</th><th className="fin__num">Pago</th><th className="fin__num">Falta</th><th>Situação</th></tr></thead>
              <tbody>
                {t.parcelas.map((p) => (
                  <tr key={p.id}>
                    <td>{p.rotulo}</td><td>{dataBr(p.vencimento_dia)}</td><td className="fin__num">{formatarReais(p.valor)}</td>
                    <td className="fin__num">{formatarReais(p.pago)}</td><td className="fin__num">{formatarReais(p.restante)}</td><td>{SITUACAO[p.situacao]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Histórico</h3>
          <ul className="fin__resumo">
            {t.historico.map((h, i) => (
              <li key={i}><span>{ACOES[h.acao] ?? h.acao}{h.motivo ? <span className="fin__suave"> · {h.motivo}</span> : null}</span><span className="fin__suave">{dataBr(h.instante)}</span></li>
            ))}
          </ul>
          {t.status === "ativo" && t.restante > 0 && (
            <div className="formulario__acoes"><Botao variante="contorno" onClick={() => setCancelando(true)}>Cancelar título</Botao></div>
          )}
          <JanelaSupervisor
            aberta={cancelando}
            titulo="Cancelar título"
            aviso={aviso(t)}
            aoCancelar={() => setCancelando(false)}
            aoConfirmar={async (aut) => {
              await cancelamento.mutateAsync({ id: t.id, aut });
              setCancelando(false);
            }}
          />
        </div>
      )}
    </Estado>
  );
}
