import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import type { Canal } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Dicas } from "../configuracoes/Dicas";
import { ListaCadastro } from "../configuracoes/ListaCadastro";
import { CampoPercentual } from "./CampoPercentual";
import { aposSalvarTarifa, CANAL_REFERENCIA, useCanais } from "./consultas";
import { ConfirmarRemocao } from "./ConfirmarRemocao";

type Tipo = Canal["tipo"];
export const ROTULO_TIPO_CANAL: Record<Tipo, string> = { direta: "Reserva direta", ota: "OTA", agencia: "Agência", passante: "Passante" };
const TIPOS: Tipo[] = ["direta", "ota", "agencia", "passante"];
const pct = (n: number) => `${String(n).replace(".", ",")}%`;

function Painel({ item, todos, fechar }: { item: Canal | null; todos: Canal[]; fechar: () => void }) {
  const cliente = useQueryClient();
  const balcao = item?.nome === CANAL_REFERENCIA;
  const [nome, setNome] = useState(item?.nome ?? "");
  const [percentual, setPercentual] = useState<number | null>(item?.percentual ?? 0);
  const [exigeSinal, setExigeSinal] = useState(item?.exigeSinal ?? false);
  const [tipo, setTipo] = useState<Tipo>(item?.tipo ?? "direta");
  const [comissao, setComissao] = useState<number | null>(item?.comissaoPercentual ?? 0);

  const motivos = [
    ...(nome.trim() === "" ? ["Informe o nome do canal."] : todos.some((c) => c.id !== item?.id && c.nome.toLowerCase() === nome.trim().toLowerCase()) ? ["Já existe um canal com esse nome. Edite o existente."] : []),
    ...(percentual === null ? ["Informe o percentual sobre o Balcão (use 0 para o mesmo preço)."] : []),
    ...(comissao === null ? ["Informe a comissão (use 0 se não houver)."] : comissao > 100 ? ["A comissão deve ficar entre 0 e 100."] : []),
    ...(percentual !== null && percentual <= -100 ? ["O percentual deve ser maior que -100."] : []),
  ];
  const aposMudar = async () => {
    await aposSalvarTarifa(cliente);
    fechar();
  };
  const salvar = useMutation<unknown, Error>({
    mutationFn: () =>
      chamarApi("PUT", "/api/tarifas/canais", {
        ...(item ? { id: item.id } : {}),
        nome: nome.trim(), percentual: percentual!, exigeSinal, tipo, comissaoPercentual: comissao!,
      }),
    onSuccess: aposMudar,
  });
  const remover = useMutation<unknown, Error, void>({
    mutationFn: () => chamarApi<unknown>("DELETE", `/api/tarifas/canais/${encodeURIComponent(item!.id)}`),
    onSuccess: aposMudar,
  });

  return (
    <form className="formulario" onSubmit={(e) => { e.preventDefault(); if (motivos.length === 0) salvar.mutate(); }}>
      <label className="campo">
        Nome
        <input value={nome} disabled={balcao} onChange={(e) => setNome(e.target.value)} />
      </label>
      {balcao && <p className="tarifas__aviso">O Balcão é a referência de preço: não pode ser renomeado nem removido.</p>}
      <CampoPercentual rotulo="Percentual sobre o Balcão (%)" aceitaNegativo desabilitado={balcao} valor={percentual} aoMudar={setPercentual} />
      <label className="pousada__marcar">
        <input type="checkbox" checked={exigeSinal} onChange={(e) => setExigeSinal(e.target.checked)} />
        Exige sinal
      </label>
      <label className="campo">
        Tipo
        <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
          {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_TIPO_CANAL[t]}</option>)}
        </select>
      </label>
      <CampoPercentual rotulo="Comissão (%)" valor={comissao} aoMudar={setComissao} />
      <p className="tarifas__aviso">A comissão incide sobre a receita de hospedagem e fica guardada em cada reserva quando ela é criada: mudar o percentual não altera reservas existentes.</p>
      <Dicas motivos={motivos} />
      <ErroAcao erro={salvar.error} />
      <div className="formulario__acoes">
        <Botao type="submit" disabled={motivos.length > 0 || salvar.isPending}>Salvar</Botao>
      </div>
      {item && (
        <>
          <ConfirmarRemocao rotulo="Remover canal" aviso={`Remover o canal ${item.nome}? Isso não pode ser desfeito.`} remocao={remover} desabilitado={balcao} />
          {balcao && <p className="tarifas__aviso">O Balcão não pode ser removido.</p>}
        </>
      )}
    </form>
  );
}

export function TelaCanais() {
  const q = useCanais();
  return (
    <>
      <ErroAcao erro={q.error} />
      <ListaCadastro<Canal>
        titulo="Canais"
        itens={q.data ?? []}
        chave={(c) => c.id}
        colunas={[
          { titulo: "Nome", celula: (c) => c.nome },
          { titulo: "Sobre o Balcão", celula: (c) => pct(c.percentual) },
          { titulo: "Tipo", celula: (c) => ROTULO_TIPO_CANAL[c.tipo] },
          { titulo: "Comissão", celula: (c) => pct(c.comissaoPercentual) },
          { titulo: "Sinal", celula: (c) => (c.exigeSinal ? "Exige" : "Não exige") },
        ]}
        renderPainel={(p) => <Painel item={p.item} todos={q.data ?? []} fechar={p.fechar} />}
      />
    </>
  );
}
