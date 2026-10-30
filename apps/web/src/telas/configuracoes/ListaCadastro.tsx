import { useState, type ReactNode } from "react";
import { Botao } from "../../componentes/Botao";
import { Etiqueta } from "../../componentes/Etiqueta";
import { Gaveta } from "../../componentes/Gaveta";

export type Coluna<T> = { titulo: string; celula: (item: T) => ReactNode };

type Props<T extends { ativo?: boolean | number }> = {
  titulo: string;
  itens: T[];
  colunas: Coluna<T>[];
  chave: (item: T) => string;
  /** Avisos opcionais; a abertura do painel é controlada pela própria lista. */
  aoNovo?: () => void;
  aoEditar?: (item: T) => void;
  mostrarInativos: boolean;
  aoMostrarInativos: (mostrar: boolean) => void;
  /** `item` é null ao criar; `fechar` fecha o painel (chamar depois de salvar). */
  renderPainel: (p: { item: T | null; fechar: () => void }) => ReactNode;
};

/** Padrão das telas de cadastro: tabela, "+ Novo", filtro de desativados e edição na Gaveta. */
export function ListaCadastro<T extends { ativo?: boolean | number }>({
  titulo, itens, colunas, chave, aoNovo, aoEditar, mostrarInativos, aoMostrarInativos, renderPainel,
}: Props<T>) {
  // `aberto` guarda o item em edição; `{ item: null }` é o painel de criação.
  const [aberto, setAberto] = useState<{ item: T | null } | null>(null);
  const fechar = () => setAberto(null);
  return (
    <section className="lista-cadastro" aria-label={titulo}>
      <header className="lista-cadastro__topo">
        <h1>{titulo}</h1>
        <label className="lista-cadastro__filtro">
          <input type="checkbox" checked={mostrarInativos} onChange={(e) => aoMostrarInativos(e.target.checked)} />
          Mostrar desativados
        </label>
        <Botao
          onClick={() => {
            aoNovo?.();
            setAberto({ item: null });
          }}
        >
          + Novo
        </Botao>
      </header>
      <div className="lista-cadastro__rolagem">
        <table className="lista-cadastro__tabela">
          <thead>
            <tr>
              {colunas.map((c) => (
                <th key={c.titulo} scope="col">{c.titulo}</th>
              ))}
              <th scope="col"><span className="lista-cadastro__oculto">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => {
              const inativo = item.ativo === false || item.ativo === 0;
              return (
                <tr key={chave(item)} className={inativo ? "lista-cadastro__linha--inativa" : undefined}>
                  {colunas.map((c, i) => (
                    <td key={c.titulo}>
                      {c.celula(item)}
                      {i === 0 && inativo && <> <Etiqueta>desativado</Etiqueta></>}
                    </td>
                  ))}
                  <td className="lista-cadastro__acoes">
                    <Botao
                      variante="contorno"
                      tamanho="pequeno"
                      onClick={() => {
                        aoEditar?.(item);
                        setAberto({ item });
                      }}
                    >
                      Editar
                    </Botao>
                  </td>
                </tr>
              );
            })}
            {itens.length === 0 && (
              <tr>
                <td colSpan={colunas.length + 1} className="lista-cadastro__vazio">Nada cadastrado ainda.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Gaveta aberta={aberto !== null} aoFechar={fechar} titulo={aberto?.item ? `Editar — ${titulo}` : `Novo — ${titulo}`}>
        {aberto && renderPainel({ item: aberto.item, fechar })}
      </Gaveta>
    </section>
  );
}
