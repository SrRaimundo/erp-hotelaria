import { Link } from "react-router";
import { useSessao } from "../../auth/SessaoProvider";
import { Cartao } from "../../componentes/Cartao";
import { CATALOGO, EM_BREVE } from "./catalogo";
import "./relatorios.css";

/** Catálogo em cartões; quem não tem a permissão do relatório não vê o cartão. */
export function TelaRelatorios() {
  const { pode } = useSessao();
  return (
    <div className="rel">
      <h1>Relatórios</h1>
      <div className="rel-catalogo">
        {CATALOGO.filter((r) => pode(r.permissao)).map((r) => (
          <Link key={r.id} to={`/relatorios/${r.id}`} className="rel-cartao-link">
            <Cartao className="rel-cartao">
              <h2>{r.nome}</h2>
              <p>{r.descricao}</p>
            </Cartao>
          </Link>
        ))}
      </div>
      <h2 className="rel-subtitulo">Em breve</h2>
      <ul className="rel-em-breve">
        {EM_BREVE.map((nome) => (
          <li key={nome}>{nome}</li>
        ))}
      </ul>
    </div>
  );
}
