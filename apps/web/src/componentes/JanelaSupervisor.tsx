import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Botao } from "./Botao";
import { ErroAcao } from "./ErroAcao";
import { Janela } from "./Janela";

export type Autorizacao = { motivo: string; supervisor: { login: string; senha: string } };
type Props = {
  aberta: boolean;
  titulo: string;
  aoCancelar: () => void;
  aoConfirmar: (a: Autorizacao) => Promise<void>;
  /** Texto de aviso mostrado acima do formulário (ex.: o que a ação vai e não vai desfazer). */
  aviso?: ReactNode;
};

function Formulario({ aoCancelar, aoConfirmar, aoEnviando, aviso }: Pick<Props, "aoCancelar" | "aoConfirmar" | "aviso"> & { aoEnviando: (v: boolean) => void }) {
  const id = useId();
  const [motivo, setMotivo] = useState("");
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<Error | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!motivo.trim()) {
      setErro(new Error("Informe o motivo."));
      return;
    }
    setErro(null);
    setEnviando(true);
    aoEnviando(true);
    try {
      await aoConfirmar({ motivo: motivo.trim(), supervisor: { login, senha } });
    } catch (x) {
      setErro(x instanceof Error ? x : new Error("Não foi possível autorizar."));
    } finally {
      setEnviando(false);
      aoEnviando(false);
    }
  }

  return (
    <form onSubmit={(e) => void enviar(e)} className="formulario">
      {aviso}
      <label htmlFor={`${id}-motivo`}>Motivo</label>
      <textarea id={`${id}-motivo`} value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
      <label htmlFor={`${id}-login`}>Login do supervisor</label>
      <input id={`${id}-login`} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
      <label htmlFor={`${id}-senha`}>Senha do supervisor</label>
      <input id={`${id}-senha`} type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" />
      <ErroAcao erro={erro} />
      <div className="formulario__acoes">
        <Botao variante="contorno" ignorarConexao onClick={aoCancelar}>
          Cancelar
        </Botao>
        <Botao type="submit" disabled={enviando}>
          Autorizar
        </Botao>
      </div>
    </form>
  );
}

export function JanelaSupervisor({ aberta, titulo, aoCancelar, aoConfirmar, aviso }: Props) {
  const [enviando, setEnviando] = useState(false);
  // Durante o envio, Esc e × não fecham a janela (evita perder o resultado da autorização).
  return (
    <Janela aberta={aberta} aoFechar={() => !enviando && aoCancelar()} titulo={titulo}>
      <Formulario aoCancelar={aoCancelar} aoConfirmar={aoConfirmar} aoEnviando={setEnviando} aviso={aviso} />
    </Janela>
  );
}
