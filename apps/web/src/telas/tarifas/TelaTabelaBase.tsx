import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import { Botao } from "../../componentes/Botao";
import { CampoDinheiro } from "../../componentes/CampoDinheiro";
import { ErroAcao } from "../../componentes/ErroAcao";
import { formatarReais } from "../../lib/dinheiro";
import { Dicas } from "../configuracoes/Dicas";
import { ListaCadastro } from "../configuracoes/ListaCadastro";
import { aposSalvarTarifa, useCategoriasTarifa, useRegra, type TabelaBaseCat } from "./consultas";

type Preco = { p1: number | null; p2: number | null; p3: number | null; extra: number | null; piso: number | null; teto: number | null };

function Painel({ item, categorias, fechar }: { item: TabelaBaseCat | null; categorias: { id: string; nome: string }[]; fechar: () => void }) {
  const cliente = useQueryClient();
  const [categoriaId, setCategoriaId] = useState(item?.categoriaId ?? categorias[0]?.id ?? "");
  const [p, setP] = useState<Preco>({
    p1: item?.porAdultos[1] ?? null, p2: item?.porAdultos[2] ?? null, p3: item?.porAdultos[3] ?? null,
    extra: item?.adultoExtra ?? null, piso: item?.piso ?? null, teto: item?.teto ?? null,
  });
  const mudar = (parte: Partial<Preco>) => setP((a) => ({ ...a, ...parte }));
  const motivos = [
    ...(categoriaId === "" ? ["Escolha a categoria."] : []),
    ...(p.p1 === null || p.p2 === null || p.p3 === null ? ["Informe a diária para 1, 2 e 3 adultos."] : []),
    ...(p.extra === null ? ["Informe o valor do adulto extra."] : []),
    ...(p.piso !== null && p.teto !== null && p.piso > p.teto ? ["O piso não pode passar do teto."] : []),
  ];
  const salvar = useMutation<unknown, Error>({
    mutationFn: () =>
      chamarApi("PUT", "/api/tarifas/tabelas-base", {
        categoriaId, porAdultos: { 1: p.p1!, 2: p.p2!, 3: p.p3! }, adultoExtra: p.extra!, piso: p.piso, teto: p.teto,
      }),
    onSuccess: async () => {
      await aposSalvarTarifa(cliente);
      fechar();
    },
  });
  return (
    <form className="formulario" onSubmit={(e) => { e.preventDefault(); if (motivos.length === 0) salvar.mutate(); }}>
      <label className="campo">
        Categoria
        {item ? (
          <input value={categorias.find((c) => c.id === item.categoriaId)?.nome ?? item.categoriaId} disabled readOnly />
        ) : (
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        )}
      </label>
      <CampoDinheiro rotulo="Diária para 1 adulto" valor={p.p1} aoMudar={(v) => mudar({ p1: v })} />
      <CampoDinheiro rotulo="Diária para 2 adultos" valor={p.p2} aoMudar={(v) => mudar({ p2: v })} />
      <CampoDinheiro rotulo="Diária para 3 adultos" valor={p.p3} aoMudar={(v) => mudar({ p3: v })} />
      <CampoDinheiro rotulo="Adulto extra" valor={p.extra} aoMudar={(v) => mudar({ extra: v })} />
      <CampoDinheiro rotulo="Piso" valor={p.piso} aoMudar={(v) => mudar({ piso: v })} />
      <CampoDinheiro rotulo="Teto" valor={p.teto} aoMudar={(v) => mudar({ teto: v })} />
      <Dicas motivos={motivos} />
      <ErroAcao erro={salvar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={motivos.length > 0 || salvar.isPending}>Salvar</Botao>
      </div>
    </form>
  );
}

export function TelaTabelaBase() {
  const tabelasQ = useRegra<TabelaBaseCat[]>("tabelas-base", "/api/tarifas/tabelas-base");
  const categoriasQ = useCategoriasTarifa();
  const categorias = categoriasQ.data ?? [];
  const nome = (id: string) => categorias.find((c) => c.id === id)?.nome ?? id;
  const tabelas = tabelasQ.data ?? [];
  const semTabela = categorias.filter((c) => c.ativo && !tabelas.some((t) => t.categoriaId === c.id));
  return (
    <>
      <ErroAcao erro={tabelasQ.error ?? categoriasQ.error} />
      {semTabela.length > 0 && (
        <p className="tarifas__aviso">Sem tabela de preços: {semTabela.map((c) => c.nome).join(", ")}. Essas categorias não podem ser reservadas até terem uma tabela.</p>
      )}
      <ListaCadastro<TabelaBaseCat>
        titulo="Tabela base"
        itens={tabelas}
        chave={(t) => t.categoriaId}
        rotuloNovo="+ Nova tabela"
        colunas={[
          { titulo: "Categoria", celula: (t) => nome(t.categoriaId) },
          { titulo: "1 adulto", celula: (t) => formatarReais(t.porAdultos[1]) },
          { titulo: "2 adultos", celula: (t) => formatarReais(t.porAdultos[2]) },
          { titulo: "3 adultos", celula: (t) => formatarReais(t.porAdultos[3]) },
          { titulo: "Adulto extra", celula: (t) => formatarReais(t.adultoExtra) },
          { titulo: "Piso", celula: (t) => (t.piso === null ? "—" : formatarReais(t.piso)) },
          { titulo: "Teto", celula: (t) => (t.teto === null ? "—" : formatarReais(t.teto)) },
        ]}
        renderPainel={(x) =>
          x.item === null && semTabela.length === 0 ? (
            <p className="tarifas__aviso">Todas as categorias ativas já têm tabela. Edite uma existente.</p>
          ) : (
            <Painel item={x.item} categorias={x.item ? categorias : semTabela} fechar={x.fechar} />
          )
        }
      />
    </>
  );
}
