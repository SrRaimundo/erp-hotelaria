import { useState } from "react";
import { Botao } from "../componentes/Botao";
import { Cartao } from "../componentes/Cartao";
import { ErroAcao } from "../componentes/ErroAcao";
import { Etiqueta } from "../componentes/Etiqueta";
import { Gaveta } from "../componentes/Gaveta";
import { CampoPercentual } from "../telas/tarifas/CampoPercentual";
import { CampoTexto, Estado, ROTULO_FORMA, rotulo, Selecao } from "./comuns";
import { useCondicoesCartao, useSalvarCondicao, type CondicaoCartao, type TipoCartao } from "./useFinanceiro";

const TIPOS = (["credito", "debito", "voucher"] as const).map((valor) => ({ valor, rotulo: rotulo(ROTULO_FORMA, valor) }));
const pct = (n: number) => `${String(n).replace(".", ",")}%`;

function PainelCondicao({ localId, item, aoFechar }: { localId: string; item: CondicaoCartao | null; aoFechar: () => void }) {
  const [adquirente, setAdquirente] = useState(item?.adquirente ?? "");
  const [bandeira, setBandeira] = useState(item?.bandeira ?? "");
  const [tipo, setTipo] = useState<TipoCartao>(item?.tipo ?? "credito");
  const [prazo, setPrazo] = useState(item ? String(item.prazo_dias) : "");
  const [taxa, setTaxa] = useState<number | null>(item?.taxa_percentual ?? null);
  const salvar = useSalvarCondicao();
  const alterarAtivo = useSalvarCondicao();
  const prazoNumero = Number(prazo);
  const prazoValido = prazo.trim() !== "" && Number.isInteger(prazoNumero) && prazoNumero >= 0 && prazoNumero <= 3650;
  const motivo = !adquirente.trim() ? "Informe o adquirente." : !bandeira.trim() ? "Informe a bandeira." : !prazoValido ? "Informe o prazo em dias (D+N), de 0 a 3650." : taxa === null || taxa >= 100 ? "Informe a taxa, de 0% a 99,99%." : "";
  return (
    <form className="formulario" onSubmit={(e) => {
      e.preventDefault();
      if (motivo || taxa === null) return;
      salvar.mutate({ id: item?.id, ...(item ? {} : { local_id: localId }), adquirente: adquirente.trim(), bandeira: bandeira.trim(), tipo, prazo_dias: prazoNumero, taxa_percentual: taxa }, { onSuccess: aoFechar });
    }}>
      <CampoTexto rotulo="Adquirente" valor={adquirente} aoMudar={setAdquirente} />
      <CampoTexto rotulo="Bandeira" valor={bandeira} aoMudar={setBandeira} />
      <Selecao rotulo="Tipo" valor={tipo} aoMudar={(v) => setTipo(v as TipoCartao)} opcoes={TIPOS} />
      <CampoTexto rotulo="Prazo para receber (dias, D+N)" tipo="number" valor={prazo} aoMudar={setPrazo} />
      <CampoPercentual rotulo="Taxa (%)" valor={taxa} aoMudar={setTaxa} />
      <p className="fin__suave">Mudar a condição vale daqui para frente: movimentos já registrados guardam o prazo e a taxa da época.</p>
      {motivo && <p className="fin__suave">{motivo}</p>}
      <ErroAcao erro={salvar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={!!motivo || salvar.isPending}>Salvar</Botao>
      </div>
      {item && (
        <div className="cq__ativo">
          <ErroAcao erro={alterarAtivo.error} />
          <Botao variante="contorno" disabled={alterarAtivo.isPending} onClick={() => alterarAtivo.mutate({ id: item.id, ativo: !item.ativo }, { onSuccess: aoFechar })}>
            {item.ativo ? "Desativar" : "Reativar"}
          </Botao>
        </div>
      )}
    </form>
  );
}

/** Cadastro Cobrança: condições do cartão (adquirente, bandeira, tipo, prazo D+N e taxa) usadas em Contas a Receber. */
export function CobrancaTab({ localId }: { localId: string }) {
  const [inativos, setInativos] = useState(false);
  const [painel, setPainel] = useState<{ item: CondicaoCartao | null } | null>(null);
  const q = useCondicoesCartao(localId);
  const lista = (q.data ?? []).filter((c) => inativos || c.ativo);
  return (
    <Cartao className="fin__bloco">
      <div className="fin__filtros">
        <label className="lista-cadastro__filtro">
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} />
          Mostrar desativadas
        </label>
        <div className="fin__acao-topo"><Botao onClick={() => setPainel({ item: null })}>+ Nova condição</Botao></div>
      </div>
      <Estado carregando={q.isLoading} erro={q.error}>
        {lista.length === 0 ? (
          <p className="fin__suave">Nenhuma condição cadastrada. Sem ela, os pagamentos em cartão entram para revisão em vez de usar prazo e taxa.</p>
        ) : (
          <div className="fin__rolagem">
            <table className="fin__tabela">
              <thead><tr><th>Adquirente</th><th>Bandeira</th><th>Tipo</th><th>Prazo</th><th className="fin__num">Taxa</th><th>Situação</th><th><span className="fin__oculto">Ações</span></th></tr></thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id}>
                    <td>{c.adquirente}</td><td>{c.bandeira}</td><td>{rotulo(ROTULO_FORMA, c.tipo)}</td><td>D+{c.prazo_dias}</td><td className="fin__num">{pct(c.taxa_percentual)}</td>
                    <td><Etiqueta tom={c.ativo ? "verde" : "neutro"}>{c.ativo ? "Ativa" : "Desativada"}</Etiqueta></td>
                    <td className="fin__acoes"><Botao variante="contorno" tamanho="pequeno" onClick={() => setPainel({ item: c })}>Editar</Botao></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Estado>
      <Gaveta aberta={painel !== null} aoFechar={() => setPainel(null)} titulo={painel?.item ? "Editar condição de cobrança" : "Nova condição de cobrança"}>
        {painel && <PainelCondicao localId={localId} item={painel.item} aoFechar={() => setPainel(null)} />}
      </Gaveta>
    </Cartao>
  );
}
