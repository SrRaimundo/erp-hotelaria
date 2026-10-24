import { useConexao } from "../api/useConexao";

export function FaixaConexao() {
  const { online } = useConexao();
  if (online) return null;
  return (
    <div role="status" className="faixa-conexao">
      Sem conexão com o servidor da pousada — tentando novamente…
    </div>
  );
}
