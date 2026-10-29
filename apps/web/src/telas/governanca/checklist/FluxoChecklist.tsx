import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { chamarApi, ErroApi } from "../../../api/cliente";
import { useAcao } from "../../../api/consultas";
import type { Produto } from "../../../api/tipos";
import { useConexao } from "../../../api/useConexao";
import { Botao } from "../../../componentes/Botao";
import { ErroAcao } from "../../../componentes/ErroAcao";
import { Janela } from "../../../componentes/Janela";
import { formatarReais } from "../../../lib/dinheiro";
import { EtapaContagem } from "./EtapaContagem";
import { EtapaControles } from "./EtapaControles";
import { EtapaEquipamentos } from "./EtapaEquipamentos";
import { EtapaFrigobar } from "./EtapaFrigobar";
import { EtapaResultado } from "./EtapaResultado";
import { EtapaSimNao } from "./EtapaSimNao";
import { apagarRascunho, lerRascunho, salvarRascunho, type EstadoChecklist, type Resposta } from "./rascunho";
import "./checklist.css";

type Tipo = "saida" | "diaria";
type EtapaItens = "limpeza" | "enxoval" | "equipamento" | "controles";
type IdEtapa = EtapaItens | "frigobar" | "resultado";
type ItemModelo = { id: string; etapa: EtapaItens; texto: string; ordem: number };
type Modelos = { saida: ItemModelo[]; diaria: ItemModelo[]; produtosFrigobar: Produto[]; camareiraLancaFrigobar: boolean };

type Props = {
  quarto: { id: string; numero: string };
  tipo: Tipo;
  /** Situação do quarto agora ("sujo" na saída, "ocupado" na diária); um rascunho de outra situação é descartado. */
  situacaoAtual: string;
  aoConcluir: () => void;
  aoSair: () => void;
};

const ORDEM: IdEtapa[] = ["limpeza", "enxoval", "equipamento", "controles", "frigobar", "resultado"];
const MAX_BOTAO_ENXOVAL = 4;
const MAX_BOTAO_FRIGOBAR = 3;
const AVISO_REINICIADO = "O quarto mudou de situação; o checklist foi reiniciado.";

function titulo(e: IdEtapa, tipo: Tipo): string {
  switch (e) {
    case "limpeza": return "Limpeza";
    case "enxoval": return "Enxoval recolhido";
    case "equipamento": return "Equipamentos";
    case "controles": return "Controles";
    case "frigobar": return tipo === "diaria" ? "Consumo do hóspede" : "Reposição do frigobar";
    case "resultado": return "Resultado";
  }
}

function estadoInicial(quartoId: string, tipo: Tipo, situacaoAtual: string): { estado: EstadoChecklist; descartado: boolean } {
  const r = lerRascunho(quartoId, tipo);
  if (r && r.situacaoQuarto === situacaoAtual) {
    const { salvoEm: _, ...estado } = r;
    return { estado, descartado: false };
  }
  return {
    estado: { situacaoQuarto: situacaoAtual, iniciadoEm: new Date().toISOString(), etapa: "limpeza", respostas: {}, frigobar: {} },
    descartado: r !== null,
  };
}

/** O que impede "Liberado": limpeza com "Não" ou equipamento com defeito. */
function impedimentoDe(itens: ItemModelo[], respostas: Record<string, Resposta>): string | undefined {
  if (itens.some((i) => i.etapa === "limpeza" && respostas[i.id]?.simNao === false)) return "Há itens de limpeza marcados como Não";
  if (itens.some((i) => i.etapa === "equipamento" && respostas[i.id]?.equipamento === "nao_funciona")) return "Há chamado de defeito aberto";
  return undefined;
}

const semConexao = (e: unknown) => e instanceof ErroApi && e.codigo === "SEM_CONEXAO";

