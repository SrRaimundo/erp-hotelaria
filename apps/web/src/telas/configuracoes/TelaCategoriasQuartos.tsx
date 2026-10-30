import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { chamarApi, ErroApi } from "../../api/cliente";
import type { Categoria, Quarto, TabelaBaseCategoria } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { CampoDinheiro } from "../../componentes/CampoDinheiro";
import { useSessao } from "../../auth/SessaoProvider";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Gaveta } from "../../componentes/Gaveta";
import { formatarReais } from "../../lib/dinheiro";
import { ListaCadastro } from "./ListaCadastro";
import "./configuracoes.css";

const MAX_LOTE = 200;
/** Telas que mostram quartos/categorias (ou dados derivados deles) e precisam recarregar após uma mudança. */
const CHAVES_AFETADAS = ["categorias", "quartos", "tarifas", "mapa", "governanca", "painel"];
const invalidarAfetadas = (cliente: QueryClient) => Promise.all(CHAVES_AFETADAS.map((k) => cliente.invalidateQueries({ queryKey: [k] })));

const inteiro = (t: string, minimo: number): number | null => (/^\d+$/.test(t.trim()) && Number(t) >= minimo ? Number(t) : null);
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** O valor aparece na mensagem como palavra inteira (101 não conta como 10). */
const citado = (mensagem: string, valor: string) => new RegExp(`(^|[^\\p{L}\\p{N}-])${escapar(valor)}($|[^\\p{L}\\p{N}-])`, "u").test(mensagem);

