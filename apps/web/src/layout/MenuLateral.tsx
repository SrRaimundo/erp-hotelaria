import { NavLink } from "react-router";
import { useSessao } from "../auth/SessaoProvider";
import { Botao } from "../componentes/Botao";

const ITENS: { para: string; rotulo: string; permissao?: string; algumaDe?: string[] }[] = [
  { para: "/", rotulo: "Hoje", permissao: "reservas.gerenciar" },
  { para: "/mapa", rotulo: "Mapa", permissao: "reservas.gerenciar" },
  { para: "/reservas", rotulo: "Reservas", permissao: "reservas.gerenciar" },
  { para: "/caixa", rotulo: "Caixa", permissao: "caixa.operar" },
  { para: "/governanca", rotulo: "Governança", permissao: "quartos.situacao" },
  { para: "/configuracoes", rotulo: "Configurações", algumaDe: ["config.gerenciar", "cadastros.gerenciar"] },
];

export function MenuLateral({ atencao }: { atencao: number }) {
  const { usuario, pode, sair } = useSessao();
  const visiveis = ITENS.filter((i) => (i.algumaDe ? i.algumaDe.some(pode) : pode(i.permissao ?? "")));
  // Com um único destino (ex.: governança) o menu não tem o que oferecer: ficam só o nome e o Sair.
  // Exceção: se o único destino é Configurações, o link precisa continuar visível.
  const simples = visiveis.length <= 1 && visiveis[0]?.para !== "/configuracoes";
  return (
    <aside className={simples ? "menu menu--simples" : "menu"}>
      <div className="menu__marca">Pousada</div>
      {!simples && (
      <nav aria-label="Menu principal" className="menu__itens">
        {visiveis.map((i) => (
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
      )}
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
