import { useState } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";

type Props = { rotulo: string; aviso: string; remocao: UseMutationResult<unknown, Error, void>; desabilitado?: boolean };

/** Remoção em dois passos: o primeiro clique só pergunta; o servidor responde junto do botão de confirmar. */
export function ConfirmarRemocao({ rotulo, aviso, remocao, desabilitado = false }: Props) {
  const [perguntando, setPerguntando] = useState(false);
  return (
    <div className="cq__ativo">
      <ErroAcao erro={remocao.error} />
      {perguntando ? (
        <>
          <p className="tarifas__aviso" role="status">{aviso}</p>
          <div className="formulario__acoes">
            <Botao variante="contorno" ignorarConexao onClick={() => setPerguntando(false)}>Cancelar</Botao>
            <Botao disabled={remocao.isPending} onClick={() => remocao.mutate()}>Confirmar remoção</Botao>
          </div>
        </>
      ) : (
        <Botao variante="contorno" disabled={desabilitado || remocao.isPending} onClick={() => setPerguntando(true)}>{rotulo}</Botao>
      )}
    </div>
  );
}
