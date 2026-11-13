import { useState } from "react";
import { Botao } from "../componentes/Botao";
import { Cartao } from "../componentes/Cartao";
import { ErroAcao } from "../componentes/ErroAcao";
import { Etiqueta } from "../componentes/Etiqueta";
import { JanelaSupervisor } from "../componentes/JanelaSupervisor";
import { formatarReais } from "../lib/dinheiro";
import { Estado } from "./comuns";
import { useFila, useIgnorarEvento, useTentarNovamente } from "./useFinanceiro";

const NOME_EVENTO: Record<string, string> = {
  "hospedagem.PagamentoRegistrado": "Pagamento registrado na hospedagem",
  "hospedagem.PagamentoEstornado": "Pagamento estornado na hospedagem",
  "hospedagem.ValorAReceberCriado": "Checkout faturado na hospedagem",
};
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR");

/** Fila do Financeiro (administração): evento que não passa, com Tentar de novo e Ignorar evento. */
export function FilaTab() {
  const q = useFila();
  const tentar = useTentarNovamente();
  const ignorar = useIgnorarEvento();
  const [ignorando, setIgnorando] = useState(false);
  const f = q.data;
  return (
    <div className="fin__coluna">
      <Cartao className="fin__bloco">
        <Estado carregando={q.isLoading} erro={q.error}>
          {f && (f.bloqueado ? (
            <>
              <p role="alert" className="erro-acao">A fila está parada neste evento. Os eventos seguintes ({f.pendentes - 1}) esperam.</p>
              <ul className="fin__resumo" aria-label="Evento bloqueado">
                <li><span>Evento</span><strong>{NOME_EVENTO[f.bloqueado.tipo] ?? f.bloqueado.tipo} (nº {f.bloqueado.seq})</strong></li>
                {f.bloqueado.valor !== null && <li><span>Valor</span><strong>{formatarReais(f.bloqueado.valor)}</strong></li>}
                <li><span>Tentativas</span><strong>{f.bloqueado.falhas}</strong></li>
                <li><span>Desde</span><strong>{quando(f.bloqueado.criado_em)}</strong></li>
              </ul>
              <p><strong>Erro:</strong> {f.bloqueado.erro}</p>
              <ErroAcao erro={tentar.error} />
              <div className="fin__acoes">
                <Botao disabled={tentar.isPending} onClick={() => tentar.mutate()}>Tentar de novo</Botao>
                <Botao variante="contorno" onClick={() => setIgnorando(true)}>Ignorar evento</Botao>
              </div>
              <p className="fin__suave">Ignorar deixa o evento fora do Financeiro para sempre (fica registrado abaixo e em um alerta). Use só depois de conferir o valor e lançá-lo à mão, se precisar.</p>
            </>
          ) : (
            <>
              <p><Etiqueta tom="verde">Fila em dia</Etiqueta> {f.pendentes > 0 ? `${f.pendentes} evento(s) na espera.` : "Nada pendente."}</p>
              <ErroAcao erro={tentar.error} />
              <div><Botao variante="contorno" disabled={tentar.isPending} onClick={() => tentar.mutate()}>Processar agora</Botao></div>
            </>
          ))}
        </Estado>
      </Cartao>
      <Cartao className="fin__bloco">
        <h2>Eventos ignorados</h2>
        {f && f.ignorados.length === 0 ? <p className="fin__suave">Nenhum evento foi ignorado.</p> : (
          <div className="fin__rolagem">
            <table className="fin__tabela">
              <thead><tr><th>Nº</th><th>Evento</th><th className="fin__num">Valor</th><th>Motivo</th><th>Quando</th></tr></thead>
              <tbody>
                {f?.ignorados.map((i) => (
                  <tr key={i.seq}>
                    <td>{i.seq}</td><td>{NOME_EVENTO[i.tipo] ?? i.tipo}</td>
                    <td className="fin__num">{i.valor !== null ? formatarReais(i.valor) : "—"}</td>
                    <td>{i.motivo}</td><td>{quando(i.criado_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
      <JanelaSupervisor
        aberta={ignorando}
        titulo="Ignorar evento"
        aoCancelar={() => setIgnorando(false)}
        aoConfirmar={async (aut) => {
          if (!f?.bloqueado) return;
          await ignorar.mutateAsync({ seq: f.bloqueado.seq, aut });
          setIgnorando(false);
        }}
      />
    </div>
  );
}
