import { useState } from "react";
import { chamarApi } from "../../api/cliente";
import { useAcao, useProdutos } from "../../api/consultas";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Janela } from "../../componentes/Janela";
import { formatarReais } from "../../lib/dinheiro";

type Props = { contaId: string; reservaId: string; aoFechar: () => void };
type Corpo = { reservaId: string; itens: { produtoId: string; quantidade: number }[] };

const RAPIDAS = [0, 1, 2, 3];
const MAXIMO = 999;

/** Formulário rápido de frigobar: quantidade consumida de cada produto do setor e um único lançamento. */
export function FormFrigobar({ contaId, reservaId, aoFechar }: Props) {
  const produtos = useProdutos("frigobar");
  const lancar = useAcao((c: Corpo) => chamarApi("POST", `/api/contas/${encodeURIComponent(contaId)}/frigobar`, c));
  const [qtd, setQtd] = useState<Record<string, number>>({});
  const [outro, setOutro] = useState<Record<string, boolean>>({});
  const [erro, setErro] = useState<Error | null>(null);

  const lista = produtos.data ?? [];
  const total = lista.reduce((s, p) => s + (qtd[p.id] ?? 0) * p.precoCentavos, 0);

  async function enviar() {
    setErro(null);
    const itens = lista.flatMap((p) => ((qtd[p.id] ?? 0) > 0 ? [{ produtoId: p.id, quantidade: qtd[p.id]! }] : []));
    try {
      await lancar.mutateAsync({ reservaId, itens });
      aoFechar();
    } catch (x) {
      setErro(x instanceof Error ? x : new Error("Não foi possível lançar o frigobar."));
    }
  }

  return (
    <Janela aberta titulo="Frigobar" aoFechar={aoFechar}>
      {produtos.error && <ErroAcao erro={produtos.error} />}
      {produtos.data && lista.length === 0 && <p className="reserva-suave">Nenhum produto de frigobar cadastrado.</p>}
      <ul className="frigobar-lista">
        {lista.map((p) => {
          const q = qtd[p.id] ?? 0;
          const mostrarCampo = outro[p.id] || q > RAPIDAS[RAPIDAS.length - 1]!;
          return (
            <li key={p.id} className="frigobar-item">
              <span className="frigobar-item__nome">{p.nome}</span>
              <span className="frigobar-item__preco">{formatarReais(p.precoCentavos)}</span>
              <span className="frigobar-item__qtd">
                {RAPIDAS.map((n) => (
                  <Botao
                    key={n}
                    tamanho="pequeno"
                    variante={q === n && !mostrarCampo ? "principal" : "contorno"}
                    aria-pressed={q === n && !mostrarCampo}
                    aria-label={`${n} de ${p.nome}`}
                    onClick={() => {
                      setQtd({ ...qtd, [p.id]: n });
                      setOutro({ ...outro, [p.id]: false });
                    }}
                  >
                    {n}
                  </Botao>
                ))}
                <Botao
                  tamanho="pequeno"
                  variante={mostrarCampo ? "principal" : "contorno"}
                  aria-pressed={mostrarCampo}
                  aria-label={`Outra quantidade de ${p.nome}`}
                  onClick={() => setOutro({ ...outro, [p.id]: true })}
                >
                  +
                </Botao>
              </span>
              {mostrarCampo && (
                <input
                  className="frigobar-item__campo"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAXIMO}
                  step={1}
                  aria-label={`Quantidade de ${p.nome}`}
                  value={q === 0 ? "" : q}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setQtd({ ...qtd, [p.id]: Number.isInteger(n) ? Math.min(Math.max(n, 0), MAXIMO) : 0 });
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      <p className="frigobar-total">
        Total: <strong>{formatarReais(total)}</strong>
      </p>
      <ErroAcao erro={erro} />
      <div className="formulario__acoes">
        <Botao variante="contorno" ignorarConexao onClick={aoFechar}>Cancelar</Botao>
        <Botao type="button" disabled={total === 0 || lancar.isPending} onClick={() => void enviar()}>Lançar</Botao>
      </div>
    </Janela>
  );
}
