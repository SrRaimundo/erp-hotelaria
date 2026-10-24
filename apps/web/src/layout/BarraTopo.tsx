import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useConexao } from "../api/useConexao";
import { useSessao } from "../auth/SessaoProvider";
import { Botao } from "../componentes/Botao";
import { Janela } from "../componentes/Janela";

export function BarraTopo() {
  const { pode } = useSessao();
  const { online } = useConexao();
  const navegar = useNavigate();
  const [busca, setBusca] = useState(false);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBusca(true);
      }
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, []);

  return (
    <header className="topo">
      <button type="button" className="topo__busca" onClick={() => setBusca(true)}>
        Buscar quarto, hóspede, CPF ou nº da reserva… (Ctrl+K)
      </button>
      <span data-conexao className={`topo__conexao ${online ? "topo__conexao--on" : "topo__conexao--off"}`}>
        {online ? "Online" : "Sem conexão"}
      </span>
      {pode("reservas.gerenciar") && <Botao onClick={() => void navegar("/reservas/nova")}>+ Nova reserva</Botao>}
      {/* Task 16 preenche o conteúdo da busca. */}
      <Janela aberta={busca} aoFechar={() => setBusca(false)} titulo="Buscar">
        {null}
      </Janela>
    </header>
  );
}
