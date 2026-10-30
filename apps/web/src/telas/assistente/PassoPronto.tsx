import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { chamarApi } from "../../api/cliente";
import { Botao } from "../../componentes/Botao";
import type { EstadoAssistente } from "./Assistente";

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Passo 4: resumo e atalhos. */
export function PassoPronto({ estado, aoVoltar }: { estado: EstadoAssistente; aoVoltar: () => void }) {
  const navegar = useNavigate();
  const usuarios = useQuery({ queryKey: ["usuarios"], queryFn: () => chamarApi<{ ativo: boolean }[]>("GET", "/api/usuarios") });
  const quartos = estado.categorias.reduce((soma, c) => soma + c.quartos.length, 0);
  const ativos = usuarios.data?.filter((u) => u.ativo).length;
  return (
    <section className="pousada__secao" aria-labelledby="assistente-pronto">
      <h2 id="assistente-pronto">Pronto</h2>
      <p>
        {plural(estado.categorias.length, "categoria", "categorias")} · {plural(quartos, "quarto", "quartos")}
        {ativos !== undefined && ` · ${plural(ativos, "usuário ativo", "usuários ativos")}`}
      </p>
      <p className="cq__aviso">A pousada já pode receber reservas.</p>
      <div className="assistente__acoes">
        <Botao variante="contorno" onClick={aoVoltar}>Voltar</Botao>
        <div className="assistente__acoes-direita">
          <Botao variante="contorno" onClick={() => void navegar("/configuracoes/pousada")}>Ajustar regras da pousada</Botao>
          <Botao onClick={() => void navegar("/mapa")}>Ir para o mapa</Botao>
        </div>
      </div>
    </section>
  );
}
