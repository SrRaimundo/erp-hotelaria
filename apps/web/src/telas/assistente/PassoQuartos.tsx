import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { chamarApi, ErroApi } from "../../api/cliente";
import { Botao } from "../../componentes/Botao";
import { CampoDinheiro } from "../../componentes/CampoDinheiro";
import { Dicas } from "../configuracoes/Dicas";
import type { EstadoAssistente } from "./Assistente";

type Linha = {
  chave: number;
  nome: string;
  maxAdultos: string;
  maxCriancas: string;
  p1: number | null;
  p2: number | null;
  p3: number | null;
  extra: number | null;
  de: string;
  ate: string;
  bloco: string;
};

const nova = (chave: number): Linha => ({ chave, nome: "", maxAdultos: "2", maxCriancas: "0", p1: null, p2: null, p3: null, extra: null, de: "", ate: "", bloco: "" });
const inteiro = (t: string): number | null => (/^\d+$/.test(t.trim()) ? Number(t) : null);

/** Problemas de uma linha, ditos ao usuário (o botão fica desligado enquanto houver algum). */
function problemas(l: Linha, rotulo: string): string[] {
  const adultos = inteiro(l.maxAdultos);
  const de = inteiro(l.de);
  const ate = inteiro(l.ate);
  return [
    ...(l.nome.trim() === "" ? [`Informe o nome da categoria${rotulo}.`] : []),
    ...(adultos === null || adultos < 1 ? [`Informe o máximo de adultos${rotulo} (pelo menos 1).`] : []),
    ...(inteiro(l.maxCriancas) === null ? [`Informe o máximo de crianças${rotulo}.`] : []),
    ...(l.p1 === null || l.p2 === null || l.p3 === null || l.extra === null ? [`Informe os preços de 1, 2 e 3 adultos e do adulto extra${rotulo}.`] : []),
    ...(de === null || ate === null ? [`Informe os números inicial e final dos quartos${rotulo}.`] : de > ate ? [`O número final deve ser maior ou igual ao inicial${rotulo}.`] : []),
  ];
}

function CamposLinha({ l, mudar }: { l: Linha; mudar: (p: Partial<Linha>) => void }) {
  return (
    <>
      <label className="campo">
        Nome da categoria
        <input value={l.nome} onChange={(e) => mudar({ nome: e.target.value })} />
      </label>
      <div className="cq__grade">
        <label className="campo">
          Máximo de adultos
          <input type="number" min={1} value={l.maxAdultos} onChange={(e) => mudar({ maxAdultos: e.target.value })} />
        </label>
        <label className="campo">
          Máximo de crianças
          <input type="number" min={0} value={l.maxCriancas} onChange={(e) => mudar({ maxCriancas: e.target.value })} />
        </label>
      </div>
      <div className="cq__grade">
        <CampoDinheiro rotulo="Diária para 1 adulto" valor={l.p1} aoMudar={(p1) => mudar({ p1 })} />
        <CampoDinheiro rotulo="Diária para 2 adultos" valor={l.p2} aoMudar={(p2) => mudar({ p2 })} />
        <CampoDinheiro rotulo="Diária para 3 adultos" valor={l.p3} aoMudar={(p3) => mudar({ p3 })} />
        <CampoDinheiro rotulo="Adulto extra" valor={l.extra} aoMudar={(extra) => mudar({ extra })} />
      </div>
      <div className="cq__grade">
        <label className="campo">
          Quarto inicial
          <input type="number" min={0} value={l.de} onChange={(e) => mudar({ de: e.target.value })} />
        </label>
        <label className="campo">
          Quarto final
          <input type="number" min={0} value={l.ate} onChange={(e) => mudar({ ate: e.target.value })} />
        </label>
        <label className="campo">
          Bloco
          <input value={l.bloco} onChange={(e) => mudar({ bloco: e.target.value })} />
        </label>
      </div>
    </>
  );
}

