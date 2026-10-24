import { useId, useState, type FormEvent, type ReactElement } from "react";
import { chamarApi, ErroApi } from "../../api/cliente";
import { useAcao } from "../../api/consultas";
import type { Hospede } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";

type Props = {
  inicial?: Partial<Hospede>;
  aoSalvar: (h: Hospede) => void;
  aoCancelar: () => void;
};

type Erros = Partial<Record<string, string>>;

/** Campo da API (zod) -> campo da tela. */
const CAMPO_TELA: Record<string, string> = { "endereco.cidade": "cidade", "endereco.uf": "uf" };

function errosDe(e: Error): { campos: Erros; geral: Error | null } {
  if (!(e instanceof ErroApi)) return { campos: {}, geral: e };
  if (e.codigo === "CPF_INVALIDO" || e.codigo === "DOCUMENTO_DUPLICADO") return { campos: { documento: e.message }, geral: null };
  if (e.codigo === "DADOS_INVALIDOS" && Array.isArray(e.detalhes)) {
    const campos: Erros = {};
    for (const c of e.detalhes as { campo: string; mensagem: string }[]) campos[CAMPO_TELA[c.campo] ?? c.campo] ??= c.mensagem;
    return { campos, geral: Object.keys(campos).length > 0 ? null : e };
  }
  return { campos: {}, geral: e };
}

/** Cadastro com os campos da FNRH. Com `inicial.id` atualiza o hóspede; sem id cria um novo. */
export function CadastroRapidoHospede({ inicial, aoSalvar, aoCancelar }: Props) {
  const prefixo = useId();
  const salvar = useAcao((corpo: object) => chamarApi<Hospede>("POST", "/api/hospedes", corpo));
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [tipo, setTipo] = useState<Hospede["documentoTipo"]>(inicial?.documentoTipo ?? "cpf");
  const [documento, setDocumento] = useState(inicial?.documento ?? "");
  const [nascimento, setNascimento] = useState(inicial?.nascimento ?? "");
  const [nacionalidade, setNacionalidade] = useState(inicial?.nacionalidade ?? "BR");
  const [cidade, setCidade] = useState(inicial?.endereco?.cidade ?? "");
  const [uf, setUf] = useState(inicial?.endereco?.uf ?? "");
  const [telefone, setTelefone] = useState(inicial?.telefone ?? "");
  const [email, setEmail] = useState(inicial?.email ?? "");
  const [erros, setErros] = useState<Erros>({});
  const [geral, setGeral] = useState<Error | null>(null);

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    setErros({});
    setGeral(null);
    const corpo: Record<string, unknown> = {
      nome,
      documentoTipo: tipo,
      documento: documento.trim() || null,
      nascimento: nascimento || null,
      nacionalidade,
    };
    if (inicial?.id) corpo.id = inicial.id;
    if (telefone.trim()) corpo.telefone = telefone.trim();
    if (email.trim()) corpo.email = email.trim();
    if (cidade.trim() || uf.trim()) {
      corpo.endereco = { logradouro: inicial?.endereco?.logradouro ?? "", cidade: cidade.trim(), uf: uf.trim().toUpperCase(), pais: inicial?.endereco?.pais ?? "BR", ...(inicial?.endereco?.cep ? { cep: inicial.endereco.cep } : {}) };
    }
    if (inicial?.observacoes) corpo.observacoes = inicial.observacoes;
    try {
      aoSalvar(await salvar.mutateAsync(corpo));
    } catch (x) {
      const r = errosDe(x instanceof Error ? x : new Error("Não foi possível salvar o hóspede."));
      setErros(r.campos);
      setGeral(r.geral);
    }
  }

  function campo(chave: string, rotulo: string, entrada: (props: Record<string, unknown>) => ReactElement) {
    const id = `${prefixo}-${chave}`;
    const erro = erros[chave];
    return (
      <div className="campo">
        <label htmlFor={id}>{rotulo}</label>
        {entrada({ id, "aria-invalid": erro ? true : undefined, "aria-describedby": erro ? `${id}-erro` : undefined })}
        {erro && (
          <span id={`${id}-erro`} className="campo__erro">
            {erro}
          </span>
        )}
      </div>
    );
  }

  return (
    <form className="formulario" onSubmit={(e) => void enviar(e)} noValidate>
      {campo("nome", "Nome", (p) => <input {...p} value={nome} onChange={(e) => setNome(e.target.value)} />)}
      {campo("documentoTipo", "Tipo de documento", (p) => (
        <select {...p} value={tipo} onChange={(e) => setTipo(e.target.value as Hospede["documentoTipo"])}>
          <option value="cpf">CPF</option>
          <option value="passaporte">Passaporte</option>
        </select>
      ))}
      {campo("documento", "Documento", (p) => <input {...p} value={documento} onChange={(e) => setDocumento(e.target.value)} />)}
      {campo("nascimento", "Data de nascimento", (p) => <input {...p} type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} />)}
      {campo("nacionalidade", "Nacionalidade", (p) => <input {...p} value={nacionalidade} onChange={(e) => setNacionalidade(e.target.value)} />)}
      {campo("cidade", "Cidade", (p) => <input {...p} value={cidade} onChange={(e) => setCidade(e.target.value)} />)}
      {campo("uf", "UF", (p) => <input {...p} maxLength={2} value={uf} onChange={(e) => setUf(e.target.value)} />)}
      {campo("telefone", "Telefone", (p) => <input {...p} type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />)}
      {campo("email", "E-mail", (p) => <input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />)}
      <ErroAcao erro={geral} />
      <div className="formulario__acoes">
        <Botao variante="contorno" ignorarConexao onClick={aoCancelar}>Cancelar</Botao>
        <Botao type="submit" disabled={salvar.isPending}>Salvar hóspede</Botao>
      </div>
    </form>
  );
}
