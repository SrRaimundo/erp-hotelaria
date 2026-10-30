import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chamarApi, ErroApi } from "../../api/cliente";
import type { Categoria, Quarto, TabelaBaseCategoria } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { CampoDinheiro } from "../../componentes/CampoDinheiro";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Gaveta } from "../../componentes/Gaveta";
import { formatarReais } from "../../lib/dinheiro";
import { ListaCadastro } from "./ListaCadastro";
import "./configuracoes.css";

/** O servidor não devolve o campo `ativo`; a tela o deriva comparando a lista completa com a de ativos. */
type CategoriaLinha = Categoria & { ativo: boolean };
type QuartoLinha = Quarto & { ativo: boolean };

const inteiro = (t: string, minimo: number): number | null => (/^\d+$/.test(t.trim()) && Number(t) >= minimo ? Number(t) : null);

/** Mensagem do servidor junto da ação, mais os códigos/números de `detalhes` que a mensagem ainda não cita. */
function ErroComDetalhes({ erro }: { erro: Error | null | undefined }) {
  if (!erro) return null;
  const detalhes = erro instanceof ErroApi && typeof erro.detalhes === "object" && erro.detalhes !== null ? (erro.detalhes as Record<string, unknown>) : {};
  const rotulos: Record<string, string> = { codigos: "Reservas", numeros: "Quartos em conflito" };
  const extras = Object.entries(rotulos).flatMap(([chave, rotulo]) => {
    const valores = detalhes[chave];
    if (!Array.isArray(valores)) return [];
    const faltam = valores.map(String).filter((v) => !erro.message.includes(v));
    return faltam.length > 0 ? [`${rotulo}: ${faltam.join(", ")}`] : [];
  });
  return (
    <p role="alert" className="erro-acao">
      {erro.message}
      {extras.map((e) => (
        <span key={e} className="cq__extra">{e}</span>
      ))}
    </p>
  );
}

/** Lista de ativos + lista completa (só quando pedida): `ativo` = presente na lista de ativos. */
function useComInativos<T extends { id: string }>(chave: unknown[], caminho: string, mostrarInativos: boolean) {
  const sep = caminho.includes("?") ? "&" : "?";
  const ativos = useQuery({ queryKey: [...chave, "ativos"], queryFn: () => chamarApi<T[]>("GET", caminho) });
  const todos = useQuery({
    queryKey: [...chave, "todos"],
    queryFn: () => chamarApi<T[]>("GET", `${caminho}${sep}incluirInativos=1`),
    enabled: mostrarInativos,
  });
  const idsAtivos = new Set((ativos.data ?? []).map((i) => i.id));
  const fonte = mostrarInativos ? todos.data : ativos.data;
  return { itens: (fonte ?? []).map((i) => ({ ...i, ativo: idsAtivos.has(i.id) })), erro: ativos.error ?? todos.error, ativas: ativos.data ?? [] };
}

function CampoNumero({ rotulo, valor, aoMudar }: { rotulo: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <label className="campo">
      {rotulo}
      <input type="number" min={0} step={1} inputMode="numeric" value={valor} onChange={(e) => aoMudar(e.target.value)} />
    </label>
  );
}

function CampoTexto({ rotulo, valor, aoMudar }: { rotulo: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <label className="campo">
      {rotulo}
      <input value={valor} onChange={(e) => aoMudar(e.target.value)} />
    </label>
  );
}

/** Botão Desativar/Reativar com a mensagem do servidor ao lado; fecha o painel quando dá certo. */
function AcaoAtivo({ caminho, ativo, aoConcluir, invalidar }: { caminho: string; ativo: boolean; aoConcluir: () => void; invalidar: string[] }) {
  const cliente = useQueryClient();
  const alternar = useMutation<unknown, Error>({
    mutationFn: () => chamarApi("POST", `${caminho}/${ativo ? "desativar" : "reativar"}`),
    onSuccess: async () => {
      await Promise.all(invalidar.map((k) => cliente.invalidateQueries({ queryKey: [k] })));
      aoConcluir();
    },
  });
  return (
    <div className="cq__ativo">
      <ErroComDetalhes erro={alternar.error} />
      <Botao variante="contorno" disabled={alternar.isPending} onClick={() => alternar.mutate()}>
        {ativo ? "Desativar" : "Reativar"}
      </Botao>
    </div>
  );
}

