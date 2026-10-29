import { Outlet } from "react-router";
import { usePainel } from "../api/consultas";
import { useSessao } from "../auth/SessaoProvider";
import { BarraTopo } from "./BarraTopo";
import { FaixaConexao } from "./FaixaConexao";
import { MenuLateral } from "./MenuLateral";
import { GavetaReserva } from "../telas/reserva/GavetaReserva";

export function Shell() {
  const { pode } = useSessao();
  const painel = usePainel(pode("reservas.gerenciar"));
  return (
    <div className="shell">
      <MenuLateral atencao={painel.data ? painel.data.atencao.length + painel.data.numeros.defeitosAbertos : 0} />
      <div className="shell__coluna">
        <FaixaConexao />
        <BarraTopo />
        <main className="shell__conteudo">
          <Outlet />
        </main>
        <GavetaReserva />
      </div>
    </div>
  );
}
