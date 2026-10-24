import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { chamarApi, ErroApi } from "../../api/cliente";
import { useAcao, useCategorias, usePainel } from "../../api/consultas";
import type { Canal, ConfigPousada, Hospede, Quarto, Reserva } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { JanelaSupervisor, type Autorizacao } from "../../componentes/JanelaSupervisor";
import { somarDiasIso } from "../../lib/datas";
import { acomodacaoInicial, adultosValidos, CamposAcomodacao, dataValida, type Acomodacao } from "./CamposAcomodacao";
import { QuadroCotacao, type PedidoCotacao } from "./QuadroCotacao";
import { SeletorHospede } from "./SeletorHospede";
import "./nova-reserva.css";

type Linha = { id: number; aco: Acomodacao };
type Resultado = { reserva: Reserva } | { erro: string };
type PedidoSupervisor = { titulo: string; confirmar: (a: Autorizacao) => Promise<void>; cancelar: () => void };

const CODIGOS_SUPERVISOR = ["SUPERVISOR_NECESSARIO", "RESTRICAO_TARIFARIA"];

function lerDesconto(texto: string): number | null {
  if (texto.trim() === "") return 0;
  const n = Number(texto.trim().replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

export function TelaNovaReserva() {
  const [params] = useSearchParams();
  const navegar = useNavigate();
  const painel = usePainel();
  const categoriasQ = useCategorias();
  const quartosQ = useQuery({ queryKey: ["quartos"], queryFn: () => chamarApi<Quarto[]>("GET", "/api/quartos"), staleTime: 300_000, refetchInterval: false });
  const canaisQ = useQuery({ queryKey: ["canais"], queryFn: () => chamarApi<Canal[]>("GET", "/api/tarifas/canais"), staleTime: 300_000, refetchInterval: false });
  const configQ = useQuery({ queryKey: ["config"], queryFn: () => chamarApi<ConfigPousada>("GET", "/api/config"), staleTime: 300_000, refetchInterval: false });
  const categorias = categoriasQ.data ?? [];
  const quartos = quartosQ.data ?? [];
  const canais = canaisQ.data ?? [];

  const hospedeUrl = params.get("hospede");
  const hospedeQ = useQuery({
    queryKey: ["hospede", hospedeUrl],
    queryFn: () => chamarApi<Hospede>("GET", `/api/hospedes/${encodeURIComponent(hospedeUrl ?? "")}`),
    enabled: !!hospedeUrl,
    refetchInterval: false,
  });
  const [escolhido, setEscolhido] = useState<Hospede | null | undefined>(undefined);
  const titular = escolhido !== undefined ? escolhido : (hospedeQ.data ?? null);

  const [chegadaEsc, setChegadaEsc] = useState<string | null>(null);
  const [saidaEsc, setSaidaEsc] = useState<string | null>(null);
  const [canalEsc, setCanalEsc] = useState<string | null>(null);
  const [descontoTxt, setDescontoTxt] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [aco, setAco] = useState<Acomodacao>(acomodacaoInicial);
  const [grupo, setGrupo] = useState(false);
  const [cobranca, setCobranca] = useState<"unica" | "separada">("unica");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [resultados, setResultados] = useState<Record<number, Resultado>>({});
  const proximaLinha = useRef(1);
  const grupoCriado = useRef<{ id: string; titularId: string; cobranca: string } | null>(null);

  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<Error | null>(null);
  const [supervisor, setSupervisor] = useState<PedidoSupervisor | null>(null);
  const salvarReserva = useAcao((corpo: object) => chamarApi<Reserva>("POST", "/api/reservas", corpo));
  const salvarGrupo = useAcao((corpo: object) => chamarApi<{ id: string }>("POST", "/api/grupos", corpo));

  const chegada = chegadaEsc ?? params.get("chegada") ?? painel.data?.dia ?? "";
  const saida = saidaEsc ?? (dataValida(chegada) ? somarDiasIso(chegada, 1) : "");
  const canalNome = canalEsc ?? (canais.find((c) => c.nome === "Balcão") ?? canais[0])?.nome ?? "";
  const canal = canais.find((c) => c.nome === canalNome);
  const desconto = lerDesconto(descontoTxt);

  const quartoUrl = quartos.find((q) => q.id === params.get("quarto"));
  const resolver = (a: Acomodacao) => {
    const categoriaId = a.categoriaId ?? quartoUrl?.categoriaId ?? categorias[0]?.id ?? "";
    const quartoId = a.quartoId ?? (quartoUrl && quartoUrl.categoriaId === categoriaId ? quartoUrl.id : "");
    return { categoriaId, quartoId };
  };
  const principal = resolver(aco);

  let erroDatas: string | null = null;
  if (!chegada) erroDatas = painel.data || chegadaEsc !== null ? "Informe a data de chegada." : null;
  else if (!saida) erroDatas = "Informe a data de saída.";
  else if (!dataValida(chegada) || !dataValida(saida)) erroDatas = "Informe datas válidas.";
  else if (saida <= chegada) erroDatas = "A saída deve ser depois da chegada.";

  function pedidoDe(a: Acomodacao): PedidoCotacao | null {
    const { categoriaId } = resolver(a);
    const adultos = adultosValidos(a.adultos);
    if (!categoriaId || !canalNome || erroDatas || !chegada || !saida || adultos === null || !a.criancas.every(dataValida)) return null;
    return { categoriaId, chegada, saida, hospedes: { adultos, criancasNascimento: a.criancas }, canal: canalNome };
  }

  function errosDe(a: Acomodacao, sufixo: string): string[] {
    const e: string[] = [];
    if (adultosValidos(a.adultos) === null) e.push(`Informe ao menos 1 adulto${sufixo}.`);
    a.criancas.forEach((c, i) => {
      if (!dataValida(c)) e.push(`Informe a data de nascimento da criança ${i + 1}${sufixo}.`);
    });
    return e;
  }

  function validar(): string[] {
    const e: string[] = [];
    if (!titular) e.push("Escolha o hóspede titular.");
    if (erroDatas) e.push(erroDatas);
    if (desconto === null) e.push("O desconto deve estar entre 0 e 100.");
    if (!canalNome) e.push("Escolha o canal.");
    if (grupo) {
      if (linhas.length === 0) e.push("Adicione ao menos um quarto ao grupo.");
      linhas.forEach((l, i) => e.push(...errosDe(l.aco, ` (linha ${i + 1})`)));
    } else {
      e.push(...errosDe(aco, ""));
    }
    return e;
  }
  const erros = tentou ? validar().filter((m) => m !== erroDatas) : [];

  function pedirSupervisor<T>(titulo: string, reenviar: (a: Autorizacao) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      setSupervisor({
        titulo,
        confirmar: async (a) => {
          resolve(await reenviar(a)); // se falhar, a janela mostra o erro e continua aberta
          setSupervisor(null);
        },
        cancelar: () => {
          setSupervisor(null);
          reject(new Error("Autorização cancelada."));
        },
      });
    });
  }

  function corpoDe(a: Acomodacao, grupoId?: string): Record<string, unknown> {
    const { categoriaId, quartoId } = resolver(a);
    const corpo: Record<string, unknown> = {
      titularId: titular!.id,
      categoriaId,
      chegada,
      saida,
      adultos: adultosValidos(a.adultos),
      criancasNascimento: a.criancas,
      canal: canalNome,
    };
    if (quartoId) corpo.quartoId = quartoId;
    if (observacoes.trim()) corpo.observacoes = observacoes.trim();
    if (desconto) corpo.descontoPercentual = desconto;
    if (grupoId) corpo.grupoId = grupoId;
    return corpo;
  }

  /** Envia a reserva; se o servidor pedir supervisor, abre a janela e reenvia o mesmo corpo com `autorizacao`. */
  async function enviarReserva(corpo: Record<string, unknown>): Promise<Reserva> {
    try {
      return await salvarReserva.mutateAsync(corpo);
    } catch (e) {
      if (e instanceof ErroApi && CODIGOS_SUPERVISOR.includes(e.codigo)) {
        const titulo = e.codigo === "RESTRICAO_TARIFARIA" ? "Restrição de venda: autorização do supervisor" : "Autorização do supervisor";
        return pedirSupervisor(titulo, (autorizacao) => salvarReserva.mutateAsync({ ...corpo, autorizacao }));
      }
      throw e;
    }
  }

  async function reservar() {
    setTentou(true);
    if (validar().length > 0) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      const r = await enviarReserva(corpoDe(aco));
      void navegar(`/mapa?reserva=${encodeURIComponent(r.id)}`);
    } catch (e) {
      setErroEnvio(e instanceof Error ? e : new Error("Não foi possível reservar."));
    } finally {
      setEnviando(false);
    }
  }

  async function reservarGrupo() {
    setTentou(true);
    if (validar().length > 0) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      let g = grupoCriado.current;
      if (!g || g.titularId !== titular!.id || g.cobranca !== cobranca) {
        const nova = await salvarGrupo.mutateAsync({ titularId: titular!.id, cobranca });
        g = { id: nova.id, titularId: titular!.id, cobranca };
        grupoCriado.current = g;
      }
      for (const l of linhas) {
        if ("reserva" in (resultados[l.id] ?? {})) continue; // já criada numa tentativa anterior
        let resultado: Resultado;
        try {
          resultado = { reserva: await enviarReserva(corpoDe(l.aco, g.id)) };
        } catch (e) {
          resultado = { erro: e instanceof Error ? e.message : "Não foi possível reservar." };
        }
        setResultados((r) => ({ ...r, [l.id]: resultado }));
      }
    } catch (e) {
      setErroEnvio(e instanceof Error ? e : new Error("Não foi possível criar o grupo."));
    } finally {
      setEnviando(false);
    }
  }

  function alternarGrupo(ligado: boolean) {
    setGrupo(ligado);
    if (ligado && linhas.length === 0) {
      const { categoriaId, quartoId } = principal;
      setLinhas([{ id: proximaLinha.current++, aco: { ...aco, categoriaId, quartoId } }]);
    }
  }

  function adicionarLinha() {
    setLinhas((ls) => [...ls, { id: proximaLinha.current++, aco: { categoriaId: principal.categoriaId, quartoId: "", adultos: "2", criancas: [] } }]);
  }

  const criadas = linhas.flatMap((l) => {
    const r = resultados[l.id];
    return r && "reserva" in r ? [r.reserva] : [];
  });

  return (
    <div className="nova-reserva">
      <h1>Nova reserva</h1>
      <div className="nova-colunas">
        <form
          className="formulario nova-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void (grupo ? reservarGrupo() : reservar());
          }}
        >
          <SeletorHospede valor={titular} aoEscolher={setEscolhido} />

          <label className="checkin-opcao">
            <input type="checkbox" checked={grupo} onChange={(e) => alternarGrupo(e.target.checked)} />
            Reserva de grupo
          </label>
          {grupo && (
            <div className="campo">
              <label htmlFor="nova-cobranca">Cobrança</label>
              <select id="nova-cobranca" value={cobranca} onChange={(e) => setCobranca(e.target.value as "unica" | "separada")}>
                <option value="unica">Conta única</option>
                <option value="separada">Contas separadas</option>
              </select>
            </div>
          )}

          <div className="nova-datas">
            <div className="campo">
              <label htmlFor="nova-chegada">Chegada</label>
              <input
                id="nova-chegada"
                type="date"
                value={chegada}
                onChange={(e) => {
                  setChegadaEsc(e.target.value);
                  if (saidaEsc !== null && saidaEsc !== "" && saidaEsc <= e.target.value) setSaidaEsc(null);
                }}
              />
            </div>
            <div className="campo">
              <label htmlFor="nova-saida">Saída</label>
              <input id="nova-saida" type="date" value={saida} aria-invalid={erroDatas ? true : undefined} onChange={(e) => setSaidaEsc(e.target.value)} />
              {erroDatas && <span className="campo__erro" role="alert">{erroDatas}</span>}
            </div>
          </div>

          {!grupo && (
            <CamposAcomodacao valor={aco} categoriaId={principal.categoriaId} quartoId={principal.quartoId} categorias={categorias} quartos={quartos} aoMudar={setAco} />
          )}

          {grupo && (
            <div className="nova-linhas">
              {linhas.map((l, i) => {
                const r = resultados[l.id];
                const { categoriaId, quartoId } = resolver(l.aco);
                const sufixo = ` da linha ${i + 1}`;
                return (
                  <fieldset key={l.id} className="nova-linha">
                    <legend>Quarto {i + 1}</legend>
                    <CamposAcomodacao
                      sufixo={sufixo}
                      valor={l.aco}
                      categoriaId={categoriaId}
                      quartoId={quartoId}
                      categorias={categorias}
                      quartos={quartos}
                      aoMudar={(a) => setLinhas((ls) => ls.map((x) => (x.id === l.id ? { ...x, aco: a } : x)))}
                    />
                    {r && "reserva" in r && <p className="nova-ok">✓ #{r.reserva.codigo}</p>}
                    {r && "erro" in r && <p className="erro-acao" role="alert">{r.erro}</p>}
                    {!(r && "reserva" in r) && linhas.length > 1 && (
                      <Botao variante="contorno" tamanho="pequeno" aria-label={`Remover linha ${i + 1}`} onClick={() => setLinhas((ls) => ls.filter((x) => x.id !== l.id))}>
                        Remover quarto
                      </Botao>
                    )}
                  </fieldset>
                );
              })}
              <Botao variante="secundario" tamanho="pequeno" onClick={adicionarLinha}>
                + quarto
              </Botao>
            </div>
          )}

          <div className="nova-datas">
            <div className="campo">
              <label htmlFor="nova-canal">Canal</label>
              <select id="nova-canal" value={canalNome} onChange={(e) => setCanalEsc(e.target.value)}>
                {canais.map((c) => (
                  <option key={c.id} value={c.nome}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="nova-desconto">Desconto (%)</label>
              <input id="nova-desconto" inputMode="decimal" placeholder="0" value={descontoTxt} aria-invalid={desconto === null ? true : undefined} onChange={(e) => setDescontoTxt(e.target.value)} />
              {desconto === null && <span className="campo__erro">O desconto deve estar entre 0 e 100.</span>}
            </div>
          </div>
          <div className="campo">
            <label htmlFor="nova-obs">Observações</label>
            <textarea id="nova-obs" rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </div>

          {erros.length > 0 && (
            <ul className="nova-erros" role="alert">
              {erros.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          {erroEnvio && (
            <>
              <p>
                <strong>{grupo ? "Não foi possível reservar o grupo." : "Não foi possível reservar."}</strong>
              </p>
              <ErroAcao erro={erroEnvio} />
            </>
          )}
          <div className="formulario__acoes">
            <Botao type="submit" disabled={enviando}>
              {grupo ? "Reservar grupo" : "Reservar"}
            </Botao>
          </div>
        </form>

        <div className="nova-lateral">
          {!grupo && <QuadroCotacao pedido={pedidoDe(aco)} canal={canal} config={configQ.data} desconto={desconto ?? 0} />}
          {grupo &&
            linhas.map((l, i) => (
              <QuadroCotacao key={l.id} titulo={`Cotação do quarto ${i + 1}`} pedido={pedidoDe(l.aco)} canal={canal} config={configQ.data} desconto={desconto ?? 0} />
            ))}
          {grupo && criadas.length > 0 && (
            <section className="nova-grupo-criado" aria-label="Grupo criado">
              <h3>Grupo criado</h3>
              <ul>
                {criadas.map((r) => (
                  <li key={r.id}>
                    <Link to={`/mapa?reserva=${encodeURIComponent(r.id)}`}>#{r.codigo}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      <JanelaSupervisor
        aberta={supervisor !== null}
        titulo={supervisor?.titulo ?? "Autorização do supervisor"}
        aoCancelar={() => supervisor?.cancelar()}
        aoConfirmar={(a) => supervisor!.confirmar(a)}
      />
    </div>
  );
}