// ---------- categorias ----------

type Precos = { p1: number | null; p2: number | null; p3: number | null; extra: number | null; piso: number | null; teto: number | null };

function PainelCategoria({ item, tabela, precosIndisponiveis, fechar }: { item: CategoriaLinha | null; tabela: TabelaBaseCategoria | undefined; precosIndisponiveis: Error | null; fechar: () => void }) {
  const cliente = useQueryClient();
  const [nome, setNome] = useState(item?.nome ?? "");
  const [adultos, setAdultos] = useState(item ? String(item.maxAdultos) : "");
  const [criancas, setCriancas] = useState(item ? String(item.maxCriancas) : "");
  const [comodidades, setComodidades] = useState(item?.comodidades.join(", ") ?? "");
  const [preco, setPreco] = useState<Precos>({
    p1: tabela?.porAdultos[1] ?? null, p2: tabela?.porAdultos[2] ?? null, p3: tabela?.porAdultos[3] ?? null,
    extra: tabela?.adultoExtra ?? null, piso: tabela?.piso ?? null, teto: tabela?.teto ?? null,
  });
  // Categoria criada por uma tentativa cujo preço falhou: a nova tentativa edita em vez de criar de novo.
  const criadaId = useRef<string | null>(null);
  const mudarPreco = (p: Partial<Precos>) => setPreco((x) => ({ ...x, ...p }));

  const maxAdultos = inteiro(adultos, 1);
  const maxCriancas = inteiro(criancas, 0);
  const comPrecos = precosIndisponiveis === null;
  const precoOk = preco.p1 !== null && preco.p2 !== null && preco.p3 !== null && preco.extra !== null;
  const faixaOk = preco.piso === null || preco.teto === null || preco.piso <= preco.teto;
  const valido = nome.trim() !== "" && maxAdultos !== null && maxCriancas !== null && (!comPrecos || (precoOk && faixaOk));

  const salvar = useMutation<unknown, Error>({
    mutationFn: async () => {
      const corpo = {
        nome: nome.trim(), maxAdultos: maxAdultos!, maxCriancas: maxCriancas!,
        comodidades: comodidades.split(",").map((c) => c.trim()).filter(Boolean),
      };
      let id = criadaId.current ?? item?.id;
      if (id) await chamarApi("PUT", `/api/categorias/${id}`, corpo);
      else {
        id = (await chamarApi<Categoria>("POST", "/api/categorias", corpo)).id;
        criadaId.current = id;
      }
      if (comPrecos) {
        await chamarApi("PUT", "/api/tarifas/tabelas-base", {
          categoriaId: id,
          porAdultos: { 1: preco.p1, 2: preco.p2, 3: preco.p3 },
          adultoExtra: preco.extra,
          piso: preco.piso,
          teto: preco.teto,
        });
      }
    },
    onSettled: async () => {
      await Promise.all([cliente.invalidateQueries({ queryKey: ["categorias"] }), cliente.invalidateQueries({ queryKey: ["tarifas"] })]);
    },
    onSuccess: fechar,
  });

  return (
    <form
      className="formulario"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) salvar.mutate();
      }}
    >
      <CampoTexto rotulo="Nome" valor={nome} aoMudar={setNome} />
      <div className="cq__grade">
        <CampoNumero rotulo="Máximo de adultos" valor={adultos} aoMudar={setAdultos} />
        <CampoNumero rotulo="Máximo de crianças" valor={criancas} aoMudar={setCriancas} />
      </div>
      <CampoTexto rotulo="Comodidades (separadas por vírgula)" valor={comodidades} aoMudar={setComodidades} />
      <fieldset className="pousada__grupo">
        <legend>Preço base da diária</legend>
        {!comPrecos && (
          <>
            <ErroAcao erro={precosIndisponiveis} />
            <p className="cq__aviso">Os preços não puderam ser carregados; só os dados da categoria serão salvos.</p>
          </>
        )}
        {comPrecos && (
          <>
            <div className="cq__grade">
              <CampoDinheiro rotulo="Diária para 1 adulto" valor={preco.p1} aoMudar={(p1) => mudarPreco({ p1 })} />
              <CampoDinheiro rotulo="Diária para 2 adultos" valor={preco.p2} aoMudar={(p2) => mudarPreco({ p2 })} />
              <CampoDinheiro rotulo="Diária para 3 adultos" valor={preco.p3} aoMudar={(p3) => mudarPreco({ p3 })} />
              <CampoDinheiro rotulo="Adulto extra" valor={preco.extra} aoMudar={(extra) => mudarPreco({ extra })} />
              <CampoDinheiro rotulo="Piso" valor={preco.piso} aoMudar={(piso) => mudarPreco({ piso })} />
              <CampoDinheiro rotulo="Teto" valor={preco.teto} aoMudar={(teto) => mudarPreco({ teto })} />
            </div>
            {!faixaOk && <p role="alert" className="erro-acao">O piso não pode ser maior que o teto.</p>}
          </>
        )}
      </fieldset>
      <ErroComDetalhes erro={salvar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={!valido || salvar.isPending}>Salvar</Botao>
      </div>
      {item && <AcaoAtivo caminho={`/api/categorias/${item.id}`} ativo={item.ativo} aoConcluir={fechar} invalidar={["categorias", "quartos"]} />}
    </form>
  );
}

