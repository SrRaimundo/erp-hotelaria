import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import type { Etapa, ItemAdmin } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Etiqueta } from "../../componentes/Etiqueta";
import "./configuracoes.css";

type Tipo = "saida" | "diaria";
const TIPOS: { id: Tipo; rotulo: string }[] = [
  { id: "saida", rotulo: "Saída" },
  { id: "diaria", rotulo: "Diária" },
];
/** Mesma ordem e mesmos títulos do checklist da governança. */
const ETAPAS: { id: Etapa; rotulo: string }[] = [
  { id: "limpeza", rotulo: "Limpeza" },
  { id: "enxoval", rotulo: "Enxoval recolhido" },
  { id: "equipamento", rotulo: "Equipamentos" },
  { id: "controles", rotulo: "Controles" },
];
const MAX_TEXTO = 120;

type Executar = (acao: () => Promise<unknown>, aoConcluir?: () => void) => void;

function ItemLinha({ item, primeiro, ultimo, ocupado, executar }: { item: ItemAdmin; primeiro: boolean; ultimo: boolean; ocupado: boolean; executar: Executar }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(item.texto);
  const caminho = `/api/checklists/itens/${item.id}`;

  if (editando) {
    const novo = texto.trim();
    return (
      <li className="checklists__item checklists__item--edicao">
        <label className="campo">
          Texto do item
          <input value={texto} maxLength={MAX_TEXTO} onChange={(e) => setTexto(e.target.value)} />
        </label>
        <Botao
          tamanho="pequeno"
          disabled={ocupado || novo === ""}
          onClick={() => executar(() => chamarApi("PUT", caminho, { texto: novo }), () => setEditando(false))}
        >
          Salvar
        </Botao>
        <Botao tamanho="pequeno" variante="contorno" ignorarConexao onClick={() => setEditando(false)}>Cancelar</Botao>
      </li>
    );
  }

  return (
    <li className={`checklists__item${item.ativo ? "" : " checklists__item--inativo"}`}>
      <span className="checklists__texto">
        {item.texto}
        {!item.ativo && <> <Etiqueta>desativado</Etiqueta></>}
      </span>
      <span className="checklists__acoes">
        <Botao tamanho="pequeno" variante="contorno" aria-label={`Mover ${item.texto} para cima`} disabled={ocupado || primeiro} onClick={() => executar(() => chamarApi("POST", `${caminho}/mover`, { direcao: "acima" }))}>
          ↑
        </Botao>
        <Botao tamanho="pequeno" variante="contorno" aria-label={`Mover ${item.texto} para baixo`} disabled={ocupado || ultimo} onClick={() => executar(() => chamarApi("POST", `${caminho}/mover`, { direcao: "abaixo" }))}>
          ↓
        </Botao>
        <Botao
          tamanho="pequeno"
          variante="contorno"
          aria-label={`Renomear ${item.texto}`}
          disabled={ocupado}
          onClick={() => {
            setTexto(item.texto);
            setEditando(true);
          }}
        >
          Renomear
        </Botao>
        <Botao
          tamanho="pequeno"
          variante="contorno"
          aria-label={`${item.ativo ? "Desativar" : "Reativar"} ${item.texto}`}
          disabled={ocupado}
          onClick={() => executar(() => chamarApi("PUT", caminho, { ativo: !item.ativo }))}
        >
          {item.ativo ? "Desativar" : "Reativar"}
        </Botao>
      </span>
    </li>
  );
}

function NovoItem({ tipo, etapa, ocupado, executar }: { tipo: Tipo; etapa: Etapa; ocupado: boolean; executar: Executar }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  if (!aberto) return <Botao tamanho="pequeno" variante="secundario" onClick={() => setAberto(true)}>+ Item</Botao>;
  const novo = texto.trim();
  return (
    <form
      className="checklists__novo"
      onSubmit={(e) => {
        e.preventDefault();
        if (novo !== "" && !ocupado) {
          executar(() => chamarApi("POST", "/api/checklists/itens", { tipo, etapa, texto: novo }), () => {
            setTexto("");
            setAberto(false);
          });
        }
      }}
    >
      <label className="campo">
        Novo item
        <input value={texto} maxLength={MAX_TEXTO} onChange={(e) => setTexto(e.target.value)} />
      </label>
      <Botao type="submit" tamanho="pequeno" disabled={ocupado || novo === ""}>Incluir</Botao>
      <Botao tamanho="pequeno" variante="contorno" ignorarConexao onClick={() => setAberto(false)}>Cancelar</Botao>
    </form>
  );
}

function SecaoEtapa({ tipo, etapa, rotulo, itens }: { tipo: Tipo; etapa: Etapa; rotulo: string; itens: ItemAdmin[] }) {
  const cliente = useQueryClient();
  const mutacao = useMutation<unknown, Error, { acao: () => Promise<unknown>; aoConcluir?: () => void }>({
    mutationFn: ({ acao }) => acao(),
    onSuccess: async (_, { aoConcluir }) => {
      // O checklist da governança lê os modelos; a lista desta tela, os itens de administração.
      await Promise.all([cliente.invalidateQueries({ queryKey: ["checklist-itens"] }), cliente.invalidateQueries({ queryKey: ["checklist-modelos"] })]);
      aoConcluir?.();
    },
  });
  const executar: Executar = (acao, aoConcluir) => mutacao.mutate({ acao, aoConcluir });
  return (
    <section className="checklists__etapa" aria-label={rotulo}>
      <h2>{rotulo}</h2>
      {itens.length === 0 ? (
        <p className="cq__aviso">Nenhum item nesta etapa.</p>
      ) : (
        <ul className="checklists__lista">
          {itens.map((item, i) => (
            <ItemLinha key={item.id} item={item} primeiro={i === 0} ultimo={i === itens.length - 1} ocupado={mutacao.isPending} executar={executar} />
          ))}
        </ul>
      )}
      <ErroAcao erro={mutacao.error} />
      <NovoItem tipo={tipo} etapa={etapa} ocupado={mutacao.isPending} executar={executar} />
    </section>
  );
}

export function TelaChecklists() {
  const [tipo, setTipo] = useState<Tipo>("saida");
  const itensQ = useQuery({ queryKey: ["checklist-itens", tipo], queryFn: () => chamarApi<ItemAdmin[]>("GET", `/api/checklists/itens?tipo=${tipo}`) });
  const itens = itensQ.data ?? [];
  return (
    <div className="checklists">
      <h1>Checklists</h1>
      <div role="tablist" aria-label="Tipo de checklist" className="checklists__abas">
        {TIPOS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`aba-${t.id}`} aria-selected={tipo === t.id} aria-controls="painel-checklist" className={`botao botao--${tipo === t.id ? "principal" : "contorno"} botao--normal`} onClick={() => setTipo(t.id)}>
            {t.rotulo}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="painel-checklist" aria-labelledby={`aba-${tipo}`} className="checklists__painel">
        <ErroAcao erro={itensQ.error} />
        {itensQ.isPending ? (
          <p>Carregando…</p>
        ) : (
          ETAPAS.map((e) => <SecaoEtapa key={`${tipo}-${e.id}`} tipo={tipo} etapa={e.id} rotulo={e.rotulo} itens={itens.filter((i) => i.etapa === e.id)} />)
        )}
      </div>
    </div>
  );
}
