import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import type { Perfil } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Janela } from "../../componentes/Janela";
import { useSessao } from "../../auth/SessaoProvider";
import { Dicas } from "./Dicas";
import { ListaCadastro } from "./ListaCadastro";
import "./configuracoes.css";

type UsuarioLista = {
  id: string;
  nome: string;
  login: string;
  perfil: string;
  perfilRotulo: string;
  ativo: boolean;
  ultimoAcesso: string | null;
  trocarSenha: boolean;
};

const formatarAcesso = (iso: string | null): string =>
  iso === null ? "nunca" : new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Botão Desativar/Reativar com a mensagem do servidor ao lado; fecha o painel quando dá certo. */
function AcaoAtivo({ id, ativo, aoConcluir }: { id: string; ativo: boolean; aoConcluir: () => void }) {
  const cliente = useQueryClient();
  const alternar = useMutation<unknown, Error>({
    mutationFn: () => chamarApi("POST", `/api/usuarios/${id}/${ativo ? "desativar" : "reativar"}`),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["usuarios"] });
      aoConcluir();
    },
  });
  return (
    <div className="cq__ativo">
      <ErroAcao erro={alternar.error} />
      <Botao variante="contorno" disabled={alternar.isPending} onClick={() => alternar.mutate()}>
        {ativo ? "Desativar" : "Reativar"}
      </Botao>
    </div>
  );
}

/** Gera a senha temporária e a mostra numa janela; ela só vive neste estado local (nunca no cache) e some ao fechar. */
function AcaoRedefinirSenha({ id }: { id: string }) {
  const [senha, setSenha] = useState<string | null>(null);
  const redefinir = useMutation<{ senhaTemporaria: string }, Error>({
    mutationFn: () => chamarApi<{ senhaTemporaria: string }>("POST", `/api/usuarios/${id}/redefinir-senha`),
    onSuccess: (r) => setSenha(r.senhaTemporaria),
    gcTime: 0, // a senha não fica na memória das mutações depois de usada
  });
  const fechar = () => {
    setSenha(null);
    redefinir.reset();
  };
  return (
    <div className="cq__ativo">
      <ErroAcao erro={redefinir.error} />
      <Botao variante="contorno" disabled={redefinir.isPending} onClick={() => redefinir.mutate()}>
        Redefinir senha
      </Botao>
      <Janela aberta={senha !== null} aoFechar={fechar} titulo="Senha temporária">
        <p className="ur__senha">{senha}</p>
        <p className="cq__aviso">Anote agora; ela não será mostrada de novo.</p>
        <p className="cq__aviso">O usuário precisará trocá-la no próximo acesso.</p>
      </Janela>
    </div>
  );
}

function PainelUsuario({ item, perfis, fechar }: { item: UsuarioLista | null; perfis: Perfil[]; fechar: () => void }) {
  const cliente = useQueryClient();
  const { usuario: logado, atualizar } = useSessao();
  const ehEu = item !== null && item.id === logado?.id;
  const dicaPerfil = useId();
  const [nome, setNome] = useState(item?.nome ?? "");
  const [login, setLogin] = useState("");
  const [perfil, setPerfil] = useState(item?.perfil ?? "");
  const [senha, setSenha] = useState("");

  const motivos = [
    ...(nome.trim() === "" ? ["Informe o nome."] : []),
    ...(!item && login.trim() === "" ? ["Informe o login."] : []),
    ...(perfil === "" ? ["Escolha o perfil."] : []),
    ...(!item && senha.length < 6 ? ["A senha inicial deve ter pelo menos 6 caracteres."] : []),
  ];
  const valido = motivos.length === 0;

  const salvar = useMutation<unknown, Error>({
    mutationFn: () =>
      item
        ? chamarApi("PUT", `/api/usuarios/${item.id}`, { nome: nome.trim(), perfil })
        : chamarApi("POST", "/api/usuarios", { nome: nome.trim(), login: login.trim(), senha, perfil }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["usuarios"] });
      if (ehEu) await atualizar();
      fechar();
    },
  });

  return (
    <>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (valido) salvar.mutate();
        }}
      >
        <label className="campo">
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        {item ? (
          <p className="cq__aviso">Login: {item.login}</p>
        ) : (
          <label className="campo">
            Login
            <input value={login} autoComplete="off" onChange={(e) => setLogin(e.target.value)} />
          </label>
        )}
        <label className="campo">
          Perfil
          <select value={perfil} disabled={ehEu} aria-describedby={ehEu ? dicaPerfil : undefined} onChange={(e) => setPerfil(e.target.value)}>
            {!item && <option value="" disabled>Escolha…</option>}
            {perfis.map((p) => (
              <option key={p.nome} value={p.nome}>{p.rotulo}</option>
            ))}
          </select>
        </label>
        {ehEu && <p id={dicaPerfil} className="cq__aviso">Você não pode mudar o seu próprio perfil.</p>}
        {!item && (
          <label className="campo">
            Senha inicial
            <input type="password" value={senha} autoComplete="new-password" onChange={(e) => setSenha(e.target.value)} />
          </label>
        )}
        {!item && <p className="cq__aviso">O usuário troca a senha no primeiro acesso.</p>}
        <Dicas motivos={motivos} />
        <ErroAcao erro={salvar.error} />
        <div className="formulario__acoes">
          <Botao type="submit" disabled={!valido || salvar.isPending}>Salvar</Botao>
        </div>
      </form>
      {item && !ehEu && <AcaoRedefinirSenha id={item.id} />}
      {item && !ehEu && <AcaoAtivo id={item.id} ativo={item.ativo} aoConcluir={fechar} />}
    </>
  );
}

export function TelaUsuarios() {
  const [inativos, setInativos] = useState(false);
  const usuariosQ = useQuery({ queryKey: ["usuarios"], queryFn: () => chamarApi<UsuarioLista[]>("GET", "/api/usuarios") });
  const perfisQ = useQuery({ queryKey: ["perfis"], queryFn: () => chamarApi<Perfil[]>("GET", "/api/perfis") });
  const itens = (usuariosQ.data ?? []).filter((u) => inativos || u.ativo);

  return (
    <div className="cq">
      <ErroAcao erro={usuariosQ.error ?? perfisQ.error} />
      <ListaCadastro<UsuarioLista>
        titulo="Usuários"
        itens={itens}
        chave={(u) => u.id}
        mostrarInativos={inativos}
        aoMostrarInativos={setInativos}
        colunas={[
          { titulo: "Nome", celula: (u) => u.nome },
          { titulo: "Login", celula: (u) => u.login },
          { titulo: "Perfil", celula: (u) => u.perfilRotulo },
          { titulo: "Situação", celula: (u) => (u.ativo ? "Ativo" : "Desativado") },
          { titulo: "Último acesso", celula: (u) => formatarAcesso(u.ultimoAcesso) },
        ]}
        inativo={(u) => !u.ativo}
        renderPainel={(p) => (perfisQ.data ? <PainelUsuario item={p.item} perfis={perfisQ.data} fechar={p.fechar} /> : <p>Carregando…</p>)}
      />
    </div>
  );
}