/** Quartos já criados: só leitura, sem reenviar nada (Review Focus 5). */
function QuartosExistentes({ estado, aoAvancar, aoVoltar }: { estado: EstadoAssistente; aoAvancar: () => void; aoVoltar: () => void }) {
  return (
    <section className="pousada__secao" aria-labelledby="assistente-quartos">
      <h2 id="assistente-quartos">Categorias e quartos</h2>
      <p className="cq__aviso">Os quartos já foram criados. Para alterar, use Categorias e quartos no menu.</p>
      <ul>
        {estado.categorias.map((c) => (
          <li key={c.id}>
            <strong>{c.nome}</strong>: <span>{c.quartos.join(", ")}</span>
          </li>
        ))}
      </ul>
      <div className="assistente__acoes">
        <Botao variante="contorno" onClick={aoVoltar}>Voltar</Botao>
        <Botao onClick={aoAvancar}>Avançar</Botao>
      </div>
    </section>
  );
}

/** Passo 2: linhas de categoria com faixa de numeração; envia tudo de uma vez (tudo ou nada no servidor). */
export function PassoQuartos({ estado, aoAvancar, aoVoltar }: { estado: EstadoAssistente; aoAvancar: () => void; aoVoltar: () => void }) {
  const cliente = useQueryClient();
  const [linhas, setLinhas] = useState<Linha[]>([nova(1)]);
  const [proxima, setProxima] = useState(2);

  const enviar = useMutation<unknown, Error>({
    mutationFn: () =>
      chamarApi("POST", "/api/assistente/quartos", {
        categorias: linhas.map((l) => ({
          nome: l.nome.trim(),
          maxAdultos: Number(l.maxAdultos),
          maxCriancas: Number(l.maxCriancas),
          porAdultos: { 1: l.p1!, 2: l.p2!, 3: l.p3! },
          adultoExtra: l.extra!,
          de: Number(l.de),
          ate: Number(l.ate),
          ...(l.bloco.trim() ? { bloco: l.bloco.trim() } : {}),
        })),
      }),
    onSuccess: async () => {
      await Promise.all(["assistente", "categorias", "quartos", "tarifas", "mapa"].map((k) => cliente.invalidateQueries({ queryKey: [k] })));
      aoAvancar();
    },
  });

  if (estado.quartos) return <QuartosExistentes estado={estado} aoAvancar={aoAvancar} aoVoltar={aoVoltar} />;

  const mudar = (chave: number, p: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...p } : l)));
  const motivos = linhas.flatMap((l, i) => problemas(l, linhas.length > 1 ? ` da categoria ${i + 1}` : ""));

  const numeros =
    enviar.error instanceof ErroApi && enviar.error.codigo === "NUMERO_QUARTO_DUPLICADO"
      ? ((enviar.error.detalhes as { numeros?: string[] } | undefined)?.numeros ?? [])
      : [];
  const emConflito = (l: Linha) => numeros.some((n) => Number(n) >= Number(l.de) && Number(n) <= Number(l.ate));

  return (
    <section className="pousada__secao" aria-labelledby="assistente-quartos">
      <h2 id="assistente-quartos">Categorias e quartos</h2>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (motivos.length === 0) enviar.mutate();
        }}
      >
        {linhas.map((l, i) => (
          <fieldset key={l.chave} className={`assistente__linha${enviar.error && emConflito(l) ? " assistente__linha--conflito" : ""}`} aria-label={`Categoria ${i + 1}`}>
            <legend>Categoria {i + 1}</legend>
            <CamposLinha l={l} mudar={(p) => mudar(l.chave, p)} />
            {linhas.length > 1 && (
              <Botao variante="contorno" tamanho="pequeno" onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}>
                Remover categoria {i + 1}
              </Botao>
            )}
          </fieldset>
        ))}
        <div>
          <Botao
            variante="contorno"
            onClick={() => {
              setLinhas((ls) => [...ls, nova(proxima)]);
              setProxima((n) => n + 1);
            }}
          >
            + Outra categoria
          </Botao>
        </div>
        <Dicas motivos={motivos} />
        {enviar.error && (
          <div role="alert" className="erro-acao">
            <p>{enviar.error.message}</p>
            {numeros.length > 0 && <p>Números em conflito: {numeros.join(", ")}</p>}
          </div>
        )}
        <div className="assistente__acoes">
          <Botao variante="contorno" onClick={aoVoltar}>Voltar</Botao>
          <Botao type="submit" disabled={motivos.length > 0 || enviar.isPending}>Criar categorias e quartos</Botao>
        </div>
      </form>
    </section>
  );
}
