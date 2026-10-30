import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import type { Perfil } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Dicas } from "../configuracoes/Dicas";

export type EstadoEquipe = { linhas: Linha[]; proxima: number };
type Linha = { chave: number; nome: string; login: string; perfil: string; senha: string; criado: boolean; erro: string | null };

const nova = (chave: number, perfil: string): Linha => ({ chave, nome: "", login: "", perfil, senha: "", criado: false, erro: null });
const vazia = (l: Linha) => l.nome.trim() === "" && l.login.trim() === "" && l.senha === "";

function problemas(l: Linha, rotulo: string): string[] {
  return [
    ...(l.nome.trim() === "" ? [`Informe o nome${rotulo}.`] : []),
    ...(l.login.trim() === "" ? [`Informe o login${rotulo}.`] : []),
    ...(l.perfil === "" ? [`Escolha o perfil${rotulo}.`] : []),
    ...(l.senha === "" ? [`Informe a senha inicial${rotulo}.`] : []),
  ];
}

type Props = { equipe: EstadoEquipe | null; aoMudar: (f: (e: EstadoEquipe | null) => EstadoEquipe) => void; aoAvancar: () => void; aoVoltar: () => void };

function EquipeLinhas({ perfis, equipe, aoMudar, aoAvancar, aoVoltar }: Props & { perfis: Perfil[] }) {
  const cliente = useQueryClient();
  const padrao = perfis.find((p) => p.nome === "recepcao")?.nome ?? perfis[0]?.nome ?? "";
  // O estado das linhas vive no Assistente: Voltar/Avançar não perde o que foi digitado nem as linhas já criadas.
  const { linhas, proxima } = equipe ?? { linhas: [nova(1, padrao)], proxima: 2 };
  const atualizar = (f: (e: EstadoEquipe) => EstadoEquipe) => aoMudar((e) => f(e ?? { linhas: [nova(1, padrao)], proxima: 2 }));
  const setLinhas = (f: (ls: Linha[]) => Linha[]) => atualizar((e) => ({ ...e, linhas: f(e.linhas) }));
  const mudar = (chave: number, p: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...p } : l)));

  const pendentes = linhas.filter((l) => !l.criado && !vazia(l));
  const algumCriado = linhas.some((l) => l.criado);
  const motivos = linhas.flatMap((l, i) => (l.criado || vazia(l) ? [] : problemas(l, linhas.length > 1 ? ` do usuário ${i + 1}` : "")));

  const pular = useMutation<unknown, Error>({
    mutationFn: () => chamarApi("POST", "/api/assistente/pular-equipe"),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["assistente"] });
      aoAvancar();
    },
  });

  // Cria um a um; quem já foi criado fica marcado e não é enviado de novo se o usuário tentar outra vez.
  const salvar = useMutation<boolean, Error>({
    mutationFn: async () => {
      let tudo = true;
      for (const l of pendentes) {
        try {
          await chamarApi("POST", "/api/usuarios", { nome: l.nome.trim(), login: l.login.trim(), senha: l.senha, perfil: l.perfil });
          mudar(l.chave, { criado: true, erro: null });
        } catch (x) {
          tudo = false;
          mudar(l.chave, { erro: x instanceof Error ? x.message : "Não foi possível criar o usuário." });
        }
      }
      return tudo;
    },
    onSuccess: async (tudo) => {
      await Promise.all([cliente.invalidateQueries({ queryKey: ["usuarios"] }), cliente.invalidateQueries({ queryKey: ["assistente"] })]);
      if (tudo) aoAvancar();
    },
  });

  const pode = motivos.length === 0 && (pendentes.length > 0 || algumCriado) && !salvar.isPending;

  return (
    <section className="pousada__secao" aria-labelledby="assistente-equipe">
      <h2 id="assistente-equipe">Equipe</h2>
      <p className="cq__aviso">Todos trocam a senha no primeiro acesso. Este passo é opcional.</p>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (pode) salvar.mutate();
        }}
      >
        {linhas.map((l, i) => (
          <fieldset key={l.chave} className={`assistente__linha${l.criado ? " assistente__linha--criada" : ""}`} aria-label={`Usuário ${i + 1}`}>
            <legend>Usuário {i + 1}</legend>
            <div className="cq__grade">
              <label className="campo">
                Nome
                <input value={l.nome} disabled={l.criado} onChange={(e) => mudar(l.chave, { nome: e.target.value })} />
              </label>
              <label className="campo">
                Login
                <input value={l.login} disabled={l.criado} autoComplete="off" onChange={(e) => mudar(l.chave, { login: e.target.value })} />
              </label>
              <label className="campo">
                Perfil
                <select value={l.perfil} disabled={l.criado} onChange={(e) => mudar(l.chave, { perfil: e.target.value })}>
                  {perfis.map((p) => (
                    <option key={p.nome} value={p.nome}>{p.rotulo}</option>
                  ))}
                </select>
              </label>
              <label className="campo">
                Senha inicial
                <input type="password" value={l.senha} disabled={l.criado} autoComplete="new-password" onChange={(e) => mudar(l.chave, { senha: e.target.value })} />
              </label>
            </div>
            {l.criado && <p className="pousada__ok">Criado</p>}
            {l.erro && <p role="alert" className="erro-acao">{l.erro}</p>}
            {!l.criado && linhas.length > 1 && (
              <Botao variante="contorno" tamanho="pequeno" onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}>
                Remover usuário {i + 1}
              </Botao>
            )}
          </fieldset>
        ))}
        <div>
          <Botao
            variante="contorno"
            onClick={() => {
              atualizar((e) => ({ linhas: [...e.linhas, nova(e.proxima, padrao)], proxima: e.proxima + 1 }));
            }}
          >
            + Outro
          </Botao>
        </div>
        <Dicas motivos={motivos} />
        <ErroAcao erro={pular.error ?? salvar.error} />
        <div className="assistente__acoes">
          <Botao variante="contorno" onClick={aoVoltar}>Voltar</Botao>
          <div className="assistente__acoes-direita">
            <Botao variante="contorno" disabled={pular.isPending || salvar.isPending} onClick={() => pular.mutate()}>Pular</Botao>
            <Botao type="submit" disabled={!pode}>Salvar e avançar</Botao>
          </div>
        </div>
      </form>
    </section>
  );
}

/** Passo 3: usuários da equipe (opcional). */
export function PassoEquipe(props: Props) {
  const perfis = useQuery({ queryKey: ["perfis"], queryFn: () => chamarApi<Perfil[]>("GET", "/api/perfis") });
  return perfis.data ? (
    <EquipeLinhas perfis={perfis.data} {...props} />
  ) : (
    <>{perfis.isError ? <ErroAcao erro={perfis.error} /> : <p>Carregando…</p>}</>
  );
}