// ---------- quartos ----------

function PainelQuarto({ item, categorias, todas, fechar }: { item: QuartoLinha | null; categorias: Categoria[]; todas: Categoria[]; fechar: () => void }) {
  const cliente = useQueryClient();
  const [numero, setNumero] = useState(item?.numero ?? "");
  const [categoriaId, setCategoriaId] = useState(item?.categoriaId ?? categorias[0]?.id ?? "");
  const [bloco, setBloco] = useState(item?.bloco ?? "");
  // Só categorias ativas; a categoria atual do quarto fica na lista mesmo se estiver desativada, para não trocá-la sem querer.
  const atual = item && !categorias.some((c) => c.id === item.categoriaId) ? todas.find((c) => c.id === item.categoriaId) : undefined;
  const opcoes = atual ? [atual, ...categorias] : categorias;
  const valido = numero.trim() !== "" && categoriaId !== "";

  const salvar = useMutation<unknown, Error>({
    mutationFn: () => {
      const b = bloco.trim();
      if (item) return chamarApi("PUT", `/api/quartos/${item.id}`, { numero: numero.trim(), categoriaId, bloco: b === "" ? null : b });
      return chamarApi("POST", "/api/quartos", { numero: numero.trim(), categoriaId, ...(b === "" ? {} : { bloco: b }) });
    },
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["quartos"] });
      fechar();
    },
  });

  return (
    <form
      className="formulario"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) salvar.mutate();
      }}
    >
      <CampoTexto rotulo="Número" valor={numero} aoMudar={setNumero} />
      <label className="campo">
        Categoria
        <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
          {opcoes.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
      </label>
      <CampoTexto rotulo="Bloco" valor={bloco} aoMudar={setBloco} />
      <ErroComDetalhes erro={salvar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={!valido || salvar.isPending}>Salvar</Botao>
      </div>
      {item && <AcaoAtivo caminho={`/api/quartos/${item.id}`} ativo={item.ativo} aoConcluir={fechar} invalidar={["quartos"]} />}
    </form>
  );
}

function PainelLote({ categorias, fechar }: { categorias: Categoria[]; fechar: () => void }) {
  const cliente = useQueryClient();
  const [categoriaId, setCategoriaId] = useState(categorias[0]?.id ?? "");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [bloco, setBloco] = useState("");
  const inicio = inteiro(de, 0);
  const fim = inteiro(ate, 0);
  const valido = categoriaId !== "" && inicio !== null && fim !== null && fim >= inicio;

  const criar = useMutation<unknown, Error>({
    mutationFn: () => chamarApi("POST", "/api/quartos/lote", { categoriaId, de: inicio, ate: fim, ...(bloco.trim() === "" ? {} : { bloco: bloco.trim() }) }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["quartos"] });
      fechar();
    },
  });

  return (
    <form
      className="formulario"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) criar.mutate();
      }}
    >
      <label className="campo">
        Categoria
        <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
      </label>
      <div className="cq__grade">
        <CampoNumero rotulo="De" valor={de} aoMudar={setDe} />
        <CampoNumero rotulo="Até" valor={ate} aoMudar={setAte} />
      </div>
      <CampoTexto rotulo="Bloco" valor={bloco} aoMudar={setBloco} />
      <ErroComDetalhes erro={criar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={!valido || criar.isPending}>Criar quartos</Botao>
      </div>
    </form>
  );
}

