import { NavLink } from "react-router";
import { useSessao } from "../auth/SessaoProvider";
import { Botao } from "../componentes/Botao";

const ITENS = [
  { para: "/", rotulo: "Hoje", permissao: "reservas.gerenciar" },
  { para: "/mapa", rotulo: "Mapa", permissao: "reservas.gerenciar" },
  { para: "/reservas", rotulo: "Reservas", permissao: "reservas.gerenciar" },
  { para: "/caixa", rotulo: "Caixa", permissao: "caixa.operar" },
  { para: "/governanca", rotulo: "Governança", permissao: "quartos.situacao" },
];

export function MenuLateral({ atencao }: { atencao: number }) {
  const { usuario, pode, sair } = useSessao();
  return (
    <aside className="menu">
      <div className="menu__marca">Pousada</div>
      <nav aria-label="Menu principal" className="menu__itens">
        {ITENS.filter((i) => pode(i.permissao)).map((i) => (
          <NavLink key={i.para} to={i.para} end={i.para === "/"} className="menu__item">
            {i.rotulo}
            {i.para === "/" && atencao > 0 && (
              <span className="menu__contador" aria-label={`${atencao} ${atencao === 1 ? "item" : "itens"} de atenção`}>
                {atencao}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="menu__rodape">
        <strong>{usuario?.nome}</strong>
        <span>{usuario?.perfil}</span>
        <Botao variante="contorno" tamanho="pequeno" ignorarConexao onClick={() => void sair()}>
          Sair
        </Botao>
      </div>
    </aside>
  );
}
