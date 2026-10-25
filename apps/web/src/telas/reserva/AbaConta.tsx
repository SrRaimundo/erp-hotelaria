import { useState } from "react";
import { chamarApi } from "../../api/cliente";
import { useAcao, useConta, useFormasPagamento } from "../../api/consultas";
import type { LinhaExtrato, ReservaDetalhe } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { JanelaSupervisor, type Autorizacao } from "../../componentes/JanelaSupervisor";
import { formatarData } from "../../lib/datas";
import { formatarReais } from "../../lib/dinheiro";
import { ROTULO_SETOR } from "../../lib/setores";
import { FormFrigobar } from "./FormFrigobar";
import { FormLancarExtra } from "./FormLancarExtra";
import { FormReceber } from "./FormReceber";

type Props = {
  reserva: ReservaDetalhe;
  /** Valor em centavos vindo de "Registrar sinal" (`&receber=`). */
  receberInicial: number | null;
  /** Chamado depois de um pagamento: tira `receber` da URL. */
  aoReceber: () => void;
};

const ORIGENS: Record<string, string> = { hospedagem: "Hospedagem", caixa: "Caixa" };
const rotuloOrigem = (o: string) => ORIGENS[o] ?? (o ? o.charAt(0).toUpperCase() + o.slice(1) : o);

function situacao(saldo: number): { texto: string; classe: string } {
  if (saldo > 0) return { texto: "a receber", classe: "conta-saldo--receber" };
  if (saldo < 0) return { texto: "crédito do hóspede", classe: "conta-saldo--credito" };
  return { texto: "quitado", classe: "" };
}

export function AbaConta({ reserva, receberInicial, aoReceber }: Props) {
  const conta = useConta(reserva.contaId);
  const formas = useFormasPagamento();
  const [alvo, setAlvo] = useState<LinhaExtrato | null>(null);
  const [frigobar, setFrigobar] = useState(false);
  const estornar = useAcao((c: Autorizacao & { linha: LinhaExtrato }) =>
    chamarApi("POST", `/api/${c.linha.natureza === "debito" ? "lancamentos" : "pagamentos"}/${encodeURIComponent(c.linha.id)}/estornar`, {
      motivo: c.motivo,
      supervisor: c.supervisor,
    }),
  );

  if (!conta.data) return conta.error ? <ErroAcao erro={conta.error} /> : <p className="reserva-suave">Carregando…</p>;
  const { saldo, extrato } = conta.data;
  const estornados = new Set(extrato.flatMap((l) => (l.estornaId ? [l.estornaId] : [])));
  const nomeForma = (codigo: string) => formas.data?.find((f) => f.codigo === codigo)?.nome ?? codigo;

  /** O servidor descreve pagamentos como "Pagamento (pix)"; aqui vira "Pagamento PIX". */
  function descricao(l: LinhaExtrato): string {
    if (l.natureza === "debito") return l.descricao;
    const m = /^Pagamento \((.+)\)$/.exec(l.descricao);
    const base = m ? `Pagamento ${nomeForma(m[1]!)}` : l.descricao;
    return l.tipo === "estorno" ? `Estorno: ${base}` : base;
  }

  const sit = situacao(saldo.saldo);
  const titulo = alvo?.natureza === "credito" ? "Estornar pagamento" : "Estornar lançamento";

  return (
    <div className="conta">
      <table className="reserva-diarias conta-extrato">
        <caption className="sr-only">Extrato da conta</caption>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Descrição</th>
            <th scope="col">Origem</th>
            <th scope="col">Setor</th>
            <th scope="col" className="conta-valor">Valor</th>
            <th scope="col"><span className="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody>
          {extrato.length === 0 && (
            <tr>
              <td colSpan={6} className="reserva-suave">Nenhum lançamento ainda.</td>
            </tr>
          )}
          {extrato.map((l) => {
            const ehEstorno = l.tipo === "estorno";
            const texto = descricao(l);
            return (
              <tr key={l.id} className={ehEstorno ? "conta-estorno" : undefined}>
                <td>{formatarData(l.data)}</td>
                <td>{texto}</td>
                <td>{rotuloOrigem(l.origem)}</td>
                <td>{l.setor ? ROTULO_SETOR[l.setor] : ""}</td>
                <td className={l.natureza === "credito" ? "conta-valor conta-valor--credito" : "conta-valor"}>
                  {formatarReais(l.valor)}
                  {l.natureza === "credito" && !ehEstorno && <small> crédito</small>}
                </td>
                <td>
                  {!ehEstorno && !estornados.has(l.id) && (
                    <Botao variante="contorno" tamanho="pequeno" aria-label={`Estornar ${texto}`} onClick={() => setAlvo(l)}>
                      Estornar
                    </Botao>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={4}>Débitos</th>
            <td className="conta-valor">{formatarReais(saldo.debitos)}</td>
            <td />
          </tr>
          <tr>
            <th scope="row" colSpan={4}>Créditos</th>
            <td className="conta-valor">{formatarReais(saldo.creditos)}</td>
            <td />
          </tr>
          <tr>
            <th scope="row" colSpan={4}>Saldo</th>
            <td className={`conta-valor ${sit.classe}`}>{formatarReais(saldo.saldo)}</td>
            <td className={sit.classe}>{sit.texto}</td>
          </tr>
        </tfoot>
      </table>

      <FormReceber key={receberInicial ?? "livre"} aoReceber={aoReceber} contaId={reserva.contaId} reservaId={reserva.id} receberInicial={receberInicial} />
      {reserva.estado === "hospedada" && (
        <div className="formulario__acoes">
          <Botao variante="contorno" onClick={() => setFrigobar(true)}>Frigobar</Botao>
        </div>
      )}
      <FormLancarExtra contaId={reserva.contaId} />
      {frigobar && <FormFrigobar contaId={reserva.contaId} reservaId={reserva.id} aoFechar={() => setFrigobar(false)} />}

      <JanelaSupervisor
        aberta={alvo !== null}
        titulo={titulo}
        aoCancelar={() => setAlvo(null)}
        aoConfirmar={async (a) => {
          await estornar.mutateAsync({ ...a, linha: alvo! });
          setAlvo(null);
        }}
      />
    </div>
  );
}
