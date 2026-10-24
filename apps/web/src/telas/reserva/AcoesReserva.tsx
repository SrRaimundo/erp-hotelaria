import { useState } from "react";
import { chamarApi } from "../../api/cliente";
import { useAcao, usePainel } from "../../api/consultas";
import type { ReservaDetalhe } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { JanelaSupervisor, type Autorizacao } from "../../componentes/JanelaSupervisor";
import { ProrrogarSinal } from "../../componentes/ProrrogarSinal";
import { JanelaAlterarReserva } from "./JanelaAlterarReserva";

type Props = {
  reserva: ReservaDetalhe;
  /** Muda parâmetros da URL (undefined remove) preservando os demais. */
  aoMudarUrl: (mudancas: Record<string, string | undefined>) => void;
};
type Pendente = "cancelar" | "no-show" | "prorrogar" | "alterar" | null;

export function AcoesReserva({ reserva, aoMudarUrl }: Props) {
  const [pendente, setPendente] = useState<Pendente>(null);
  const painel = usePainel();
  const base = `/api/reservas/${encodeURIComponent(reserva.id)}`;
  const cancelar = useAcao((a: Autorizacao) => chamarApi("POST", `${base}/cancelar`, a));
  const noShow = useAcao((a: Autorizacao) => chamarApi("POST", `${base}/no-show`, a));
  const prorrogar = useAcao((c: Autorizacao & { novoPrazo: string }) => chamarApi("POST", `${base}/prorrogar-sinal`, c));
  const fechar = () => setPendente(null);

  const em = (estado: ReservaDetalhe["estado"]) => reserva.estado === estado;
  const podeNoShow = em("confirmada") && painel.data !== undefined && reserva.chegada < painel.data.dia;
  if (!em("pre_reserva") && !em("confirmada") && !em("hospedada")) return null;

  return (
    <div className="reserva-acoes">
      {em("pre_reserva") && (
        <>
          <Botao onClick={() => aoMudarUrl({ aba: "conta", fluxo: undefined, receber: String(Math.max(0, reserva.valorSinal - reserva.pago)) })}>Registrar sinal</Botao>
          <Botao variante="contorno" onClick={() => setPendente("prorrogar")}>Prorrogar sinal</Botao>
          <Botao variante="contorno" onClick={() => setPendente("cancelar")}>Cancelar reserva</Botao>
        </>
      )}
      {em("confirmada") && (
        <>
          <Botao onClick={() => aoMudarUrl({ fluxo: "checkin", receber: undefined })}>Fazer check-in</Botao>
          <Botao variante="contorno" onClick={() => setPendente("cancelar")}>Cancelar reserva</Botao>
          {podeNoShow && <Botao variante="contorno" onClick={() => setPendente("no-show")}>Marcar no-show</Botao>}
        </>
      )}
      {em("hospedada") && (
        <>
          <Botao variante="contorno" onClick={() => aoMudarUrl({ aba: "conta", fluxo: undefined, receber: undefined })}>Lançar extra</Botao>
          <Botao onClick={() => aoMudarUrl({ fluxo: "checkout", receber: undefined })}>Fazer check-out</Botao>
        </>
      )}
      <Botao variante="contorno" onClick={() => setPendente("alterar")}>Alterar</Botao>
      {pendente === "alterar" && <JanelaAlterarReserva reserva={reserva} aoFechar={fechar} />}
      <JanelaSupervisor
        aberta={pendente === "cancelar"}
        titulo="Cancelar reserva"
        aoCancelar={fechar}
        aoConfirmar={async (a) => {
          await cancelar.mutateAsync(a);
          fechar();
        }}
      />
      <JanelaSupervisor
        aberta={pendente === "no-show"}
        titulo="Marcar no-show"
        aoCancelar={fechar}
        aoConfirmar={async (a) => {
          await noShow.mutateAsync(a);
          fechar();
        }}
      />
      <ProrrogarSinal
        aberta={pendente === "prorrogar"}
        aoCancelar={fechar}
        aoConfirmar={async (novoPrazo, a) => {
          await prorrogar.mutateAsync({ ...a, novoPrazo });
          fechar();
        }}
      />
    </div>
  );
}
