import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ErroApi, chamarApi } from "../../api/cliente";
import { useAcao } from "../../api/consultas";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Janela } from "../../componentes/Janela";
import { JanelaSupervisor, type Autorizacao } from "../../componentes/JanelaSupervisor";
import { formatarData } from "../../lib/datas";
import { formatarReais } from "../../lib/dinheiro";
import type { Movimento } from "./usoArrastar";

type Previa = { valorAntigo: number; valorNovo: number; noites: { data: string; valor: number }[]; trocaCanal?: { mensagem: string } };
type Props = { movimento: Movimento; aoFechar: () => void };

const EXIGEM_SUPERVISOR = ["RESTRICAO_TARIFARIA", "SUPERVISOR_NECESSARIO"];

/** Campos da alteração (sem o id nem o tipo do gesto): o mesmo conjunto vai na prévia e no PATCH. */
function camposDe(m: Movimento) {
  const { reservaId: _r, tipo: _t, ...campos } = m;
  return campos;
}

/** Mostra o efeito do arrasto no preço e só grava ao confirmar; alterações com restrição pedem supervisor. */
export function JanelaPreviaAlteracao({ movimento, aoFechar }: Props) {
  const id = encodeURIComponent(movimento.reservaId);
  const campos = camposDe(movimento);
  const [pedirSupervisor, setPedirSupervisor] = useState(false);

  const previa = useQuery({
    queryKey: ["previa", movimento],
    queryFn: () => chamarApi<Previa>("GET", `/api/reservas/${id}/previa?${new URLSearchParams(campos as Record<string, string>)}`),
    retry: false,
    gcTime: 0,
  });
  const alterar = useAcao((corpo: Record<string, unknown>) => chamarApi("PATCH", `/api/reservas/${id}`, corpo));

  async function confirmar() {
    try {
      await alterar.mutateAsync(campos);
      aoFechar();
    } catch (e) {
      if (e instanceof ErroApi && EXIGEM_SUPERVISOR.includes(e.codigo)) setPedirSupervisor(true);
      // Os demais erros (QUARTO_INDISPONIVEL, NOITE_JA_LANCADA…) aparecem via alterar.error e nada muda.
    }
  }

  async function confirmarComSupervisor(autorizacao: Autorizacao) {
    await alterar.mutateAsync({ ...campos, autorizacao });
    aoFechar();
  }

  if (pedirSupervisor) {
    return (
      <JanelaSupervisor
        aberta
        titulo="Autorização do supervisor"
        aoCancelar={aoFechar}
        aoConfirmar={confirmarComSupervisor}
      />
    );
  }

  const dados = previa.data;
  return (
    <Janela aberta aoFechar={aoFechar} titulo="Alterar reserva">
      {previa.isPending && <p>Calculando…</p>}
      {previa.isError && <ErroAcao erro={new Error(`Não foi possível calcular a alteração. ${previa.error.message}`)} />}
      {dados && (
        <>
          <p>{`De ${formatarReais(dados.valorAntigo)} para ${formatarReais(dados.valorNovo)}`}</p>
          {dados.trocaCanal && <p role="status">{dados.trocaCanal.mensagem}</p>}
          <ul>
            {dados.noites.map((n) => (
              <li key={n.data}>
                <span>{formatarData(n.data)}</span> <span>{formatarReais(n.valor)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <ErroAcao erro={alterar.error} />
      <div className="formulario__acoes">
        <Botao variante="contorno" ignorarConexao onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao disabled={!dados || alterar.isPending} onClick={() => void confirmar()}>
          Confirmar
        </Botao>
      </div>
    </Janela>
  );
}
