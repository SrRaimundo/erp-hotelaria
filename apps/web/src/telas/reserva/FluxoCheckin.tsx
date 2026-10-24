import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { chamarApi, ErroApi } from "../../api/cliente";
import { useAcao, useCategorias } from "../../api/consultas";
import type { Hospede, Quarto, ReservaDetalhe } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Etiqueta } from "../../componentes/Etiqueta";
import { Janela } from "../../componentes/Janela";
import { nomeCampoFnrh, pendenciasFnrh } from "../../lib/fnrh";
import { useAtrasado } from "../../lib/useAtrasado";
import { CadastroRapidoHospede } from "./CadastroRapidoHospede";

type Props = {
  reserva: ReservaDetalhe;
  /** Muda parâmetros da URL (undefined remove) preservando os demais. */
  aoMudarUrl: (mudancas: Record<string, string | undefined>) => void;
};

type Cadastro = { inicial?: Partial<Hospede>; titulo: string } | null;
type Corpo = { quartoId: string; acompanhantes: string[]; cobrarEarlyCheckin: boolean };

const ATRASO_BUSCA_MS = 300;
const ATRASO_VOLTA_MS = 1200;

export function FluxoCheckin({ reserva, aoMudarUrl }: Props) {
  const categorias = useCategorias();
  const sugeridos = useQuery({
    queryKey: ["quartos-sugeridos", reserva.id],
    queryFn: () => chamarApi<Quarto[]>("GET", `/api/reservas/${encodeURIComponent(reserva.id)}/quartos-sugeridos`),
  });
  const [upgrade, setUpgrade] = useState(false);
  const outros = useQuery({
    queryKey: ["quartos"],
    queryFn: () => chamarApi<Quarto[]>("GET", "/api/quartos"),
    enabled: upgrade,
  });
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [acompanhantes, setAcompanhantes] = useState<Hospede[]>([]);
  const [faltasServidor, setFaltasServidor] = useState<Record<string, string[]>>({});
  const [busca, setBusca] = useState("");
  const [cadastro, setCadastro] = useState<Cadastro>(null);
  const [cobrar, setCobrar] = useState(true);
  const [erro, setErro] = useState<Error | null>(null);
  const [concluido, setConcluido] = useState<string | null>(null);

  const termo = useAtrasado(busca.trim(), ATRASO_BUSCA_MS);
  const achados = useQuery({
    queryKey: ["hospedes", termo],
    queryFn: () => chamarApi<Hospede[]>("GET", `/api/hospedes?q=${encodeURIComponent(termo)}`),
    enabled: termo.length >= 2,
  });

  const checkin = useAcao((corpo: Corpo) => chamarApi("POST", `/api/reservas/${encodeURIComponent(reserva.id)}/checkin`, corpo));

  // Depois do sucesso, deixa a confirmação visível um instante e volta ao resumo.
  useEffect(() => {
    if (concluido === null) return;
    const t = setTimeout(() => aoMudarUrl({ fluxo: undefined, aba: "resumo" }), ATRASO_VOLTA_MS);
    return () => clearTimeout(t);
    // aoMudarUrl muda a cada render da gaveta; o temporizador só depende da conclusão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concluido]);

  const nomeCategoria = (id: string) => categorias.data?.find((c) => c.id === id)?.nome;
  const rotuloQuarto = (q: Quarto) => `Qto ${q.numero}${nomeCategoria(q.categoriaId) ? ` · ${nomeCategoria(q.categoriaId)}` : ""}`;
  const quartosSugeridos = [...(sugeridos.data ?? [])].sort((a, b) => Number(b.id === reserva.quartoId) - Number(a.id === reserva.quartoId));
  const quartosUpgrade = (outros.data ?? []).filter((q) => q.situacao === "livre" && q.categoriaId !== reserva.categoriaId);
  const quartoId = escolhido ?? (quartosSugeridos.find((q) => q.id === reserva.quartoId) ?? quartosSugeridos[0])?.id ?? null;
  const quarto = [...quartosSugeridos, ...quartosUpgrade].find((q) => q.id === quartoId);

  const faltasDe = (h: Hospede): string[] =>
    faltasServidor[h.id] ?? (h.id === reserva.titularId ? reserva.titular.pendenciasFnrh : pendenciasFnrh(h, reserva.chegada));

  function adicionar(h: Hospede) {
    setAcompanhantes((atual) => (atual.some((a) => a.id === h.id) ? atual.map((a) => (a.id === h.id ? h : a)) : [...atual, h]));
    setBusca("");
  }
  function salvouCadastro(h: Hospede) {
    setFaltasServidor(({ [h.id]: _resolvida, ...resto }) => resto);
    if (h.id !== reserva.titularId) adicionar(h); // o titular é atualizado pela reserva, que o useAcao refaz
    setCadastro(null);
  }

  async function concluir() {
    if (!quarto) return;
    setErro(null);
    try {
      await checkin.mutateAsync({ quartoId: quarto.id, acompanhantes: acompanhantes.map((a) => a.id), cobrarEarlyCheckin: cobrar });
      setConcluido(quarto.numero);
    } catch (x) {
      const e = x instanceof Error ? x : new Error("Não foi possível concluir o check-in.");
      if (e instanceof ErroApi && e.codigo === "FNRH_INCOMPLETA" && e.detalhes && typeof e.detalhes === "object") {
        setFaltasServidor(e.detalhes as Record<string, string[]>);
      }
      setErro(e);
    }
  }

  if (concluido !== null) {
    return (
      <p role="status" className="checkin-ok">
        {`Check-in concluído · Qto ${concluido}`}
      </p>
    );
  }

  const naLista = new Set([reserva.titularId, ...acompanhantes.map((a) => a.id)]);
  const candidatos = (achados.data ?? []).filter((h) => !naLista.has(h.id));

  function pessoa(h: Hospede, papel: string, removivel: boolean) {
    const falta = faltasDe(h);
    return (
      <li key={h.id} className={falta.length > 0 ? "reserva-pessoa checkin-pessoa--pendente" : "reserva-pessoa"}>
        <div className="reserva-pessoa__texto">
          <strong>{h.nome}</strong>
          <span className="reserva-suave">{papel}</span>
          {falta.length > 0 && <span className="checkin-faltas">{`Faltam: ${falta.map(nomeCampoFnrh).join(", ")}`}</span>}
        </div>
        <div className="checkin-pessoa__acoes">
          {falta.length === 0 ? (
            <Etiqueta tom="verde">FNRH completa</Etiqueta>
          ) : (
            <Botao variante="contorno" tamanho="pequeno" aria-label={`Completar ${h.nome}`} onClick={() => setCadastro({ inicial: h, titulo: "Completar cadastro" })}>
              Completar
            </Botao>
          )}
          {removivel && (
            <Botao variante="contorno" tamanho="pequeno" aria-label={`Remover ${h.nome}`} onClick={() => setAcompanhantes((atual) => atual.filter((a) => a.id !== h.id))}>
              Remover
            </Botao>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="checkin">
      <h3>Check-in</h3>

      <section aria-labelledby="checkin-quarto" className="checkin-secao">
        <h4 id="checkin-quarto">Quarto</h4>
        {sugeridos.error && <ErroAcao erro={sugeridos.error} />}
        {sugeridos.isPending && !sugeridos.error && <p className="reserva-suave">Carregando quartos…</p>}
        {sugeridos.data && quartosSugeridos.length === 0 && (
          <p className="reserva-suave">Nenhum quarto limpo da categoria reservada está disponível. Use outra categoria (upgrade).</p>
        )}
        {quartosSugeridos.map((q) => (
          <label key={q.id} className="checkin-opcao">
            <input type="radio" name="quarto" checked={quartoId === q.id} onChange={() => setEscolhido(q.id)} />
            {`${rotuloQuarto(q)}${q.id === reserva.quartoId ? " (atribuído)" : ""}`}
          </label>
        ))}
        <label className="checkin-opcao">
          <input
            type="checkbox"
            checked={upgrade}
            onChange={(e) => {
              setUpgrade(e.target.checked);
              if (!e.target.checked && quartosUpgrade.some((q) => q.id === quartoId)) setEscolhido(null);
            }}
          />
          Outra categoria (upgrade)
        </label>
        {upgrade && outros.error && <ErroAcao erro={outros.error} />}
        {upgrade && outros.isPending && !outros.error && <p className="reserva-suave">Carregando quartos…</p>}
        {upgrade && outros.data && quartosUpgrade.length === 0 && <p className="reserva-suave">Nenhum quarto livre em outra categoria.</p>}
        {upgrade &&
          quartosUpgrade.map((q) => (
            <label key={q.id} className="checkin-opcao">
              <input type="radio" name="quarto" checked={quartoId === q.id} onChange={() => setEscolhido(q.id)} />
              {`${rotuloQuarto(q)} (upgrade — preço mantido)`}
            </label>
          ))}
      </section>

      <section aria-labelledby="checkin-hospedes" className="checkin-secao">
        <h4 id="checkin-hospedes">Hóspedes</h4>
        <ul className="reserva-pessoas">
          {pessoa(reserva.titular as Hospede, "Titular", false)}
          {acompanhantes.map((a) => pessoa(a, "Acompanhante", true))}
        </ul>
        <div className="campo">
          <label htmlFor="checkin-busca">Buscar acompanhante (nome ou CPF)</label>
          <input id="checkin-busca" value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" />
        </div>
        {termo.length >= 2 && achados.error && <ErroAcao erro={achados.error} />}
        {termo.length >= 2 && achados.data && candidatos.length === 0 && <p className="reserva-suave">Nenhum hóspede encontrado.</p>}
        {candidatos.length > 0 && (
          <ul className="checkin-achados">
            {candidatos.map((h) => (
              <li key={h.id}>
                <Botao variante="contorno" tamanho="pequeno" aria-label={`Adicionar ${h.nome}`} onClick={() => adicionar(h)}>
                  {`${h.nome}${h.documento ? ` · ${h.documento}` : ""}`}
                </Botao>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Botao variante="contorno" onClick={() => setCadastro({ titulo: "Cadastrar hóspede" })}>Cadastrar novo</Botao>
        </div>
      </section>

      <section aria-labelledby="checkin-confirmar" className="checkin-secao">
        <h4 id="checkin-confirmar">Confirmar</h4>
        <label className="checkin-opcao">
          <input type="checkbox" checked={cobrar} onChange={(e) => setCobrar(e.target.checked)} />
          Cobrar early check-in, se aplicável
        </label>
        <ErroAcao erro={erro} />
        <div className="formulario__acoes">
          <Botao variante="contorno" ignorarConexao onClick={() => aoMudarUrl({ fluxo: undefined })}>Cancelar</Botao>
          <Botao disabled={!quarto || checkin.isPending} onClick={() => void concluir()}>Concluir check-in</Botao>
        </div>
      </section>

      <Janela aberta={cadastro !== null} aoFechar={() => setCadastro(null)} titulo={cadastro?.titulo ?? "Cadastrar hóspede"}>
        {cadastro && <CadastroRapidoHospede inicial={cadastro.inicial} aoSalvar={salvouCadastro} aoCancelar={() => setCadastro(null)} />}
      </Janela>
    </div>
  );
}
