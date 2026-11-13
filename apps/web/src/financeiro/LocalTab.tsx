import { useState } from "react";
import { Botao } from "../componentes/Botao";
import { ErroAcao } from "../componentes/ErroAcao";
import { Etiqueta } from "../componentes/Etiqueta";
import { ListaCadastro } from "../telas/configuracoes/ListaCadastro";
import { CampoTexto, Estado } from "./comuns";
import { useLocais, useSalvarLocal, type Local } from "./useFinanceiro";
import "../telas/configuracoes/configuracoes.css";

function PainelLocal({ item, fechar }: { item: Local | null; fechar: () => void }) {
  const [nome, setNome] = useState(item?.nome ?? "");
  const [padrao, setPadrao] = useState(item?.hospedagem_padrao ?? false);
  const salvar = useSalvarLocal();
  const invalido = nome.trim() === "";
  return (
    <form
      className="formulario"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalido) return;
        salvar.mutate({ id: item?.id, nome: nome.trim(), hospedagem_padrao: padrao && !item?.hospedagem_padrao ? true : undefined }, { onSuccess: fechar });
      }}
    >
      <CampoTexto rotulo="Nome do local" valor={nome} aoMudar={setNome} />
      <label className="pousada__marcar">
        <input type="checkbox" checked={padrao} disabled={item?.hospedagem_padrao || (item !== null && !item.ativo)} onChange={(e) => setPadrao(e.target.checked)} />
        Recebe os lançamentos da hospedagem
      </label>
      <p className="fin__suave">Cada local é uma ilha: seus lançamentos, contas e faturas não se misturam com os dos outros.</p>
      <ErroAcao erro={salvar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={invalido || salvar.isPending}>Salvar</Botao>
      </div>
      {item && <AtivarDesativar item={item} fechar={fechar} />}
    </form>
  );
}

function AtivarDesativar({ item, fechar }: { item: Local; fechar: () => void }) {
  const alterar = useSalvarLocal();
  return (
    <div className="cq__ativo">
      <ErroAcao erro={alterar.error} />
      <Botao variante="contorno" disabled={alterar.isPending} onClick={() => alterar.mutate({ id: item.id, ativo: !item.ativo }, { onSuccess: fechar })}>
        {item.ativo ? "Desativar" : "Reativar"}
      </Botao>
    </div>
  );
}

export function LocalTab() {
  const [inativos, setInativos] = useState(false);
  const q = useLocais();
  const lista = (q.data ?? []).filter((l) => inativos || l.ativo);
  return (
    <Estado carregando={q.isLoading} erro={q.error}>
      <ListaCadastro
        titulo="Locais"
        itens={lista}
        chave={(l) => l.id}
        colunas={[
          { titulo: "Nome", celula: (l) => l.nome },
          { titulo: "Hospedagem", celula: (l) => (l.hospedagem_padrao ? <Etiqueta tom="verde">recebe a hospedagem</Etiqueta> : "—") },
        ]}
        inativo={(l) => !l.ativo}
        mostrarInativos={inativos}
        aoMostrarInativos={setInativos}
        rotuloNovo="+ Novo local"
        renderPainel={({ item, fechar }) => <PainelLocal item={item} fechar={fechar} />}
      />
    </Estado>
  );
}
