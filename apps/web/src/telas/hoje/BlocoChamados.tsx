import { useState, type FormEvent } from "react";
import { chamarApi } from "../../api/cliente";
import { useAcao } from "../../api/consultas";
import type { Painel } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Janela } from "../../componentes/Janela";

type Chamado = Painel["chamadosAbertos"][number];
type Dialogo = { tipo: "resolver" | "liberar"; chamado: Chamado };

const MOTIVO_LIBERAR = "Liberado após resolução do chamado";

/** "há X min" (< 1 h), "há X h" (< 1 dia), "há X dia(s)"; relógio do navegador, só para exibir. */
export function tempoRelativo(iso: string, agora = Date.now()): string {
  const min = Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

export function BlocoChamados({ chamados }: { chamados: Chamado[] }) {
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  // Depois de resolvido o chamado sai do painel; a linha fica aqui até o quarto ser liberado.
  const [liberaveis, setLiberaveis] = useState<Chamado[]>([]);
  const abertos = chamados.filter((c) => !liberaveis.some((l) => l.id === c.id));
  const linhas = [...abertos, ...liberaveis];
  if (linhas.length === 0 && !dialogo) return null;
  const fechar = () => setDialogo(null);
  const retirar = (id: string) => setLiberaveis((atual) => atual.filter((c) => c.id !== id));

  return (
    <section className="hoje-atencao" aria-labelledby="hoje-chamados-titulo">
      <h2 id="hoje-chamados-titulo">{`Chamados abertos (${abertos.length})`}</h2>
      <ul className="hoje-lista">
        {linhas.map((c) => {
          const liberavel = liberaveis.some((l) => l.id === c.id);
          return (
            <li key={c.id} className="hoje-atencao__item">
              <div className="hoje-linha__texto">
                <strong>{`${c.tipo === "defeito" ? "Defeito" : "Reposição"} · Qto ${c.quartoNumero} · ${c.descricao}`}</strong>
                {c.observacao && <span className="hoje-suave">{c.observacao}</span>}
                <span className="hoje-suave">{`por ${c.abertoPorNome} ${tempoRelativo(c.abertoEm)}`}</span>
              </div>
              <div className="hoje-atencao__acoes">
                <Botao variante="contorno" tamanho="pequeno" onClick={() => setDialogo({ tipo: liberavel ? "liberar" : "resolver", chamado: c })}>
                  {liberavel ? "Liberar quarto" : "Resolvido"}
                </Botao>
              </div>
            </li>
          );
        })}
      </ul>
      {dialogo?.tipo === "resolver" && (
        <JanelaResolver chamado={dialogo.chamado} aoFechar={fechar} aoResolver={(podeLiberar) => podeLiberar && setLiberaveis((a) => [...a, dialogo.chamado])} />
      )}
      {dialogo?.tipo === "liberar" && <JanelaLiberar chamado={dialogo.chamado} aoFechar={fechar} aoLiberar={() => retirar(dialogo.chamado.id)} />}
    </section>
  );
}

function JanelaResolver({ chamado, aoFechar, aoResolver }: { chamado: Chamado; aoFechar: () => void; aoResolver: (podeLiberar: boolean) => void }) {
  const [observacao, setObservacao] = useState("");
  const resolver = useAcao((corpo: { observacao?: string }) =>
    chamarApi<{ podeLiberar: boolean }>("POST", `/api/chamados/${encodeURIComponent(chamado.id)}/resolver`, corpo),
  );
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const texto = observacao.trim();
    resolver.mutate(texto ? { observacao: texto } : {}, {
      onSuccess: (r) => {
        aoResolver(r.podeLiberar);
        aoFechar();
      },
    });
  };
  return (
    <Janela aberta aoFechar={aoFechar} titulo={`Resolver chamado — quarto ${chamado.quartoNumero}`}>
      <form onSubmit={enviar} className="governanca__form">
        <label>
          Observação (opcional)
          <input value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </label>
        <ErroAcao erro={resolver.error} />
        <div className="governanca__botoes">
          <Botao variante="contorno" ignorarConexao onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" disabled={resolver.isPending}>Confirmar</Botao>
        </div>
      </form>
    </Janela>
  );
}

function JanelaLiberar({ chamado, aoFechar, aoLiberar }: { chamado: Chamado; aoFechar: () => void; aoLiberar: () => void }) {
  const [motivo, setMotivo] = useState(MOTIVO_LIBERAR);
  const [faltou, setFaltou] = useState(false);
  const liberar = useAcao((corpo: { motivo: string }) => chamarApi("POST", `/api/quartos/${encodeURIComponent(chamado.quartoId)}/liberar`, corpo));
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!motivo.trim()) {
      setFaltou(true);
      return;
    }
    liberar.mutate({ motivo: motivo.trim() }, { onSuccess: () => { aoLiberar(); aoFechar(); } });
  };
  return (
    <Janela aberta aoFechar={aoFechar} titulo={`Liberar quarto — quarto ${chamado.quartoNumero}`}>
      <form onSubmit={enviar} noValidate className="governanca__form">
        <label>
          Motivo
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} required aria-required="true" />
        </label>
        {faltou && !motivo.trim() && <ErroAcao erro={new Error("Informe o motivo.")} />}
        <ErroAcao erro={liberar.error} />
        <div className="governanca__botoes">
          <Botao variante="contorno" ignorarConexao onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" disabled={liberar.isPending}>Confirmar</Botao>
        </div>
      </form>
    </Janela>
  );
}