/** Mensagem do servidor junto da ação, mais os códigos/números de `detalhes` que a mensagem ainda não cita. */
function ErroComDetalhes({ erro }: { erro: Error | null | undefined }) {
  if (!erro) return null;
  const detalhes = erro instanceof ErroApi && typeof erro.detalhes === "object" && erro.detalhes !== null ? (erro.detalhes as Record<string, unknown>) : {};
  const rotulos: Record<string, string> = { codigos: "Reservas", numeros: "Quartos em conflito" };
  const extras = Object.entries(rotulos).flatMap(([chave, rotulo]) => {
    const valores = detalhes[chave];
    if (!Array.isArray(valores)) return [];
    const faltam = valores.map(String).filter((v) => !citado(erro.message, v));
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

/** Motivos pelos quais o botão de salvar está desligado, ditos ao usuário. */
function Dicas({ motivos }: { motivos: string[] }) {
  if (motivos.length === 0) return null;
  return (
    <ul className="cq__aviso cq__dicas">
      {motivos.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
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
function AcaoAtivo({ caminho, ativo, aoConcluir }: { caminho: string; ativo: boolean; aoConcluir: () => void }) {
  const cliente = useQueryClient();
  const alternar = useMutation<unknown, Error>({
    mutationFn: () => chamarApi("POST", `${caminho}/${ativo ? "desativar" : "reativar"}`),
    onSuccess: async () => {
      await invalidarAfetadas(cliente);
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

/** `precos`: o usuário tem tarifas.gerenciar (senão a seção some); `erroPrecos`: a carga dos preços falhou. */
function PainelCategoria({ item, tabela, precos: comPermissao, erroPrecos, fechar }: { item: Categoria | null; tabela: TabelaBaseCategoria | undefined; precos: boolean; erroPrecos: Error | null; fechar: () => void }) {
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
  const comPrecos = comPermissao && erroPrecos === null;
  const precoOk = preco.p1 !== null && preco.p2 !== null && preco.p3 !== null && preco.extra !== null;
  const faixaOk = preco.piso === null || preco.teto === null || preco.piso <= preco.teto;
  const motivos = [
    ...(nome.trim() === "" ? ["Informe o nome da categoria."] : []),
    ...(maxAdultos === null ? ["Máximo de adultos: informe um número inteiro, de 1 em diante."] : []),
    ...(maxCriancas === null ? ["Máximo de crianças: informe um número inteiro, de 0 em diante."] : []),
    ...(comPrecos && !precoOk ? ["Informe os preços para 1, 2 e 3 adultos e o adulto extra."] : []),
    ...(comPrecos && !faixaOk ? ["O piso não pode ser maior que o teto."] : []),
  ];
  const valido = motivos.length === 0;

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
    onSettled: () => invalidarAfetadas(cliente),
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
      {comPermissao && (
        <fieldset className="pousada__grupo">
          <legend>Preço base da diária</legend>
          {erroPrecos !== null && (
            <>
              <ErroAcao erro={erroPrecos} />
              <p className="cq__aviso">Os preços não puderam ser carregados; só os dados da categoria serão salvos.</p>
            </>
          )}
          {comPrecos && (
            <div className="cq__grade">
              <CampoDinheiro rotulo="Diária para 1 adulto" valor={preco.p1} aoMudar={(p1) => mudarPreco({ p1 })} />
              <CampoDinheiro rotulo="Diária para 2 adultos" valor={preco.p2} aoMudar={(p2) => mudarPreco({ p2 })} />
              <CampoDinheiro rotulo="Diária para 3 adultos" valor={preco.p3} aoMudar={(p3) => mudarPreco({ p3 })} />
              <CampoDinheiro rotulo="Adulto extra" valor={preco.extra} aoMudar={(extra) => mudarPreco({ extra })} />
              <CampoDinheiro rotulo="Piso" valor={preco.piso} aoMudar={(piso) => mudarPreco({ piso })} />
              <CampoDinheiro rotulo="Teto" valor={preco.teto} aoMudar={(teto) => mudarPreco({ teto })} />
            </div>
          )}
        </fieldset>
      )}
      <Dicas motivos={motivos} />
      <ErroComDetalhes erro={salvar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={!valido || salvar.isPending}>Salvar</Botao>
      </div>
      {item && <AcaoAtivo caminho={`/api/categorias/${item.id}`} ativo={item.ativo} aoConcluir={fechar} />}
    </form>
  );
}

// ---------- quartos ----------

function PainelQuarto({ item, categorias, todas, fechar }: { item: Quarto | null; categorias: Categoria[]; todas: Categoria[]; fechar: () => void }) {
  const cliente = useQueryClient();
  const [numero, setNumero] = useState(item?.numero ?? "");
  const [categoriaId, setCategoriaId] = useState(item?.categoriaId ?? "");
  const [bloco, setBloco] = useState(item?.bloco ?? "");
  // Só categorias ativas; a categoria atual do quarto fica na lista mesmo se estiver desativada, para não trocá-la sem querer.
  const atual = item && !categorias.some((c) => c.id === item.categoriaId) ? todas.find((c) => c.id === item.categoriaId) : undefined;
  const opcoes = atual ? [atual, ...categorias] : categorias;
  const motivos = [...(numero.trim() === "" ? ["Informe o número do quarto."] : []), ...(categoriaId === "" ? ["Escolha a categoria."] : [])];
  const valido = motivos.length === 0;

  const salvar = useMutation<unknown, Error>({
    mutationFn: () => {
      const b = bloco.trim();
      if (item) return chamarApi("PUT", `/api/quartos/${item.id}`, { numero: numero.trim(), categoriaId, bloco: b === "" ? null : b });
      return chamarApi("POST", "/api/quartos", { numero: numero.trim(), categoriaId, ...(b === "" ? {} : { bloco: b }) });
    },
    onSuccess: async () => {
      await invalidarAfetadas(cliente);
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
          {!item && <option value="" disabled>Escolha…</option>}
          {opcoes.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
      </label>
      <CampoTexto rotulo="Bloco" valor={bloco} aoMudar={setBloco} />
      <Dicas motivos={motivos} />
      <ErroComDetalhes erro={salvar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={!valido || salvar.isPending}>Salvar</Botao>
      </div>
      {item && <AcaoAtivo caminho={`/api/quartos/${item.id}`} ativo={item.ativo} aoConcluir={fechar} />}
    </form>
  );
}

function PainelLote({ categorias, fechar }: { categorias: Categoria[]; fechar: () => void }) {
  const cliente = useQueryClient();
  const [categoriaId, setCategoriaId] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [bloco, setBloco] = useState("");
  const inicio = inteiro(de, 0);
  const fim = inteiro(ate, 0);
  const motivos = [
    ...(categoriaId === "" ? ["Escolha a categoria."] : []),
    ...(inicio === null ? ["De: informe o primeiro número (inteiro, 0 em diante)."] : []),
    ...(fim === null ? ["Até: informe o último número (inteiro, 0 em diante)."] : []),
    ...(inicio !== null && fim !== null && fim < inicio ? ["O número final deve ser maior ou igual ao inicial."] : []),
    ...(inicio !== null && fim !== null && fim >= inicio && fim - inicio + 1 > MAX_LOTE ? [`No máximo ${MAX_LOTE} quartos por vez.`] : []),
  ];
  const valido = motivos.length === 0;

  const criar = useMutation<unknown, Error>({
    mutationFn: () => chamarApi("POST", "/api/quartos/lote", { categoriaId, de: inicio, ate: fim, ...(bloco.trim() === "" ? {} : { bloco: bloco.trim() }) }),
    onSuccess: async () => {
      await invalidarAfetadas(cliente);
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
          <option value="" disabled>Escolha…</option>
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
      <Dicas motivos={motivos} />
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

  const { pode } = useSessao();
  const verPrecos = pode("tarifas.gerenciar");

  // O servidor informa `ativo`; uma única leitura de cada lista (com desativados) alimenta tudo e a tela filtra.
  const categoriasQ = useQuery({ queryKey: ["categorias"], queryFn: () => chamarApi<Categoria[]>("GET", "/api/categorias?incluirInativos=1") });
  const quartosQ = useQuery({ queryKey: ["quartos"], queryFn: () => chamarApi<Quarto[]>("GET", "/api/quartos?incluirInativos=1") });
  const tabelas = useQuery({ queryKey: ["tarifas", "tabelas-base"], queryFn: () => chamarApi<TabelaBaseCategoria[]>("GET", "/api/tarifas/tabelas-base"), enabled: verPrecos });

  const todasCategorias = categoriasQ.data ?? [];
  const ativas = todasCategorias.filter((c) => c.ativo);
  // Filtro cuja categoria saiu das opções (desativada, por exemplo) volta a "todas".
  const filtroAtual = ativas.some((c) => c.id === filtro) ? filtro : "";
  const categoriasLista = inativasCategorias ? todasCategorias : ativas;
  const quartosLista = (quartosQ.data ?? []).filter((q) => (inativosQuartos || q.ativo) && (filtroAtual === "" || q.categoriaId === filtroAtual));

  const nomeDe = (id: string) => todasCategorias.find((c) => c.id === id)?.nome ?? "—";
  const erroLeitura = categoriasQ.error ?? quartosQ.error;

  const painelCategoria = (p: { item: Categoria | null; fechar: () => void }): ReactNode => {
    if (verPrecos && tabelas.isPending) return <p>Carregando…</p>;
    return (
      <PainelCategoria
        item={p.item}
        tabela={p.item ? tabelas.data?.find((t) => t.categoriaId === p.item!.id) : undefined}
        precos={verPrecos}
        erroPrecos={tabelas.error}
        fechar={p.fechar}
      />
    );
  };

  return (
    <div className="cq">
      <ErroAcao erro={erroLeitura} />
      <ListaCadastro<Categoria>
        titulo="Categorias"
        itens={categoriasLista}
        chave={(c) => c.id}
        inativo={(c) => !c.ativo}
        mostrarInativos={inativasCategorias}
        aoMostrarInativos={setInativasCategorias}
        colunas={[
          { titulo: "Nome", celula: (c) => c.nome },
          { titulo: "Adultos", celula: (c) => c.maxAdultos },
          { titulo: "Crianças", celula: (c) => c.maxCriancas },
          { titulo: "Comodidades", celula: (c) => c.comodidades.join(", ") || "—" },
          ...(verPrecos
            ? [
                {
                  titulo: "Diária (2 adultos)",
                  celula: (c: Categoria) => {
                    const t = tabelas.data?.find((x) => x.categoriaId === c.id);
                    return t ? formatarReais(t.porAdultos[2]) : "—";
                  },
                },
              ]
            : []),
        ]}
        renderPainel={painelCategoria}
      />
      <div className="cq__barra">
        <label className="campo cq__filtro">
          Filtrar por categoria
          <select value={filtroAtual} onChange={(e) => setFiltro(e.target.value)}>
            <option value="">Todas as categorias</option>
            {ativas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </label>
        <Botao variante="secundario" disabled={ativas.length === 0} onClick={() => setLote(true)}>
          Criar vários quartos
        </Botao>
      </div>
      <ListaCadastro<Quarto>
        titulo="Quartos"
        itens={quartosLista}
        chave={(q) => q.id}
        inativo={(q) => !q.ativo}
        mostrarInativos={inativosQuartos}
        aoMostrarInativos={setInativosQuartos}
        colunas={[
          { titulo: "Número", celula: (q) => q.numero },
          { titulo: "Categoria", celula: (q) => nomeDe(q.categoriaId) },
          { titulo: "Bloco", celula: (q) => q.bloco ?? "—" },
        ]}
        renderPainel={(p) => <PainelQuarto item={p.item} categorias={ativas} todas={todasCategorias} fechar={p.fechar} />}
      />
      <Gaveta aberta={lote} aoFechar={() => setLote(false)} titulo="Criar vários quartos">
        {lote && <PainelLote categorias={ativas} fechar={() => setLote(false)} />}
      </Gaveta>
    </div>
  );
}
