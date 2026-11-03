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
import { CampoPercentual } from "./CampoPercentual";
import { ConfirmarRemocao } from "./ConfirmarRemocao";
import { aposSalvarTarifa, useCategoriasTarifa, useRegra, type Temporada } from "./consultas";

type Precos = { p1: number | null; p2: number | null; p3: number | null; extra: number | null };
const VAZIO: Precos = { p1: null, p2: null, p3: null, extra: null };
const resumoPeriodo = (t: { inicio: string; fim: string }) => `${formatarData(t.inicio, true)} a ${formatarData(t.fim, true)}`;

function Painel({ item, todas, fechar }: { item: Temporada | null; todas: Temporada[]; fechar: () => void }) {
  const cliente = useQueryClient();
  const categoriasQ = useCategoriasTarifa();
  const categorias = (categoriasQ.data ?? []).filter((c) => c.ativo);
  const [nome, setNome] = useState(item?.nome ?? "");
  const [inicio, setInicio] = useState(item?.inicio ?? "");
  const [fim, setFim] = useState(item?.fim ?? "");
  const [prioridade, setPrioridade] = useState(String(item?.prioridade ?? 1));
  const [modo, setModo] = useState<"percentual" | "tabela">(item && item.tabelas.length > 0 ? "tabela" : "percentual");
  const [percentual, setPercentual] = useState<number | null>(item?.percentual ?? 0);
  const [tabelas, setTabelas] = useState<Record<string, Precos>>(() =>
    Object.fromEntries((item?.tabelas ?? []).map((t) => [t.categoriaId, { p1: t.porAdultos[1], p2: t.porAdultos[2], p3: t.porAdultos[3], extra: t.adultoExtra }])),
  );
  const mudarTabela = (cat: string, parte: Partial<Precos>) => setTabelas((a) => ({ ...a, [cat]: { ...(a[cat] ?? VAZIO), ...parte } }));
  const alternarCategoria = (cat: string) =>
    setTabelas((a) => {
      const { [cat]: tinha, ...resto } = a;
      return tinha ? resto : { ...resto, [cat]: VAZIO };
    });

  const nPrioridade = /^-?\d+$/.test(prioridade.trim()) ? Number(prioridade) : null;
  const escolhidas = Object.entries(tabelas);
  const incompleta = escolhidas.some(([, t]) => t.p1 === null || t.p2 === null || t.p3 === null || t.extra === null);
  const motivos = [
    ...(nome.trim() === "" ? ["Informe o nome da temporada."] : []),
    ...(!dataValida(inicio) || !dataValida(fim) ? ["Informe o início e o fim."] : fim < inicio ? ["O fim deve ser depois do início."] : []),
    ...(nPrioridade === null ? ["Informe a prioridade (número inteiro)."] : []),
    ...(modo === "percentual" && percentual === null ? ["Informe o percentual."] : []),
    ...(modo === "tabela" && escolhidas.length === 0 ? ["Marque ao menos uma categoria com tabela própria."] : []),
    ...(modo === "tabela" && incompleta ? ["Preencha as quatro tarifas de cada categoria marcada."] : []),
  ];
  // Aviso (não bloqueia): períodos que se cruzam com a mesma prioridade deixam o desempate ao servidor.
  const cruzadas = dataValida(inicio) && dataValida(fim)
    ? todas.filter((t) => t.id !== item?.id && t.inicio <= fim && t.fim >= inicio)
    : [];
  const empate = cruzadas.filter((t) => t.prioridade === nPrioridade);

  const salvar = useMutation<unknown, Error>({
    mutationFn: () =>
      chamarApi("PUT", "/api/tarifas/temporadas", {
        ...(item ? { id: item.id } : {}),
        nome: nome.trim(), inicio, fim, prioridade: nPrioridade!,
        // Em modo tabela o percentual que a temporada já tinha (o servidor aceita os dois) segue como estava.
        percentual: modo === "percentual" ? percentual : (item && item.tabelas.length > 0 ? item.percentual : null),
        tabelas: modo === "tabela"
          ? escolhidas.map(([categoriaId, t]) => ({ categoriaId, porAdultos: { 1: t.p1!, 2: t.p2!, 3: t.p3! }, adultoExtra: t.extra! }))
          : [],
      }),
    onSuccess: async () => {
      await aposSalvarTarifa(cliente);
      fechar();
    },
  });

  const remover = useMutation<unknown, Error, void>({
    mutationFn: () => chamarApi<unknown>("DELETE", `/api/tarifas/temporadas/${encodeURIComponent(item!.id)}`),
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
        Prioridade
        <input inputMode="numeric" value={prioridade} onChange={(e) => setPrioridade(e.target.value)} />
      </label>
      <p className="tarifas__aviso">Quando duas temporadas se cruzam, vale a de maior prioridade.</p>
      <fieldset className="pousada__grupo">
        <legend>Como a temporada muda o preço</legend>
        <label className="pousada__marcar">
          <input type="radio" name="modo-temporada" checked={modo === "percentual"} onChange={() => setModo("percentual")} />
          Percentual sobre a tabela base
        </label>
        <label className="pousada__marcar">
          <input type="radio" name="modo-temporada" checked={modo === "tabela"} onChange={() => setModo("tabela")} />
          Tabela própria por categoria
        </label>
      </fieldset>
      {modo === "percentual" && <CampoPercentual rotulo="Percentual (%)" aceitaNegativo valor={percentual} aoMudar={setPercentual} />}
      {modo === "tabela" &&
        categorias.map((c) => {
          const t = tabelas[c.id];
          return (
            <div key={c.id} className="tarifas__bloco">
              <label className="pousada__marcar">
                <input type="checkbox" checked={!!t} onChange={() => alternarCategoria(c.id)} />
                {`Tabela própria: ${c.nome}`}
              </label>
              {t && (
                <>
                  <CampoDinheiro rotulo={`${c.nome}: diária para 1 adulto`} valor={t.p1} aoMudar={(v) => mudarTabela(c.id, { p1: v })} />
                  <CampoDinheiro rotulo={`${c.nome}: diária para 2 adultos`} valor={t.p2} aoMudar={(v) => mudarTabela(c.id, { p2: v })} />
                  <CampoDinheiro rotulo={`${c.nome}: diária para 3 adultos`} valor={t.p3} aoMudar={(v) => mudarTabela(c.id, { p3: v })} />
                  <CampoDinheiro rotulo={`${c.nome}: adulto extra`} valor={t.extra} aoMudar={(v) => mudarTabela(c.id, { extra: v })} />
                </>
              )}
            </div>
          );
        })}
      {cruzadas.length > 0 && (
        <p className="tarifas__aviso" role="status">
          {`Este período se cruza com: ${cruzadas.map((t) => `${t.nome} (${resumoPeriodo(t)})`).join(", ")}.`}
          {empate.length > 0 ? " A prioridade é a mesma, então a que vale é escolhida pelo sistema; use prioridades diferentes." : ""}
        </p>
      )}
      <Dicas motivos={motivos} />
      <ErroAcao erro={salvar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={motivos.length > 0 || salvar.isPending}>Salvar</Botao>
      </div>
      {item && (
        <ConfirmarRemocao
          rotulo="Remover temporada"
          aviso={`Remover a temporada ${item.nome}? Reservas já feitas mantêm os preços que têm; só cotações futuras mudam.`}
          remocao={remover}
        />
      )}
    </form>
  );
}

export function TelaTemporadas() {
  const q = useRegra<Temporada[]>("temporadas", "/api/tarifas/temporadas");
  const categoriasQ = useCategoriasTarifa();
  const nomeCat = (id: string) => categoriasQ.data?.find((c) => c.id === id)?.nome ?? id;
  const lista = q.data ?? [];
  return (
    <>
      <ErroAcao erro={q.error} />
      <ListaCadastro<Temporada>
        titulo="Temporadas"
        itens={lista}
        chave={(t) => t.id}
        colunas={[
          { titulo: "Nome", celula: (t) => t.nome },
          { titulo: "Período", celula: resumoPeriodo },
          { titulo: "Prioridade", celula: (t) => String(t.prioridade) },
          {
            titulo: "Preço",
            celula: (t) =>
              t.tabelas.length > 0
                ? `Tabela própria: ${t.tabelas.map((x) => `${nomeCat(x.categoriaId)} ${formatarReais(x.porAdultos[2])}`).join(", ")}`
                : `${t.percentual ?? 0}% sobre a base`,
          },
        ]}
        renderPainel={(p) => <Painel item={p.item} todas={lista} fechar={p.fechar} />}
      />
    </>
  );
}
