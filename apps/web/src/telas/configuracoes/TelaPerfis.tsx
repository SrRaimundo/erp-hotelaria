import { useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import type { Perfil } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { ListaCadastro } from "./ListaCadastro";
import "./configuracoes.css";

type Permissao = { permissao: string; descricao: string };

/** Perfis aparecem também na lista de usuários (rótulo e escolha), então ambas recarregam. */
const invalidar = (cliente: QueryClient) => Promise.all(["perfis", "usuarios"].map((k) => cliente.invalidateQueries({ queryKey: [k] })));

function Dicas({ motivos }: { motivos: string[] }) {
  if (motivos.length === 0) return null;
  return (
    <ul className="cq__aviso cq__dicas">
      {motivos.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}

function PainelNovoPerfil({ perfis, fechar }: { perfis: Perfil[]; fechar: () => void }) {
  const cliente = useQueryClient();
  const [rotulo, setRotulo] = useState("");
  const [copiarDe, setCopiarDe] = useState("");
  const motivos = [
    ...(rotulo.trim() === "" ? ["Informe o nome do perfil."] : []),
    ...(copiarDe === "" ? ["Escolha o perfil de onde copiar as permissões."] : []),
  ];
  const valido = motivos.length === 0;

  const criar = useMutation<unknown, Error>({
    mutationFn: () => chamarApi("POST", "/api/perfis", { rotulo: rotulo.trim(), copiarDe }),
    onSuccess: async () => {
      await invalidar(cliente);
      fechar();
    },
  });

  return (
    <form
      className="formulario"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) criar.mutate();
      }}
    >
      <label className="campo">
        Nome do perfil
        <input value={rotulo} onChange={(e) => setRotulo(e.target.value)} />
      </label>
      <label className="campo">
        Copiar permissões de
        <select value={copiarDe} onChange={(e) => setCopiarDe(e.target.value)}>
          <option value="" disabled>Escolha…</option>
          {perfis.map((p) => (
            <option key={p.nome} value={p.nome}>{p.rotulo}</option>
          ))}
        </select>
      </label>
      <Dicas motivos={motivos} />
      <ErroAcao erro={criar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={!valido || criar.isPending}>Salvar</Botao>
      </div>
    </form>
  );
}

/** Excluir: só para personalizado sem usuários; nos demais o botão fica desligado e o motivo aparece ao lado. */
function AcaoExcluir({ perfil, fechar }: { perfil: Perfil; fechar: () => void }) {
  const cliente = useQueryClient();
  const excluir = useMutation<unknown, Error>({
    mutationFn: () => chamarApi("DELETE", `/api/perfis/${perfil.nome}`),
    onSuccess: async () => {
      await invalidar(cliente);
      fechar();
    },
  });
  const motivo = perfil.padrao
    ? "Perfis padrão não podem ser excluídos."
    : perfil.usuarios > 0
      ? `Este perfil tem ${perfil.usuarios} ${perfil.usuarios === 1 ? "usuário" : "usuários"}. Mude o perfil deles antes de excluir.`
      : null;
  return (
    <div className="cq__ativo">
      {motivo && <p className="cq__aviso">{motivo}</p>}
      <ErroAcao erro={excluir.error} />
      <Botao variante="contorno" disabled={motivo !== null || excluir.isPending} onClick={() => excluir.mutate()}>
        Excluir
      </Botao>
    </div>
  );
}

function PainelPerfil({ perfil, fechar }: { perfil: Perfil; fechar: () => void }) {
  const cliente = useQueryClient();
  const permissoesQ = useQuery({ queryKey: ["permissoes"], queryFn: () => chamarApi<Permissao[]>("GET", "/api/permissoes") });
  const [rotulo, setRotulo] = useState(perfil.rotulo);
  const [limite, setLimite] = useState(String(perfil.limiteDesconto));
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(perfil.permissoes));
  const ehAdmin = perfil.nome === "admin";

  // O limite é um percentual inteiro de 0 a 100 (é assim que o servidor o guarda).
  const limiteNum = /^\d+$/.test(limite.trim()) && Number(limite) <= 100 ? Number(limite) : null;
  const motivos = [
    ...(rotulo.trim() === "" ? ["Informe o nome do perfil."] : []),
    ...(limiteNum === null ? ["Limite de desconto: informe um número inteiro de 0 a 100."] : []),
  ];
  const valido = motivos.length === 0;

  const alternar = (permissao: string, marcar: boolean) =>
    setMarcadas((atual) => {
      const novo = new Set(atual);
      if (marcar) novo.add(permissao);
      else novo.delete(permissao);
      return novo;
    });

  const salvar = useMutation<unknown, Error>({
    mutationFn: () =>
      chamarApi("PUT", `/api/perfis/${perfil.nome}`, {
        rotulo: rotulo.trim(),
        limiteDesconto: limiteNum!,
        permissoes: (permissoesQ.data ?? []).map((p) => p.permissao).filter((p) => marcadas.has(p)),
      }),
    onSuccess: async () => {
      await invalidar(cliente);
      fechar();
    },
  });

  return (
    <>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (valido && permissoesQ.data) salvar.mutate();
        }}
      >
        <label className="campo">
          Nome do perfil
          <input value={rotulo} onChange={(e) => setRotulo(e.target.value)} />
        </label>
        <label className="campo">
          Limite de desconto (%)
          <input type="number" min={0} max={100} step={1} inputMode="numeric" value={limite} onChange={(e) => setLimite(e.target.value)} />
        </label>
        <fieldset className="pousada__grupo">
          <legend>Permissões</legend>
          <ErroAcao erro={permissoesQ.error} />
          {permissoesQ.isPending && <p>Carregando…</p>}
          {(permissoesQ.data ?? []).map((p) => {
            const protegida = ehAdmin && p.permissao === "config.gerenciar";
            return (
              <div key={p.permissao}>
                <label className="pousada__marcar">
                  <input type="checkbox" checked={marcadas.has(p.permissao)} disabled={protegida} onChange={(e) => alternar(p.permissao, e.target.checked)} />
                  {p.descricao}
                </label>
                {protegida && <p className="cq__aviso">O perfil Administrador precisa manter esta permissão.</p>}
              </div>
            );
          })}
        </fieldset>
        <Dicas motivos={motivos} />
        <ErroAcao erro={salvar.error} />
        <div className="formulario__acoes">
          <Botao type="submit" disabled={!valido || !permissoesQ.data || salvar.isPending}>Salvar</Botao>
        </div>
      </form>
      <AcaoExcluir perfil={perfil} fechar={fechar} />
    </>
  );
}

export function TelaPerfis() {
  const perfisQ = useQuery({ queryKey: ["perfis"], queryFn: () => chamarApi<Perfil[]>("GET", "/api/perfis") });
  const perfis = perfisQ.data ?? [];
  return (
    <div className="cq">
      <ErroAcao erro={perfisQ.error} />
      <ListaCadastro<Perfil>
        titulo="Perfis"
        rotuloNovo="+ Novo perfil"
        itens={perfis}
        chave={(p) => p.nome}
        colunas={[
          { titulo: "Nome", celula: (p) => p.rotulo },
          { titulo: "Tipo", celula: (p) => (p.padrao ? "Padrão" : "Personalizado") },
          { titulo: "Limite de desconto", celula: (p) => `${p.limiteDesconto}%` },
          { titulo: "Usuários", celula: (p) => p.usuarios },
        ]}
        renderPainel={(p) => (p.item ? <PainelPerfil perfil={p.item} fechar={p.fechar} /> : <PainelNovoPerfil perfis={perfis} fechar={p.fechar} />)}
      />
    </div>
  );
}
