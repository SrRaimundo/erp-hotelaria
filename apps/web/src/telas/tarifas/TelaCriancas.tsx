import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import { Botao } from "../../componentes/Botao";
import { CampoDinheiro } from "../../componentes/CampoDinheiro";
import { ErroAcao } from "../../componentes/ErroAcao";
import { formatarReais } from "../../lib/dinheiro";
import { Dicas } from "../configuracoes/Dicas";
import { ListaCadastro } from "../configuracoes/ListaCadastro";
import { CampoPercentual } from "./CampoPercentual";
import { aposSalvarTarifa, useRegra, type FaixaCrianca, type TipoFaixaCrianca } from "./consultas";

const ROTULO_TIPO: Record<TipoFaixaCrianca, string> = { gratis: "Grátis", percentual_adicional: "% do adulto extra", fixo: "Valor fixo por noite" };
const TIPOS: TipoFaixaCrianca[] = ["gratis", "percentual_adicional", "fixo"];
const cobranca = (f: FaixaCrianca) => (f.tipo === "gratis" ? "Grátis" : f.tipo === "fixo" ? `${formatarReais(f.valor)} por noite` : `${String(f.valor).replace(".", ",")}% do adulto extra`);
const ordenar = (l: FaixaCrianca[]) => [...l].sort((a, b) => a.idadeMin - b.idadeMin);
const inteiro = (t: string) => (/^\d{1,3}$/.test(t.trim()) ? Number(t) : null);

function Painel({ item, todas, fechar }: { item: FaixaCrianca | null; todas: FaixaCrianca[]; fechar: () => void }) {
  const cliente = useQueryClient();
  const [min, setMin] = useState(item ? String(item.idadeMin) : "");
  const [max, setMax] = useState(item ? String(item.idadeMax) : "");
  const [tipo, setTipo] = useState<TipoFaixaCrianca>(item?.tipo ?? "gratis");
  const [percentual, setPercentual] = useState<number | null>(item?.tipo === "percentual_adicional" ? item.valor : null);
  const [fixo, setFixo] = useState<number | null>(item?.tipo === "fixo" ? item.valor : null);
  const outras = item ? todas.filter((f) => f.idadeMin !== item.idadeMin || f.idadeMax !== item.idadeMax) : todas;
  const a = inteiro(min);
  const b = inteiro(max);
  const valor = tipo === "gratis" ? 0 : tipo === "fixo" ? fixo : percentual;
  const motivos = [
    ...(a === null || b === null ? ["Informe a idade inicial e a final (em anos)."] : b < a ? ["A idade final não pode ser menor que a inicial."] : outras.some((f) => a <= f.idadeMax && b >= f.idadeMin) ? ["Essa faixa cruza com outra já cadastrada."] : []),
    ...(valor === null ? [tipo === "fixo" ? "Informe o valor por noite." : "Informe o percentual."] : []),
  ];
  const enviar = useMutation<unknown, Error, FaixaCrianca[]>({
    mutationFn: (lista) => chamarApi("PUT", "/api/tarifas/faixas-crianca", lista),
    onSuccess: async () => {
      await aposSalvarTarifa(cliente);
      fechar();
    },
  });
  return (
    <form className="formulario" onSubmit={(e) => { e.preventDefault(); if (motivos.length === 0) enviar.mutate(ordenar([...outras, { idadeMin: a!, idadeMax: b!, tipo, valor: valor! }])); }}>
      <div className="tarifas__grade">
        <label className="campo">
          Idade a partir de
          <input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
        </label>
        <label className="campo">
          Até a idade
          <input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
      </div>
      <label className="campo">
        Cobrança
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoFaixaCrianca)}>
          {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
        </select>
      </label>
      {tipo === "percentual_adicional" && <CampoPercentual rotulo="Percentual do adulto extra (%)" valor={percentual} aoMudar={setPercentual} />}
      {tipo === "fixo" && <CampoDinheiro rotulo="Valor por noite" valor={fixo} aoMudar={setFixo} />}
      <Dicas motivos={motivos} />
      <ErroAcao erro={enviar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={motivos.length > 0 || enviar.isPending}>Salvar</Botao>
      </div>
      {item && (
        <div className="cq__ativo">
          <Botao variante="contorno" disabled={enviar.isPending} onClick={() => enviar.mutate(ordenar(outras))}>Remover faixa</Botao>
        </div>
      )}
    </form>
  );
}

export function TelaCriancas() {
  const q = useRegra<FaixaCrianca[]>("faixas-crianca", "/api/tarifas/faixas-crianca");
  const lista = q.data ?? [];
  return (
    <>
      <ErroAcao erro={q.error} />
      <p className="tarifas__aviso">Sem faixa para a idade da criança, a cotação é recusada. Quem tem a idade de adulto da pousada ou mais conta como adulto.</p>
      <ListaCadastro<FaixaCrianca>
        titulo="Crianças"
        itens={lista}
        chave={(f) => `${f.idadeMin}-${f.idadeMax}`}
        rotuloNovo="+ Nova faixa"
        colunas={[
          { titulo: "Idade", celula: (f) => `${f.idadeMin} a ${f.idadeMax} anos` },
          { titulo: "Cobrança", celula: cobranca },
        ]}
        renderPainel={(p) => <Painel item={p.item} todas={lista} fechar={p.fechar} />}
      />
    </>
  );
}
