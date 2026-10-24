/** Mensagem do servidor exibida como veio, junto da ação que falhou. */
export function ErroAcao({ erro }: { erro: Error | null | undefined }) {
  if (!erro) return null;
  return (
    <p role="alert" className="erro-acao">
      {erro.message}
    </p>
  );
}
