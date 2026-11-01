import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import type { Produto, Setor } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { CampoDinheiro } from "../../componentes/CampoDinheiro";
import { ErroAcao } from "../../componentes/ErroAcao";
import { formatarReais } from "../../lib/dinheiro";
import { Dicas } from "./Dicas";
import { ListaCadastro } from "./ListaCadastro";
import "./configuracoes.css";

/** Setores de venda oferecidos na tela; `hospedagem` é interno (early check-in/late check-out) e não é editável aqui. */
const SETORES: { id: Setor; rotulo: string }[] = [
  { id: "recepcao", rotulo: "Recepção" },
  { id: "frigobar", rotulo: "Frigobar" },
  { id: "bar", rotulo: "Bar" },
  { id: "restaurante", rotulo: "Restaurante" },
];
const ROTULO_SETOR = Object.fromEntries(SETORES.map((s) => [s.id, s.rotulo]));
const GRUPO_PADRAO = "geral";

function PainelProduto({ item, fechar }: { item: Produto | null; fechar: () => void }) {
  const cliente = useQueryClient();
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState(item?.nome ?? "");
  const [preco, setPreco] = useState<number | null>(item?.precoCentavos ?? null);
  const [unidade, setUnidade] = useState(item?.unidade ?? "un");
  const [tipo, setTipo] = useState<Produto["tipo"]>(item?.tipo ?? "produto");
  const [setores, setSetores] = useState<Setor[]>(item?.setores.filter((s) => s !== "hospedagem") ?? []);

  const motivos = [
    ...(!item && codigo.trim() === "" ? ["Informe o código do produto."] : []),
    ...(nome.trim() === "" ? ["Informe o nome do produto."] : []),
    ...(preco === null ? ["Informe o preço."] : []),
    ...(unidade.trim() === "" ? ["Informe a unidade."] : []),
    ...(setores.length === 0 ? ["Marque ao menos um setor de venda."] : []),
  ];

  const alternar = (s: Setor) => setSetores((atual) => (atual.includes(s) ? atual.filter((x) => x !== s) : [...atual, s]));

  const depois = async () => {
    // Listas de uso (frigobar, lançamentos, checklist) leem as chaves "produtos".
    await cliente.invalidateQueries({ queryKey: ["produtos"] });
    await cliente.invalidateQueries({ queryKey: ["checklist-modelos"] });
  };

  const salvar = useMutation<unknown, Error>({
    mutationFn: () => {
      const ordenados = SETORES.map((s) => s.id).filter((s) => setores.includes(s));
      const base = { nome: nome.trim(), precoCentavos: preco!, unidade: unidade.trim(), tipo };
      if (item) {
        // O setor interno, se o produto o tiver, é preservado: a tela não o mostra.
        const internos = item.setores.filter((s) => s === "hospedagem");
        return chamarApi("PUT", `/api/produtos/${item.id}`, { ...base, setores: [...internos, ...ordenados] });
      }
      return chamarApi("POST", "/api/produtos", { ...base, codigo: codigo.trim(), grupo: GRUPO_PADRAO, setores: ordenados });
    },
    onSuccess: async () => {
      await depois();
      fechar();
    },
  });

  const alterarAtivo = useMutation<unknown, Error>({
    mutationFn: () => chamarApi("POST", `/api/produtos/${item!.id}/${item!.ativo ? "desativar" : "reativar"}`),
    onSuccess: async () => {
      await depois();
      fechar();
    },
  });

  return (
    <form
      className="formulario"
      onSubmit={(e) => {
        e.preventDefault();
        if (motivos.length === 0) salvar.mutate();
      }}
    >
      {!item && (
        <label className="campo">
          Código
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        </label>
      )}
      <label className="campo">
        Nome
        <input value={nome} onChange={(e) => setNome(e.target.value)} />
      </label>
      <CampoDinheiro rotulo="Preço" valor={preco} aoMudar={setPreco} />
      <div className="cq__grade">
        <label className="campo">
          Unidade
          <input value={unidade} onChange={(e) => setUnidade(e.target.value)} />
        </label>
        <label className="campo">
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as Produto["tipo"])}>
            <option value="produto">Produto</option>
            <option value="servico">Serviço</option>
          </select>
        </label>
      </div>
      <fieldset className="pousada__grupo">
        <legend>Setores de venda</legend>
        {SETORES.map((s) => (
          <label key={s.id} className="pousada__marcar">
            <input type="checkbox" checked={setores.includes(s.id)} onChange={() => alternar(s.id)} />
            {s.rotulo}
          </label>
        ))}
      </fieldset>
      <Dicas motivos={motivos} />
      <ErroAcao erro={salvar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={motivos.length > 0 || salvar.isPending}>Salvar</Botao>
      </div>
      {item && (
        <div className="cq__ativo">
          <ErroAcao erro={alterarAtivo.error} />
          <Botao variante="contorno" disabled={alterarAtivo.isPending} onClick={() => alterarAtivo.mutate()}>
            {item.ativo ? "Desativar" : "Reativar"}
          </Botao>
        </div>
      )}
    </form>
  );
}

export function TelaProdutos() {
  const [inativos, setInativos] = useState(false);
  const [setor, setSetor] = useState<Setor | "">("");
  // Uma leitura só (com desativados); o servidor já omite os produtos internos de hospedagem.
  const produtosQ = useQuery({ queryKey: ["produtos", "retaguarda"], queryFn: () => chamarApi<Produto[]>("GET", "/api/produtos?incluirInativos=1") });
  const lista = (produtosQ.data ?? []).filter((p) => (inativos || p.ativo) && (setor === "" || p.setores.includes(setor)));

  return (
    <div className="cq">
      <ErroAcao erro={produtosQ.error} />
      <div className="cq__barra">
        <label className="campo cq__filtro">
          Filtrar por setor
          <select value={setor} onChange={(e) => setSetor(e.target.value as Setor | "")}>
            <option value="">Todos os setores</option>
            {SETORES.map((s) => (
              <option key={s.id} value={s.id}>{s.rotulo}</option>
            ))}
          </select>
        </label>
      </div>
      <ListaCadastro<Produto>
        titulo="Produtos"
        itens={lista}
        chave={(p) => p.id}
        inativo={(p) => !p.ativo}
        mostrarInativos={inativos}
        aoMostrarInativos={setInativos}
        colunas={[
          { titulo: "Nome", celula: (p) => p.nome },
          { titulo: "Código", celula: (p) => p.codigo },
          { titulo: "Preço", celula: (p) => formatarReais(p.precoCentavos) },
          { titulo: "Unidade", celula: (p) => p.unidade },
          { titulo: "Tipo", celula: (p) => (p.tipo === "servico" ? "Serviço" : "Produto") },
          { titulo: "Setores", celula: (p) => p.setores.map((s) => ROTULO_SETOR[s] ?? s).join(", ") },
        ]}
        renderPainel={(p) => <PainelProduto item={p.item} fechar={p.fechar} />}
      />
    </div>
  );
}