export function FluxoChecklist({ quarto, tipo, situacaoAtual, aoConcluir, aoSair }: Props) {
  const { online } = useConexao();
  const modelosQ = useQuery({ queryKey: ["checklist-modelos"], queryFn: () => chamarApi<Modelos>("GET", "/api/checklists/modelos") });
  const [inicio] = useState(() => estadoInicial(quarto.id, tipo, situacaoAtual));
  const [estado, setEstado] = useState<EstadoChecklist>(inicio.estado);
  const [pendentes, setPendentes] = useState<ReadonlySet<string>>(new Set());
  const emAndamento = useRef(new Map<string, Promise<void>>());
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const [erros, setErros] = useState<Record<string, Error | undefined>>({});
  const [confirmarCancelar, setConfirmarCancelar] = useState<{ id: string; valor: string } | null>(null);
  const concluir = useAcao((corpo: unknown) => chamarApi<{ execucaoId: string; totalFrigobar: number }>("POST", `/api/quartos/${encodeURIComponent(quarto.id)}/checklists`, corpo));

  useEffect(() => {
    salvarRascunho(quarto.id, tipo, estado);
  }, [quarto.id, tipo, estado]);

  const modelos = modelosQ.data;
  const itens = useMemo(() => (modelos ? modelos[tipo] : []), [modelos, tipo]);
  const impedimento = impedimentoDe(itens, estado.respostas);
  // "Liberado" que deixou de valer não fica escondido no rascunho nem é enviado.
  const liberadoInvalido = estado.resultado === "liberado" && impedimento !== undefined;
  useEffect(() => {
    if (liberadoInvalido) setEstado((s) => ({ ...s, resultado: undefined }));
  }, [liberadoInvalido]);
  const produtos = modelos?.produtosFrigobar ?? [];
  const lancaConsumo = tipo === "diaria" && modelos?.camareiraLancaFrigobar === true;
  const etapas = useMemo(() => {
    if (!modelos) return [] as IdEtapa[];
    return ORDEM.filter((e) => {
      if (e === "resultado") return tipo === "saida";
      if (e === "frigobar") return produtos.length > 0 && (tipo === "saida" || lancaConsumo);
      return itens.some((i) => i.etapa === e);
    });
  }, [modelos, itens, produtos.length, tipo, lancaConsumo]);

  if (!modelos) {
    return (
      <div className="checklist">
        {modelosQ.isError ? <ErroAcao erro={modelosQ.error} /> : <p>Carregando…</p>}
        <Botao variante="contorno" ignorarConexao onClick={aoSair}>Sair</Botao>
      </div>
    );
  }
  if (etapas.length === 0) {
    return (
      <div className="checklist">
        <p>Não há itens neste checklist.</p>
        <Botao variante="contorno" ignorarConexao onClick={aoSair}>Sair</Botao>
      </div>
    );
  }

  const respostas = estado.respostas;
  const itensDa = (e: EtapaItens) => itens.filter((i) => i.etapa === e);
  const indice = Math.max(0, etapas.indexOf(estado.etapa as IdEtapa));
  const etapa = etapas[indice]!;
  const ultima = indice === etapas.length - 1;

  const campoDe: Record<EtapaItens, keyof Resposta> = { limpeza: "simNao", enxoval: "quantidade", equipamento: "equipamento", controles: "presenca" };
  const respondido = (i: ItemModelo) => respostas[i.id]?.[campoDe[i.etapa]] !== undefined;
  const etapaCompleta = (e: IdEtapa): boolean => {
    if (e === "resultado") return true;
    if (e === "frigobar") return produtos.every((p) => estado.frigobar[p.id] !== undefined);
    return itensDa(e).every(respondido);
  };

  const quebrados = itensDa("equipamento").filter((i) => respostas[i.id]?.equipamento === "nao_funciona");
  const resultado = liberadoInvalido ? undefined : estado.resultado;
  const sugerido = quebrados.map((i) => `${i.texto} não funciona`).join("; ");
  const motivo = estado.motivoEditado ? (estado.motivo ?? "") : sugerido;

  const patch = (p: Partial<EstadoChecklist>) => setEstado((s) => ({ ...s, ...p }));
  const mudarResposta = (id: string, r: Partial<Resposta>) => setEstado((s) => ({ ...s, respostas: { ...s.respostas, [id]: { ...s.respostas[id], ...r } } }));
  const mudarErro = (id: string, e: Error | undefined) => setErros((x) => ({ ...x, [id]: e }));

  /** Uma chamada por item de cada vez; toques novos no mesmo item são ignorados enquanto ela não termina. */
  async function serializado(id: string, fn: () => Promise<void>) {
    if (emAndamento.current.has(id)) return;
    const execucao = fn().finally(() => {
      emAndamento.current.delete(id);
      setPendentes(new Set(emAndamento.current.keys()));
    });
    emAndamento.current.set(id, execucao);
    setPendentes(new Set(emAndamento.current.keys()));
    await execucao;
  }

  async function desfazer(id: string, r: Resposta | undefined) {
    if (r?.chamadoId) await chamarApi("POST", `/api/chamados/${encodeURIComponent(r.chamadoId)}/cancelar`);
    else if (r?.alertaId) await chamarApi("POST", `/api/avisos-controle/${encodeURIComponent(r.alertaId)}/cancelar`);
    mudarResposta(id, { chamadoId: undefined, alertaId: undefined });
  }

  /** Equipamento ("nao_funciona") e controle ("faltando") abrem chamado/aviso na hora; sair da opção cancela primeiro. */
  function escolher(item: ItemModelo, valor: string, confirmado = false) {
    const campo = campoDe[item.etapa] as "equipamento" | "presenca";
    const problema = item.etapa === "equipamento" ? "nao_funciona" : "faltando";
    const atual = respostas[item.id];
    if (emAndamento.current.has(item.id) || atual?.[campo] === valor) return;
    const registrado = atual?.chamadoId !== undefined || atual?.alertaId !== undefined;
    if (registrado && item.etapa === "equipamento" && !confirmado) {
      setConfirmarCancelar({ id: item.id, valor });
      return;
    }
    mudarErro(item.id, undefined);
    void serializado(item.id, async () => {
      if (registrado) {
        try {
          await desfazer(item.id, atual);
        } catch (e) {
          mudarErro(item.id, e as Error); // a resposta fica como estava
          return;
        }
      }
      mudarResposta(item.id, { [campo]: valor });
      // Equipamento e controle da saída só abrem o chamado depois (com a observação); o aviso da diária é imediato.
      if (valor !== problema || !online || item.etapa !== "controles" || tipo !== "diaria") return;
      try {
        const r = await chamarApi<{ alertaId: string }>("POST", `/api/quartos/${encodeURIComponent(quarto.id)}/avisos-controle`, { itemId: item.id });
        mudarResposta(item.id, { alertaId: r.alertaId });
      } catch (e) {
        if (!semConexao(e)) mudarErro(item.id, e as Error); // será criado ao concluir
      }
    });
  }

  const abreChamadoManual = (i: ItemModelo) => i.etapa === "equipamento" || (i.etapa === "controles" && tipo === "saida");
  const emProblema = (i: ItemModelo, r: Resposta | undefined) => (i.etapa === "equipamento" ? r?.equipamento === "nao_funciona" : r?.presenca === "faltando");

  /** Abre o chamado do item com a observação digitada; sem conexão ou com erro, ele nasce na conclusão. */
  function abrirChamado(item: ItemModelo): Promise<void> {
    return serializado(item.id, async () => {
      const r = estadoRef.current.respostas[item.id];
      if (!emProblema(item, r) || r?.chamadoId) return;
      mudarErro(item.id, undefined);
      const observacao = r?.observacao?.trim() || undefined;
      try {
        const c = await chamarApi<{ id: string }>("POST", `/api/quartos/${encodeURIComponent(quarto.id)}/chamados`, { itemId: item.id, observacao });
        mudarResposta(item.id, { chamadoId: c.id });
      } catch (e) {
        if (!semConexao(e)) mudarErro(item.id, e as Error);
      }
    });
  }

  /** Ao sair da etapa, abre os chamados que a pessoa deixou pendentes (espera os que já estão a caminho). */
  async function abrirPendentes() {
    for (const i of itens.filter((x) => x.etapa === etapa)) {
      if (!abreChamadoManual(i)) continue;
      await emAndamento.current.get(i.id);
      const r = estadoRef.current.respostas[i.id];
      if (online && emProblema(i, r) && !r?.chamadoId) await abrirChamado(i);
    }
  }
  async function irPara(destino: IdEtapa) {
    await abrirPendentes();
    patch({ etapa: destino });
  }
  async function sair() {
    await abrirPendentes();
    aoSair();
  }

  const itemPorId = (id: string) => itens.find((i) => i.id === id)!;
  const escolherPorId = (id: string, valor: string) => escolher(itemPorId(id), valor);

  const totalFrigobar = produtos.reduce((s, p) => s + (estado.frigobar[p.id] ?? 0) * p.precoCentavos, 0);
  const unidadesFrigobar = produtos.reduce((s, p) => s + (estado.frigobar[p.id] ?? 0), 0);
  const faltandoControles = itensDa("controles").filter((i) => respostas[i.id]?.presenca === "faltando").length;
  const chamadosPrevistos = quebrados.length + (tipo === "saida" ? faltandoControles : 0);
  const avisosPrevistos = tipo === "diaria" ? faltandoControles : 0;

  const tudoRespondido = etapas.every(etapaCompleta);
  const resultadoOk = tipo !== "saida" || (resultado === "liberado" || (resultado === "bloqueado" && motivo.trim() !== ""));
  const podeConcluir = tudoRespondido && resultadoOk;

  function escolherResultado(r: "liberado" | "bloqueado") {
    patch({ resultado: r });
  }

  function enviar() {
    const frigobarAtivo = etapas.includes("frigobar");
    const corpo = {
      tipo,
      iniciadoEm: estado.iniciadoEm,
      respostas: itens.map((i) => {
        const r = respostas[i.id] ?? {};
        const obs = r.observacao?.trim();
        return {
          itemId: i.id,
          [campoDe[i.etapa]]: r[campoDe[i.etapa]],
          ...(obs && (r.equipamento === "nao_funciona" || (tipo === "saida" && r.presenca === "faltando")) ? { observacao: obs } : {}),
          ...(r.chamadoId ? { chamadoId: r.chamadoId } : {}),
          ...(r.alertaId ? { alertaId: r.alertaId } : {}),
        };
      }),
      ...(frigobarAtivo ? { frigobar: produtos.map((p) => ({ produtoId: p.id, quantidade: estado.frigobar[p.id] ?? 0 })) } : {}),
      ...(tipo === "saida" ? { resultado, ...(resultado === "bloqueado" ? { motivo: motivo.trim() } : {}) } : {}),
    };
    concluir.mutate(corpo, {
      onSuccess: () => {
        apagarRascunho(quarto.id, tipo);
        aoConcluir();
      },
    });
  }

  const propsOpcoes = { pendentes, erros, online };
  const nomeDe = (id: string) => itemPorId(id);

  return (
    <div className="checklist">
      <header className="checklist__cabecalho">
        <p className="checklist__quarto">
          Quarto {quarto.numero} · {tipo === "saida" ? "Limpeza de saída" : "Arrumação"}
        </p>
        <p className="checklist__progresso">Etapa {indice + 1} de {etapas.length}</p>
      </header>
      {inicio.descartado && <p role="status" className="checklist__aviso">{AVISO_REINICIADO}</p>}
      <h2 className="checklist__titulo">{titulo(etapa, tipo)}</h2>

      {etapa === "limpeza" && <EtapaSimNao itens={itensDa("limpeza")} respostas={respostas} aoMudar={mudarResposta} />}
      {etapa === "enxoval" && (
        <EtapaContagem
          itens={itensDa("enxoval")}
          valores={Object.fromEntries(itensDa("enxoval").map((i) => [i.id, respostas[i.id]?.quantidade]))}
          maximoBotao={MAX_BOTAO_ENXOVAL}
          aoMudar={(id, n) => mudarResposta(id, { quantidade: n })}
        />
      )}
      {etapa === "equipamento" && (
        <EtapaEquipamentos
          {...propsOpcoes}
          itens={itensDa("equipamento")}
          respostas={respostas}
          aoEscolher={escolherPorId}
          aoObservar={(id, texto) => mudarResposta(id, { observacao: texto })}
          aoAbrir={(id) => void abrirChamado(itemPorId(id))}
        />
      )}
      {etapa === "controles" && <EtapaControles
          {...propsOpcoes}
          tipo={tipo}
          itens={itensDa("controles")}
          respostas={respostas}
          aoEscolher={escolherPorId}
          aoObservar={tipo === "saida" ? (id, texto) => mudarResposta(id, { observacao: texto }) : undefined}
          aoAbrir={tipo === "saida" ? (id) => void abrirChamado(itemPorId(id)) : undefined}
        />}
      {etapa === "frigobar" && (
        <EtapaFrigobar
          produtos={produtos}
          valores={estado.frigobar}
          mostrarPreco={lancaConsumo}
          aoMudar={(id, n) => setEstado((s) => ({ ...s, frigobar: { ...s.frigobar, [id]: n } }))}
        />
      )}
      {etapa === "resultado" && (
        <EtapaResultado resultado={resultado} motivo={motivo} impedimento={impedimento} aoEscolher={escolherResultado} aoMotivo={(t) => patch({ motivo: t, motivoEditado: true })} />
      )}

      {ultima && (
        <section className="checklist__resumo" aria-label="Resumo">
          <h3>Resumo</h3>
          <ul>
            <li>{itens.length} itens respondidos</li>
            {chamadosPrevistos > 0 && <li>Chamados: {chamadosPrevistos}</li>}
            {avisosPrevistos > 0 && <li>Recepção avisada: {avisosPrevistos}</li>}
            {etapas.includes("frigobar") && lancaConsumo && totalFrigobar > 0 && <li>Lançado na conta: {formatarReais(totalFrigobar)}</li>}
            {etapas.includes("frigobar") && tipo === "saida" && unidadesFrigobar > 0 && <li>Reposto no frigobar: {unidadesFrigobar} {unidadesFrigobar === 1 ? "unidade" : "unidades"}</li>}
            {tipo === "saida" && resultado && <li>Resultado: {resultado === "liberado" ? "Liberado" : "Bloqueado"}</li>}
          </ul>
        </section>
      )}

      <ErroAcao erro={concluir.error} />

      <div className="checklist__botoes">
        <Botao variante="contorno" ignorarConexao onClick={() => void sair()}>Sair</Botao>
        {indice > 0 && (
          <Botao variante="contorno" ignorarConexao onClick={() => void irPara(etapas[indice - 1]!)}>Voltar</Botao>
        )}
        {!ultima && (
          <Botao disabled={!etapaCompleta(etapa)} ignorarConexao onClick={() => void irPara(etapas[indice + 1]!)}>Próxima etapa</Botao>
        )}
        {ultima && <Botao disabled={!podeConcluir || concluir.isPending} onClick={enviar}>Concluir</Botao>}
      </div>

      <Janela aberta={confirmarCancelar !== null} aoFechar={() => setConfirmarCancelar(null)} titulo="Cancelar o chamado aberto?">
        {confirmarCancelar && (
          <>
            <p>O chamado de {nomeDe(confirmarCancelar.id).texto} será cancelado.</p>
            <div className="checklist__botoes">
              <Botao variante="contorno" ignorarConexao onClick={() => setConfirmarCancelar(null)}>Manter chamado</Botao>
              <Botao
                onClick={() => {
                  const c = confirmarCancelar;
                  setConfirmarCancelar(null);
                  escolher(nomeDe(c.id), c.valor, true);
                }}
              >
                Cancelar chamado
              </Botao>
            </div>
          </>
        )}
      </Janela>
    </div>
  );
}
