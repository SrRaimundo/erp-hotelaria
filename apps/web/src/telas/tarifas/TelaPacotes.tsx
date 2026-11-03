import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import { Botao } from "../../componentes/Botao";
import { CampoDinheiro } from "../../componentes/CampoDinheiro";
import { ErroAcao } from "../../componentes/ErroAcao";
import { formatarData } from "../../lib/datas";
import { formatarReais } from "../../lib/dinheiro";
import { Dicas } from "../configuracoes/Dicas";
import { ListaCadastro } from "../configuracoes/ListaCadastro";
import { dataValida } from "../nova-reserva/CamposAcomodacao";
import { aposSalvarTarifa, useCategoriasTarifa, useRegra, type Pacote } from "./consultas";

function Painel({ item, fechar }: { item: Pacote | null; fechar: () => void }) {
  const cliente = useQueryClient();
  const categoriasQ = useCategoriasTarifa();
  const categorias = (categoriasQ.data ?? []).filter((c) => c.ativo || c.id === item?.categoriaId);
  const [nome, setNome] = useState(item?.nome ?? "");
  const [categoriaId, setCategoriaId] = useState(item?.categoriaId ?? "");
  const [inicio, setInicio] = useState(item?.inicio ?? "");
  const [fim, setFim] = useState(item?.fim ?? "");
  const [minNoites, setMinNoites] = useState(String(item?.minNoites ?? 2));
  const [p1, setP1] = useState<number | null>(item?.valorNoite[1] ?? null);
  const [p2, setP2] = useState<number | null>(item?.valorNoite[2] ?? null);
  const [p3, setP3] = useState<number | null>(item?.valorNoite[3] ?? null);
  const [ativo, setAtivo] = useState(item?.ativo ?? true);
  // Sem escolha explícita vale a primeira categoria da lista (evita um select "vazio" que parece preenchido).
  const categoria = categoriaId || categorias[0]?.id || "";
  const nMin = /^\d+$/.test(minNoites.trim()) && Number(minNoites) >= 1 ? Number(minNoites) : null;

  const motivos = [
    ...(nome.trim() === "" ? ["Informe o nome do pacote."] : []),
    ...(categoria === "" ? ["Escolha a categoria."] : []),
    ...(!dataValida(inicio) || !dataValida(fim) ? ["Informe o início e o fim."] : fim < inicio ? ["O fim deve ser depois do início."] : []),
    ...(nMin === null ? ["Informe o mínimo de noites (1 ou mais)."] : []),
    ...(p1 === null || p2 === null || p3 === null ? ["Informe o preço da noite para 1, 2 e 3 adultos."] : []),
  ];
  const salvar = useMutation<unknown, Error>({
    mutationFn: () =>
      chamarApi("PUT", "/api/tarifas/pacotes", {
        ...(item ? { id: item.id } : {}),
        nome: nome.trim(), categoriaId: categoria, inicio, fim, minNoites: nMin!, valorNoite: { 1: p1!, 2: p2!, 3: p3! }, ativo,
      }),
    onSuccess: async () => {
      await aposSalvarTarifa(cliente);
      fechar();
    },
  });
  return (
    <form className="formulario" onSubmit={(e) => { e.preventDefault(); if (motivos.length === 0) salvar.mutate(); }}>
      <label className="campo">
        Nome
        <input value={nome} onChange={(e) => setNome(e.target.value)} />
      </label>
      <label className="campo">
        Categoria
        <select value={categoria} onChange={(e) => setCategoriaId(e.target.value)}>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </label>
      <div className="tarifas__grade">
        <label className="campo">
          Início
          <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </label>
        <label className="campo">
          Fim
          <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
        </label>
      </div>
      <label className="campo">
        Mínimo de noites
        <input inputMode="numeric" value={minNoites} onChange={(e) => setMinNoites(e.target.value)} />
      </label>
      <CampoDinheiro rotulo="Preço da noite para 1 adulto" valor={p1} aoMudar={setP1} />
      <CampoDinheiro rotulo="Preço da noite para 2 adultos" valor={p2} aoMudar={setP2} />
      <CampoDinheiro rotulo="Preço da noite para 3 adultos" valor={p3} aoMudar={setP3} />
      <label className="pousada__marcar">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        Pacote ativo
      </label>
      <Dicas motivos={motivos} />
      <ErroAcao erro={salvar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={motivos.length > 0 || salvar.isPending}>Salvar</Botao>
      </div>
    </form>
  );
}

export function TelaPacotes() {
  const q = useRegra<Pacote[]>("pacotes", "/api/tarifas/pacotes");
  const categoriasQ = useCategoriasTarifa();
  const [inativos, setInativos] = useState(false);
  const nomeCat = (id: string) => categoriasQ.data?.find((c) => c.id === id)?.nome ?? id;
  const lista = (q.data ?? []).filter((p) => inativos || p.ativo);
  return (
    <>
      <ErroAcao erro={q.error} />
      <ListaCadastro<Pacote>
        titulo="Pacotes"
        itens={lista}
        chave={(p) => p.id}
        inativo={(p) => !p.ativo}
        mostrarInativos={inativos}
        aoMostrarInativos={setInativos}
        colunas={[
          { titulo: "Nome", celula: (p) => p.nome },
          { titulo: "Categoria", celula: (p) => nomeCat(p.categoriaId) },
          { titulo: "Período", celula: (p) => `${formatarData(p.inicio, true)} a ${formatarData(p.fim, true)}` },
          { titulo: "Mínimo", celula: (p) => `${p.minNoites} ${p.minNoites === 1 ? "noite" : "noites"}` },
          { titulo: "Noite (2 adultos)", celula: (p) => formatarReais(p.valorNoite[2]) },
        ]}
        renderPainel={(p) => <Painel item={p.item} fechar={p.fechar} />}
      />
    </>
  );
}
