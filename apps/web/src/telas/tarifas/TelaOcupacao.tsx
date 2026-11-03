import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Dicas } from "../configuracoes/Dicas";
import { ListaCadastro } from "../configuracoes/ListaCadastro";
import { CampoPercentual } from "./CampoPercentual";
import { aposSalvarTarifa, useRegra, type FaixaOcupacao } from "./consultas";

const pct = (n: number) => `${String(n).replace(".", ",")}%`;

/** A rota substitui o conjunto inteiro: toda alteração envia a lista completa, já ordenada. */
const ordenar = (l: FaixaOcupacao[]) => [...l].sort((a, b) => a.acimaDe - b.acimaDe);

function Painel({ item, todas, fechar }: { item: FaixaOcupacao | null; todas: FaixaOcupacao[]; fechar: () => void }) {
  const cliente = useQueryClient();
  const [acimaDe, setAcimaDe] = useState<number | null>(item?.acimaDe ?? null);
  const [percentual, setPercentual] = useState<number | null>(item?.percentual ?? null);
  const outras = item ? todas.filter((f) => f.acimaDe !== item.acimaDe) : todas;
  const motivos = [
    ...(acimaDe === null ? ["Informe acima de quanto de ocupação a faixa vale."] : acimaDe > 100 ? ["A ocupação vai de 0 a 100%."] : outras.some((f) => f.acimaDe === acimaDe) ? ["Já existe uma faixa que começa nessa ocupação."] : []),
    ...(percentual === null ? ["Informe o ajuste."] : []),
  ];
  const enviar = useMutation<unknown, Error, FaixaOcupacao[]>({
    mutationFn: (lista) => chamarApi("PUT", "/api/tarifas/faixas-ocupacao", lista),
    onSuccess: async () => {
      await aposSalvarTarifa(cliente);
      fechar();
    },
  });
  return (
    <form className="formulario" onSubmit={(e) => { e.preventDefault(); if (motivos.length === 0) enviar.mutate(ordenar([...outras, { acimaDe: acimaDe!, percentual: percentual! }])); }}>
      <CampoPercentual rotulo="Acima de (% de ocupação)" valor={acimaDe} aoMudar={setAcimaDe} />
      <CampoPercentual rotulo="Ajuste (%)" aceitaNegativo valor={percentual} aoMudar={setPercentual} />
      <Dicas motivos={motivos} />
      <ErroAcao erro={enviar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={motivos.length > 0 || enviar.isPending}>Salvar</Botao>
      </div>
      {item && (
        <div className="cq__ativo">
          <Botao variante="contorno" disabled={enviar.isPending} onClick={() => enviar.mutate(ordenar(outras))}>Remover faixa</Botao>
        </div>
      )}
    </form>
  );
}

export function TelaOcupacao() {
  const q = useRegra<FaixaOcupacao[]>("faixas-ocupacao", "/api/tarifas/faixas-ocupacao");
  const lista = q.data ?? [];
  return (
    <>
      {q.isError && (
        <div className="cq__ativo">
          <ErroAcao erro={q.error} />
          <p className="tarifas__aviso">Enquanto a lista não carregar, não dá para criar nem editar faixas: salvar apagaria as que já existem.</p>
          <Botao variante="contorno" disabled={q.isFetching} onClick={() => void q.refetch()}>Tentar de novo</Botao>
        </div>
      )}
      <p className="tarifas__aviso">Quanto mais cheia a categoria na noite, maior o ajuste. Vale a faixa mais alta que a ocupação ultrapassou: com a faixa "acima de 80%", uma noite com exatamente 80% de ocupação não recebe o ajuste.</p>
      <ListaCadastro<FaixaOcupacao>
        titulo="Ocupação"
        itens={lista}
        chave={(f) => String(f.acimaDe)}
        rotuloNovo="+ Nova faixa"
        bloqueado={!q.isSuccess}
        colunas={[
          { titulo: "Acima de", celula: (f) => pct(f.acimaDe) },
          { titulo: "Ajuste", celula: (f) => pct(f.percentual) },
        ]}
        renderPainel={(p) => <Painel item={p.item} todas={lista} fechar={p.fechar} />}
      />
    </>
  );
}