// ---------- tela ----------

export function TelaCategoriasQuartos() {
  const [inativasCategorias, setInativasCategorias] = useState(false);
  const [inativosQuartos, setInativosQuartos] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [lote, setLote] = useState(false);

  const categorias = useComInativos<Categoria>(["categorias"], "/api/categorias", inativasCategorias);
  // A lista completa de categorias dá o nome de quartos em categorias desativadas.
  const todasCategorias = useQuery({ queryKey: ["categorias", "todas"], queryFn: () => chamarApi<Categoria[]>("GET", "/api/categorias?incluirInativos=1") });
  const quartos = useComInativos<Quarto>(["quartos", filtro], filtro ? `/api/quartos?categoriaId=${encodeURIComponent(filtro)}` : "/api/quartos", inativosQuartos);
  const tabelas = useQuery({ queryKey: ["tarifas", "tabelas-base"], queryFn: () => chamarApi<TabelaBaseCategoria[]>("GET", "/api/tarifas/tabelas-base") });

  const nomeDe = (id: string) => (todasCategorias.data ?? []).find((c) => c.id === id)?.nome ?? "—";
  const erroLeitura = categorias.erro ?? quartos.erro;

  const painelCategoria = (p: { item: CategoriaLinha | null; fechar: () => void }): ReactNode => {
    if (tabelas.isPending) return <p>Carregando…</p>;
    return (
      <PainelCategoria
        item={p.item}
        tabela={p.item ? tabelas.data?.find((t) => t.categoriaId === p.item!.id) : undefined}
        precosIndisponiveis={tabelas.error}
        fechar={p.fechar}
      />
    );
  };

  return (
    <div className="cq">
      <ErroAcao erro={erroLeitura} />
      <ListaCadastro<CategoriaLinha>
        titulo="Categorias"
        itens={categorias.itens}
        chave={(c) => c.id}
        mostrarInativos={inativasCategorias}
        aoMostrarInativos={setInativasCategorias}
        colunas={[
          { titulo: "Nome", celula: (c) => c.nome },
          { titulo: "Adultos", celula: (c) => c.maxAdultos },
          { titulo: "Crianças", celula: (c) => c.maxCriancas },
          { titulo: "Comodidades", celula: (c) => c.comodidades.join(", ") || "—" },
          {
            titulo: "Diária (2 adultos)",
            celula: (c) => {
              const t = tabelas.data?.find((x) => x.categoriaId === c.id);
              return t ? formatarReais(t.porAdultos[2]) : "—";
            },
          },
        ]}
        renderPainel={painelCategoria}
      />
      <div className="cq__barra">
        <label className="campo cq__filtro">
          Filtrar por categoria
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option value="">Todas as categorias</option>
            {categorias.ativas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </label>
        <Botao variante="secundario" disabled={categorias.ativas.length === 0} onClick={() => setLote(true)}>
          Criar vários quartos
        </Botao>
      </div>
      <ListaCadastro<QuartoLinha>
        titulo="Quartos"
        itens={quartos.itens}
        chave={(q) => q.id}
        mostrarInativos={inativosQuartos}
        aoMostrarInativos={setInativosQuartos}
        colunas={[
          { titulo: "Número", celula: (q) => q.numero },
          { titulo: "Categoria", celula: (q) => nomeDe(q.categoriaId) },
          { titulo: "Bloco", celula: (q) => q.bloco ?? "—" },
        ]}
        renderPainel={(p) => <PainelQuarto item={p.item} categorias={categorias.ativas} todas={todasCategorias.data ?? []} fechar={p.fechar} />}
      />
      <Gaveta aberta={lote} aoFechar={() => setLote(false)} titulo="Criar vários quartos">
        {lote && <PainelLote categorias={categorias.ativas} fechar={() => setLote(false)} />}
      </Gaveta>
    </div>
  );
}
