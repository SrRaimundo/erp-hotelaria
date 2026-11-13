import { useState, type ReactNode } from "react";
import { Cartao } from "../componentes/Cartao";
import { formatarReais } from "../lib/dinheiro";
import { Barras, Estado, ROTULO_STATUS, rotulo } from "./comuns";
import { dataLocal, useCartao, useConsolidado, useContasReceber, useFluxoCaixa, useMovimento } from "./useFinanceiro";

function Painel({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <Cartao className="fin__bloco"><h2>{titulo}</h2>{children}</Cartao>;
}
const Linha = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
  <li><span>{rotulo}</span><strong>{valor}</strong></li>
);
const ROTULO_CARTAO = { aberto: "A receber", fechado: "Pronto para baixar", liquidado: "Baixado" } as const;
const SEM_LOCAL = <p className="fin__suave">Selecione um local.</p>;

export function RelatoriosTab({ localId, contaId }: { localId: string; contaId: string }) {
  const [hoje] = useState(() => dataLocal());
  const [periodo] = useState(() => ({ inicio: dataLocal(-30), fim: dataLocal() }));
  const fluxo = useFluxoCaixa(localId, hoje);
  const cons = useConsolidado(periodo);
  const receber = useContasReceber(localId);
  const mov = useMovimento(contaId, periodo);
  const cartao = useCartao(localId);
  const f = fluxo.data;
  const r = receber.data;
  const c = cartao.data;

  return (
    <div className="fin__grade">
      <Painel titulo="Fluxo de caixa (hoje)">
        <Estado carregando={fluxo.isLoading} erro={fluxo.error}>
          {f ? (<>
            <ul className="fin__resumo">
              <Linha rotulo="Saldo inicial" valor={formatarReais(f.saldo_inicial)} />
              <Linha rotulo="Entradas" valor={formatarReais(f.entradas)} />
              <Linha rotulo="Saídas" valor={formatarReais(f.saidas)} />
              <Linha rotulo="Taxas de cartão (sem movimento de caixa)" valor={formatarReais(f.taxas_cartao)} />
              <Linha rotulo="Saldo final" valor={formatarReais(f.saldo_final)} />
            </ul>
            <Barras itens={[{ rotulo: "Entradas", valor: f.entradas }, { rotulo: "Saídas", valor: f.saidas, tom: "terracota" }]} />
          </>) : SEM_LOCAL}
        </Estado>
      </Painel>

      <Painel titulo="Consolidado por local (30 dias)">
        <Estado carregando={cons.isLoading} erro={cons.error}>
          {cons.data && (<>
            <ul className="fin__resumo">
              <Linha rotulo="Recebimentos" valor={formatarReais(cons.data.total.recebimentos)} />
              <Linha rotulo="Pagamentos" valor={formatarReais(cons.data.total.pagamentos)} />
              <Linha rotulo="Taxas de cartão (sem movimento de caixa)" valor={formatarReais(cons.data.total.taxas_cartao)} />
              <Linha rotulo="Saldo final" valor={formatarReais(cons.data.total.saldo_final)} />
            </ul>
            <Barras itens={cons.data.locais.map((l) => ({ rotulo: l.nome, valor: l.recebimentos }))} />
          </>)}
        </Estado>
      </Painel>

      <Painel titulo="Contas a receber">
        <Estado carregando={receber.isLoading} erro={receber.error}>
          {r ? (<>
            <ul className="fin__resumo">
              {(["aberto", "vencido", "parcialmente_recebido"] as const).map((s) => (
                <Linha key={s} rotulo={`${rotulo(ROTULO_STATUS, s)} (${r.situacoes[s].quantidade})`} valor={formatarReais(r.situacoes[s].valor_pendente)} />
              ))}
              <Linha rotulo={`Recebido (${r.situacoes.recebido.quantidade})`} valor={formatarReais(r.situacoes.recebido.valor_recebido)} />
            </ul>
            <Barras itens={(["aberto", "vencido", "parcialmente_recebido"] as const).map((s) => ({
              rotulo: rotulo(ROTULO_STATUS, s), valor: r.situacoes[s].valor_pendente, tom: s === "vencido" ? "terracota" : "amarelo",
            }))} />
          </>) : SEM_LOCAL}
        </Estado>
      </Painel>

      <Painel titulo="Movimento da conta (30 dias)">
        {!contaId ? <p className="fin__suave">Este local ainda não tem conta.</p> : (
          <Estado carregando={mov.isLoading} erro={mov.error}>
            {mov.data && (<>
              <ul className="fin__resumo">
                <Linha rotulo="Saldo inicial" valor={formatarReais(mov.data.saldo_inicial)} />
                <Linha rotulo="Créditos" valor={formatarReais(mov.data.total_creditos)} />
                <Linha rotulo="Débitos" valor={formatarReais(mov.data.total_debitos)} />
                <Linha rotulo="Saldo final" valor={formatarReais(mov.data.saldo_final)} />
              </ul>
              <Barras itens={[{ rotulo: "Créditos", valor: mov.data.total_creditos }, { rotulo: "Débitos", valor: mov.data.total_debitos, tom: "terracota" }]} />
            </>)}
          </Estado>
        )}
      </Painel>

      <Painel titulo="Cartão (líquido)">
        <Estado carregando={cartao.isLoading} erro={cartao.error}>
          {c ? (<>
            <ul className="fin__resumo">
              {(["aberto", "fechado", "liquidado"] as const).map((s) => (
                <Linha key={s} rotulo={`${ROTULO_CARTAO[s]} (${c[s].quantidade})`} valor={formatarReais(c[s].valor)} />
              ))}
            </ul>
            <Barras itens={(["aberto", "fechado", "liquidado"] as const).map((s) => ({
              rotulo: ROTULO_CARTAO[s], valor: c[s].valor, tom: s === "liquidado" ? "verde" : "amarelo",
            }))} />
          </>) : SEM_LOCAL}
        </Estado>
      </Painel>
    </div>
  );
}
