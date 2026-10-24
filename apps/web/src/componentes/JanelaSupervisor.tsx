import { useId, useState, type FormEvent } from "react";
import { Botao } from "./Botao";
import { ErroAcao } from "./ErroAcao";
import { Janela } from "./Janela";

export type Autorizacao = { motivo: string; supervisor: { login: string; senha: string } };
type Props = {
  aberta: boolean;
  titulo: string;
  aoCancelar: () => void;
  aoConfirmar: (a: Autorizacao) => Promise<void>;
};

function Formulario({ aoCancelar, aoConfirmar }: Pick<Props, "aoCancelar" | "aoConfirmar">) {
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
    try {
      await aoConfirmar({ motivo: motivo.trim(), supervisor: { login, senha } });
    } catch (x) {
      setErro(x instanceof Error ? x : new Error("Não foi possível autorizar."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={(e) => void enviar(e)} className="formulario">
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

export function JanelaSupervisor({ aberta, titulo, aoCancelar, aoConfirmar }: Props) {
  return (
    <Janela aberta={aberta} aoFechar={aoCancelar} titulo={titulo}>
      <Formulario aoCancelar={aoCancelar} aoConfirmar={aoConfirmar} />
    </Janela>
  );
}
