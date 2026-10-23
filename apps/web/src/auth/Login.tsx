import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router";
import { ErroApi } from "../api/cliente";
import { destinoSeguro, useSessao } from "./SessaoProvider";

export function Login() {
  const { usuario, entrar } = useSessao();
  const [params] = useSearchParams();
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (usuario) return <Navigate to={destinoSeguro(params.get("voltar"), usuario)} replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(login.trim(), senha);
    } catch (x) {
      setErro(x instanceof ErroApi ? x.message : "Não foi possível entrar. Tente de novo.");
      setEnviando(false);
    }
  }

  return (
    <main>
      <form onSubmit={(e) => void enviar(e)}>
        <h1>Entrar</h1>
        <label>
          Login
          <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoFocus />
        </label>
        <label>
          Senha
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
        </label>
        {erro && <p role="alert">{erro}</p>}
        <button type="submit" disabled={enviando}>
          Entrar
        </button>
      </form>
    </main>
  );
}
