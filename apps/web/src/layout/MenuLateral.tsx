import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { useConfig } from "../api/consultas";
import { useSessao } from "../auth/SessaoProvider";
import { Botao } from "../componentes/Botao";
import { emSubitemDe, GRUPOS_MENU, rotaDoItem } from "./menu";

function IconeEngrenagem() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function MenuLateral({ atencao }: { atencao: number }) {
  const { usuario, pode, sair } = useSessao();
  const { pathname } = useLocation();
  const config = useConfig();
  const marca = config.data?.nomeEstabelecimento?.trim() || config.data?.razaoSocial?.trim() || "ALICE";

  const grupos = GRUPOS_MENU.map((g) => ({ ...g, itens: g.itens.filter((i) => pode(i.permissao)) })).filter((g) => g.itens.length > 0);
  const grupoDaRota = grupos.find((g) => g.itens.some((i) => rotaDoItem(i.para, pathname)))?.id;
  const [abertos, setAbertos] = useState<string[]>(grupoDaRota ? [grupoDaRota] : []);
  // Navegar (inclusive por link de dentro das telas) abre o grupo da nova rota, sem fechar os que o usuário abriu.
  useEffect(() => {
    if (grupoDaRota) setAbertos((a) => (a.includes(grupoDaRota) ? a : [...a, grupoDaRota]));
  }, [grupoDaRota]);
  const alternar = (id: string) => setAbertos((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  // Com um único destino (ex.: governança) o menu não tem o que oferecer: ficam só o nome e o Sair.
  const simples = grupos.reduce((n, g) => n + g.itens.length, 0) <= 1;
  const podeConfigurar = pode("config.gerenciar");
  return (
    <aside className={simples ? "menu menu--simples" : "menu"}>
      <div className="menu__marca">{marca}</div>
      {!simples && (
        <nav aria-label="Menu principal" className="menu__itens">
          {grupos.map((g) => {
            const aberto = abertos.includes(g.id);
            return (
              <div key={g.id} className="menu__grupo">
                <button type="button" className="menu__grupo-cabecalho" aria-expanded={aberto} aria-controls={`menu-grupo-${g.id}`} onClick={() => alternar(g.id)}>
                  {g.rotulo}
                </button>
                {aberto && (
                  <div id={`menu-grupo-${g.id}`} className="menu__grupo-itens">
                    {g.itens.map((i) => (
                      <NavLink key={i.para} to={i.para} end={i.para === "/" || emSubitemDe(i.para, pathname)} className={i.subitem ? "menu__item menu__item--sub" : "menu__item"}>
                        {i.rotulo}
                        {i.para === "/" && atencao > 0 && (
                          <span className="menu__contador" aria-label={`${atencao} ${atencao === 1 ? "item" : "itens"} de atenção`}>
                            {atencao}
                          </span>
                        )}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      )}
      <div className="menu__rodape">
        <strong>{usuario?.nome}</strong>
        <span>{usuario?.perfil}</span>
        <div className="menu__acoes">
          <Botao variante="contorno" tamanho="pequeno" ignorarConexao onClick={() => void sair()}>
            Sair
          </Botao>
          {podeConfigurar && (
            <Link to="/configuracoes" className="menu__engrenagem" aria-label="Configurações" title="Configurações">
              <IconeEngrenagem />
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}
