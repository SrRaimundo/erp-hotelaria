import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { ErroApi } from "../api/cliente";
import { destinoSeguro, useSessao } from "./SessaoProvider";

export function TrocarSenha() {
  const { usuario, trocarSenha } = useSessao();
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!usuario) return <Navigate to="/login?voltar=%2Ftrocar-senha" replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (nova.length < 6) return setErro("A nova senha deve ter pelo menos 6 caracteres.");
    if (nova !== confirmacao) return setErro("A confirmação não confere com a nova senha.");
    if (nova === atual) return setErro("A nova senha deve ser diferente da atual.");
    setErro(null);
    setEnviando(true);
    try {
      await trocarSenha(atual, nova);
      void navegar(destinoSeguro(params.get("voltar"), usuario!), { replace: true });
    } catch (x) {
      setErro(x instanceof ErroApi ? x.message : "Não foi possível trocar a senha. Tente de novo.");
      setEnviando(false);
    }
  }

  return (
    <main>
      <form onSubmit={(e) => void enviar(e)}>
        <h1>Trocar senha</h1>
        {usuario.trocarSenha && <p>Por segurança, defina uma nova senha antes de continuar.</p>}
        <label>
          Senha atual
          <input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" />
        </label>
        <label>
          Nova senha
          <input type="password" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" />
        </label>
        <label>
          Confirmar nova senha
          <input type="password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} autoComplete="new-password" />
        </label>
        {erro && <p role="alert">{erro}</p>}
        <button type="submit" disabled={enviando}>
          Salvar nova senha
        </button>
      </form>
    </main>
  );
}
