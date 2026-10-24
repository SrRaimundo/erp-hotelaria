import { useEffect, useState, type FormEvent } from "react";
import { useGovernanca, useAcao } from "../../api/consultas";
import { chamarApi } from "../../api/cliente";
import type { ItemGovernanca } from "../../api/tipos";
import { useSessao } from "../../auth/SessaoProvider";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Janela } from "../../componentes/Janela";
import { useEsc } from "../../componentes/useEsc";
import { formatarData } from "../../lib/datas";
import "./governanca.css";

type Situacao = ItemGovernanca["situacao"];
type AcaoMotivo = "manutencao" | "bloquear" | "liberar";

const ROTULO_SITUACAO: Record<Situacao, string> = {
  livre: "livre",
  ocupado: "ocupado",
  sujo: "sujo",
  em_manutencao: "manutenção",
  bloqueado: "bloqueado",
};
const TOM: Record<Situacao, string> = { livre: "livre", ocupado: "ocupado", sujo: "sujo", em_manutencao: "inativo", bloqueado: "inativo" };
const ROTULO_ACAO: Record<AcaoMotivo, string> = { manutencao: "Manutenção", bloquear: "Bloquear", liberar: "Liberar" };

/** Só as transições que o servidor aceita a partir da situação atual. */
function transicoes(situacao: Situacao): AcaoMotivo[] {
  if (situacao === "livre") return ["manutencao", "bloquear"];
  if (situacao === "sujo") return ["manutencao"];
  if (situacao === "em_manutencao" || situacao === "bloqueado") return ["liberar"];
  return [];
}

export function TelaGovernanca() {
  const { pode } = useSessao();
  const governanca = useGovernanca();
  const [limpando, setLimpando] = useState<ItemGovernanca | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<{ quarto: ItemGovernanca; acao: AcaoMotivo } | null>(null);
  const podeManutencao = pode("quartos.manutencao");

  useEsc(menu !== null, () => setMenu(null));
  useEffect(() => {
    if (menu === null) return;
    // Clique fora do menu e do seu botão ⋯ fecha; o botão cuida do próprio abre/fecha.
    const fora = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest(".governanca__menu, .governanca__menu-botao")) return;
      setMenu(null);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [menu]);

  return (
    <div className="governanca">
      <h1>Governança</h1>
      {!governanca.data && (governanca.isError ? <ErroAcao erro={governanca.error} /> : <p>Carregando…</p>)}
      <ul className="governanca__grade">
        {(governanca.data ?? []).map((q) => {
          const opcoes = podeManutencao ? transicoes(q.situacao) : [];
          const comMenu = opcoes.length > 0 ? " governanca__cartao--com-menu" : "";
          const conteudo = (
            <>
              <span className="governanca__numero">{q.numero}</span>
              <span className="governanca__situacao">{ROTULO_SITUACAO[q.situacao]}</span>
              {q.hospedadoAte && <span className="governanca__ate">hospedado até {formatarData(q.hospedadoAte)}</span>}
            </>
          );
          return (
            <li key={q.quartoId} className="governanca__item">
              {q.situacao === "sujo" ? (
                <button type="button" className={`governanca__cartao governanca__cartao--${TOM[q.situacao]}${comMenu}`} onClick={() => setLimpando(q)}>
                  {conteudo}
                </button>
              ) : (
                <div className={`governanca__cartao governanca__cartao--${TOM[q.situacao]}${comMenu}`}>{conteudo}</div>
              )}
              {opcoes.length > 0 && (
                <>
                  <button type="button" className="governanca__menu-botao" aria-label={`Ações do quarto ${q.numero}`} aria-haspopup="menu" aria-expanded={menu === q.quartoId} onClick={() => setMenu(menu === q.quartoId ? null : q.quartoId)}>
                    ⋯
                  </button>
                  {menu === q.quartoId && (
                    <div role="menu" className="governanca__menu">
                      {opcoes.map((acao) => (
                        <button
                          key={acao}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenu(null);
                            setMotivo({ quarto: q, acao });
                          }}
                        >
                          {ROTULO_ACAO[acao]}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {limpando && <ConfirmarLimpo quarto={limpando} aoFechar={() => setLimpando(null)} />}
      {motivo && <PedirMotivo quarto={motivo.quarto} acao={motivo.acao} aoFechar={() => setMotivo(null)} />}
    </div>
  );
}

function ConfirmarLimpo({ quarto, aoFechar }: { quarto: ItemGovernanca; aoFechar: () => void }) {
  const limpar = useAcao(() => chamarApi("POST", `/api/quartos/${encodeURIComponent(quarto.quartoId)}/limpo`));
  const confirmar = () => limpar.mutate(undefined, { onSuccess: aoFechar });
  return (
    <Janela aberta aoFechar={aoFechar} titulo={`Marcar ${quarto.numero} como limpo?`}>
      <ErroAcao erro={limpar.error} />
      <div className="governanca__botoes">
        <Botao variante="contorno" ignorarConexao onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao onClick={confirmar} disabled={limpar.isPending}>
          Confirmar
        </Botao>
      </div>
    </Janela>
  );
}

function PedirMotivo({ quarto, acao, aoFechar }: { quarto: ItemGovernanca; acao: AcaoMotivo; aoFechar: () => void }) {
  const [texto, setTexto] = useState("");
  const [faltou, setFaltou] = useState(false);
  const enviar = useAcao((corpo: { motivo: string }) => chamarApi("POST", `/api/quartos/${encodeURIComponent(quarto.quartoId)}/${acao}`, corpo));
  const submeter = (e: FormEvent) => {
    e.preventDefault();
    if (!texto.trim()) {
      setFaltou(true);
      return;
    }
    enviar.mutate({ motivo: texto.trim() }, { onSuccess: aoFechar });
  };
  return (
    <Janela aberta aoFechar={aoFechar} titulo={`${ROTULO_ACAO[acao]} — quarto ${quarto.numero}`}>
      <form onSubmit={submeter} noValidate className="governanca__form">
        <label>
          Motivo
          <input value={texto} onChange={(e) => setTexto(e.target.value)} required aria-required="true" />
        </label>
        {faltou && !texto.trim() && <ErroAcao erro={new Error("Informe o motivo.")} />}
        <ErroAcao erro={enviar.error} />
        <div className="governanca__botoes">
          <Botao variante="contorno" ignorarConexao onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" disabled={enviar.isPending}>
            Confirmar
          </Botao>
        </div>
      </form>
    </Janela>
  );
}
