import { useState, type FormEvent } from "react";
import { chamarApi } from "../../api/cliente";
import { useAcao, useProdutos } from "../../api/consultas";
import { Botao } from "../../componentes/Botao";
import { CampoDinheiro } from "../../componentes/CampoDinheiro";
import { ErroAcao } from "../../componentes/ErroAcao";
import type { Setor } from "../../api/tipos";
import { formatarReais } from "../../lib/dinheiro";
import { ROTULO_SETOR } from "../../lib/setores";

const LIVRE = "__livre__";
const SETORES_EXTRA: Setor[] = ["recepcao", "frigobar", "bar", "restaurante"];

type Corpo =
  | { tipo: "extra"; produtoCodigo: string; quantidade: number; setor: Setor }
  | { tipo: "extra"; descricao: string; valorUnitario: number; quantidade: number; setor: Setor };

export function FormLancarExtra({ contaId }: { contaId: string }) {
  const [setor, setSetor] = useState<Setor>("recepcao");
  const produtos = useProdutos(setor);
  const lancar = useAcao((c: Corpo) => chamarApi("POST", `/api/contas/${encodeURIComponent(contaId)}/lancamentos`, c));
  const [produto, setProduto] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState<number | null>(null);
  const [quantidade, setQuantidade] = useState("1");
  const [erro, setErro] = useState<Error | null>(null);
  const livre = produto === LIVRE;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const qtd = /^\d+$/.test(quantidade.trim()) ? Number(quantidade) : 0;
    if (produto === "" || (livre && (!descricao.trim() || valor === null || valor < 1))) {
      setErro(new Error("Escolha um produto ou informe a descrição e o valor."));
      return;
    }
    if (qtd < 1) {
      setErro(new Error("Informe a quantidade: um número inteiro de 1 em diante."));
      return;
    }
    const corpo: Corpo = livre
      ? { tipo: "extra", descricao: descricao.trim(), valorUnitario: valor!, quantidade: qtd, setor }
      : { tipo: "extra", produtoCodigo: produto, quantidade: qtd, setor };
    try {
      await lancar.mutateAsync(corpo);
      setProduto("");
      setDescricao("");
      setValor(null);
      setQuantidade("1");
    } catch (x) {
      setErro(x instanceof Error ? x : new Error("Não foi possível lançar o extra."));
    }
  }

  return (
    <form className="formulario conta-form" onSubmit={(e) => void enviar(e)} aria-labelledby="titulo-lancar-extra">
      <h4 id="titulo-lancar-extra">Lançar extra</h4>
      <div className="campo">
        <label htmlFor="extra-setor">Setor</label>
        <select
          id="extra-setor"
          value={setor}
          onChange={(e) => {
            setSetor(e.target.value as Setor);
            setProduto("");
          }}
        >
          {SETORES_EXTRA.map((s) => (
            <option key={s} value={s}>{ROTULO_SETOR[s]}</option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="extra-produto">Produto</label>
        <select id="extra-produto" value={produto} onChange={(e) => setProduto(e.target.value)}>
          <option value="">Selecione…</option>
          {(produtos.data ?? []).map((p) => (
            <option key={p.id} value={p.codigo}>
              {`${p.nome} — ${formatarReais(p.precoCentavos)}`}
            </option>
          ))}
          <option value={LIVRE}>Outro (descrição livre)</option>
        </select>
      </div>
      {livre && (
        <>
          <div className="campo">
            <label htmlFor="extra-descricao">Descrição</label>
            <input id="extra-descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <CampoDinheiro rotulo="Valor unitário" valor={valor} aoMudar={setValor} />
        </>
      )}
      <div className="campo">
        <label htmlFor="extra-quantidade">Quantidade</label>
        <input id="extra-quantidade" inputMode="numeric" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
      </div>
      <ErroAcao erro={erro} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={lancar.isPending}>Lançar</Botao>
      </div>
    </form>
  );
}
