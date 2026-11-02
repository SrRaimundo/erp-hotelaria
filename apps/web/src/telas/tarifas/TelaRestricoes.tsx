import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { formatarData } from "../../lib/datas";
import { Dicas } from "../configuracoes/Dicas";
import { ListaCadastro } from "../configuracoes/ListaCadastro";
import { dataValida } from "../nova-reserva/CamposAcomodacao";
import { aposSalvarTarifa, useCategoriasTarifa, useRegra, type Restricao } from "./consultas";

function Painel({ item, categoriaId, fechar }: { item: Restricao | null; categoriaId: string; fechar: () => void }) {
  const cliente = useQueryClient();
  const [data, setData] = useState(item?.data ?? "");
  const [min, setMin] = useState(item?.minNoites == null ? "" : String(item.minNoites));
  const [chegada, setChegada] = useState(item?.fechadoChegada ?? false);
  const [saida, setSaida] = useState(item?.fechadoSaida ?? false);
  const [venda, setVenda] = useState(item?.fechadoVenda ?? false);
  const nMin = min.trim() === "" ? null : /^\d+$/.test(min.trim()) && Number(min) >= 1 ? Number(min) : undefined;
  const motivos = [
    ...(!dataValida(data) ? ["Informe a data."] : []),
    ...(nMin === undefined ? ["O mínimo de noites deve ser 1 ou mais (ou deixe vazio)."] : []),
  ];
  const salvar = useMutation<unknown, Error>({
    mutationFn: () =>
      chamarApi("PUT", "/api/tarifas/restricoes", {
        categoriaId, data, minNoites: nMin ?? null, fechadoChegada: chegada, fechadoSaida: saida, fechadoVenda: venda,
      }),
    onSuccess: async () => {
      await aposSalvarTarifa(cliente);
      fechar();
    },
  });
  return (
    <form className="formulario" onSubmit={(e) => { e.preventDefault(); if (motivos.length === 0) salvar.mutate(); }}>
      <label className="campo">
        Data
        <input type="date" value={data} disabled={!!item} onChange={(e) => setData(e.target.value)} />
      </label>
      <label className="campo">
        Mínimo de noites (para chegar nesta data)
        <input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
      </label>
      <label className="pousada__marcar">
        <input type="checkbox" checked={chegada} onChange={(e) => setChegada(e.target.checked)} />
        Fechado para chegada
      </label>
      <label className="pousada__marcar">
        <input type="checkbox" checked={saida} onChange={(e) => setSaida(e.target.checked)} />
        Fechado para saída
      </label>
      <label className="pousada__marcar">
        <input type="checkbox" checked={venda} onChange={(e) => setVenda(e.target.checked)} />
        Fechado para venda
      </label>
      <p className="tarifas__aviso">Para liberar a data, desmarque tudo e deixe o mínimo vazio.</p>
      <Dicas motivos={motivos} />
      <ErroAcao erro={salvar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={motivos.length > 0 || salvar.isPending}>Salvar</Botao>
      </div>
    </form>
  );
}

const resumo = (r: Restricao) =>
  [r.minNoites !== null ? `mínimo ${r.minNoites} ${r.minNoites === 1 ? "noite" : "noites"}` : "", r.fechadoChegada ? "fechado para chegada" : "", r.fechadoSaida ? "fechado para saída" : "", r.fechadoVenda ? "fechado para venda" : ""]
    .filter(Boolean)
    .join(", ") || "sem restrição";

export function TelaRestricoes() {
  const categoriasQ = useCategoriasTarifa();
  const categorias = (categoriasQ.data ?? []).filter((c) => c.ativo);
  const [escolhida, setEscolhida] = useState("");
  const categoriaId = escolhida || categorias[0]?.id || "";
  const q = useRegra<Restricao[]>("restricoes", `/api/tarifas/restricoes?categoriaId=${encodeURIComponent(categoriaId)}`, [categoriaId], categoriaId !== "");
  return (
    <>
      <ErroAcao erro={categoriasQ.error ?? q.error} />
      <div className="cq__barra">
        <label className="campo cq__filtro">
          Categoria
          <select value={categoriaId} onChange={(e) => setEscolhida(e.target.value)}>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
      </div>
      {categoriaId !== "" && (
        <ListaCadastro<Restricao>
          titulo="Restrições"
          itens={q.data ?? []}
          chave={(r) => `${r.categoriaId}-${r.data}`}
          rotuloNovo="+ Nova restrição"
          colunas={[
            { titulo: "Data", celula: (r) => formatarData(r.data, true) },
            { titulo: "Regra", celula: resumo },
          ]}
          renderPainel={(p) => <Painel item={p.item} categoriaId={categoriaId} fechar={p.fechar} />}
        />
      )}
    </>
  );
}
