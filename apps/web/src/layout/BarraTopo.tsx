import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useConexao } from "../api/useConexao";
import { useSessao } from "../auth/SessaoProvider";
import { Botao } from "../componentes/Botao";
import { Janela } from "../componentes/Janela";
import { BuscaUniversal } from "../telas/busca/BuscaUniversal";

export function BarraTopo() {
  const { pode } = useSessao();
  const { online } = useConexao();
  const navegar = useNavigate();
  const [busca, setBusca] = useState(false);
  const podeBuscar = pode("reservas.gerenciar");

  useEffect(() => {
    if (!podeBuscar) return;
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBusca(true);
      }
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [podeBuscar]);

  return (
    <header className="topo">
      {podeBuscar ? (
        <button type="button" className="topo__busca" onClick={() => setBusca(true)}>
          Buscar quarto, hóspede, CPF ou nº da reserva… (Ctrl+K)
        </button>
      ) : (
        <span className="topo__busca" />
      )}
      <span data-conexao className={`topo__conexao ${online ? "topo__conexao--on" : "topo__conexao--off"}`}>
        {online ? "Online" : "Sem conexão"}
      </span>
      {podeBuscar && <Botao onClick={() => void navegar("/reservas/nova")}>+ Nova reserva</Botao>}
      <Janela aberta={busca && podeBuscar} aoFechar={() => setBusca(false)} titulo="Buscar">
        <BuscaUniversal aoFechar={() => setBusca(false)} />
      </Janela>
    </header>
  );
}
