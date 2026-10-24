import { useState } from "react";
import { chamarApi } from "../../api/cliente";
import { useAcao, useCaixa, useFormasPagamento } from "../../api/consultas";
import type { ResumoCaixa } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { CampoDinheiro } from "../../componentes/CampoDinheiro";
import { Cartao } from "../../componentes/Cartao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { formatarReais } from "../../lib/dinheiro";
import "./caixa.css";

type Relatorio = { porForma: { forma: string; esperado: number; contado: number; diferenca: number }[] };

const ORIGENS: Record<string, string> = { pagamento: "Pagamento" };
/** O servidor emite `pagamento`; estorno é um pagamento com valor negativo. */
const origemAmigavel = (o: string, valor: number) => (o === "pagamento" && valor < 0 ? "Estorno" : (ORIGENS[o] ?? o));

/** Hora local do navegador (HH:MM) de um instante ISO. */
function horaLocal(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function AbrirCaixa() {
  const [valor, setValor] = useState<number | null>(null);
  const abrir = useAcao((valorInicial: number) => chamarApi("POST", "/api/caixa/abrir", { valorInicial }));
  return (
    <Cartao className="caixa-bloco">
      <h2>Abrir caixa</h2>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (valor !== null) abrir.mutate(valor);
        }}
      >
        <CampoDinheiro rotulo="Valor inicial em dinheiro" valor={valor} aoMudar={setValor} />
        <ErroAcao erro={abrir.error} />
        <div className="formulario__acoes">
          <Botao type="submit" disabled={valor === null || abrir.isPending}>
            Abrir caixa
          </Botao>
        </div>
      </form>
    </Cartao>
  );
}

type Fechamento = { mutateAsync: (c: Record<string, number>) => Promise<Relatorio>; isPending: boolean; error: Error | null };

function FormularioFechamento({ resumo, nome, fechar, aoCancelar }: { resumo: ResumoCaixa; nome: (c: string) => string; fechar: Fechamento; aoCancelar: () => void }) {
  const formas = Object.keys(resumo.esperadoPorForma);
  const [contados, setContados] = useState<Record<string, number | null>>({});
  const completo = formas.every((f) => contados[f] !== undefined && contados[f] !== null);
  return (
    <Cartao className="caixa-bloco">
      <h2>Fechar caixa</h2>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (!completo) return;
          const enviar = Object.fromEntries(formas.map((f) => [f, contados[f] as number]));
          fechar.mutateAsync(enviar).catch(() => {}); // o erro aparece pelo estado da mutação
        }}
      >
        {formas.map((f) => (
          <CampoDinheiro key={f} rotulo={`Contado em ${nome(f)}`} valor={contados[f] ?? null} aoMudar={(v) => setContados((c) => ({ ...c, [f]: v }))} />
        ))}
        <ErroAcao erro={fechar.error} />
        <div className="formulario__acoes">
          <Botao variante="contorno" ignorarConexao onClick={aoCancelar}>
            Cancelar
          </Botao>
          <Botao type="submit" disabled={!completo || fechar.isPending}>
            Confirmar fechamento
          </Botao>
        </div>
      </form>
    </Cartao>
  );
}

function RelatorioFechamento({ relatorio, nome, aoConcluir }: { relatorio: Relatorio; nome: (c: string) => string; aoConcluir: () => void }) {
  return (
    <Cartao className="caixa-bloco">
      <h2>Caixa fechado</h2>
      <table className="caixa-tabela">
        <thead>
          <tr>
            <th>Forma</th>
            <th className="caixa-num">Esperado</th>
            <th className="caixa-num">Contado</th>
            <th className="caixa-num">Diferença</th>
          </tr>
        </thead>
        <tbody>
          {relatorio.porForma.map((l) => (
            <tr key={l.forma}>
              <td>{nome(l.forma)}</td>
              <td className="caixa-num">{formatarReais(l.esperado)}</td>
              <td className="caixa-num">{formatarReais(l.contado)}</td>
              <td className="caixa-num" style={l.diferenca !== 0 ? { color: "var(--terracota)", fontWeight: 700 } : undefined}>
                {formatarReais(l.diferenca)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="formulario__acoes">
        <Botao ignorarConexao onClick={aoConcluir}>
          Concluir
        </Botao>
      </div>
    </Cartao>
  );
}

export function TelaCaixa() {
  const caixa = useCaixa();
  const formas = useFormasPagamento();
  const [fechando, setFechando] = useState(false);
  // O relatório fica aqui porque, ao fechar, a consulta do caixa passa a vir vazia.
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  // A mutação vive aqui: o refetch pós-fechamento desmonta o formulário, e o relatório não pode depender dele.
  const fechar = useAcao(async (c: Record<string, number>) => {
    const rel = await chamarApi<Relatorio>("POST", "/api/caixa/fechar", { contados: c });
    setRelatorio(rel);
    return rel;
  });

  const nome = (codigo: string) => formas.data?.find((f) => f.codigo === codigo)?.nome ?? codigo;

  let corpo;
  if (relatorio) {
    corpo = <RelatorioFechamento relatorio={relatorio} nome={nome} aoConcluir={() => { setRelatorio(null); setFechando(false); }} />;
  } else if (caixa.data === undefined) {
    corpo = caixa.isError ? <ErroAcao erro={caixa.error} /> : <p>Carregando…</p>;
  } else if (caixa.data === null) {
    corpo = <AbrirCaixa />;
  } else {
    const r = caixa.data;
    corpo = (
      <>
        <p className="caixa-suave">{`Aberto às ${horaLocal(r.turno.abertoEm)}`}</p>
        <Cartao className="caixa-bloco">
          <h2>Movimentos</h2>
          {r.movimentos.length === 0 ? (
            <p className="caixa-suave">Nenhum movimento neste turno.</p>
          ) : (
            <table className="caixa-tabela">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Origem</th>
                  <th>Forma</th>
                  <th className="caixa-num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {r.movimentos.map((m, i) => (
                  <tr key={i}>
                    <td>{horaLocal(m.instante)}</td>
                    <td>{origemAmigavel(m.origemTipo, m.valor)}</td>
                    <td>{nome(m.forma)}</td>
                    <td className="caixa-num">{formatarReais(m.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Cartao>
        <Cartao className="caixa-bloco">
          <h2>Esperado por forma</h2>
          <ul className="caixa-esperado" aria-label="Esperado por forma">
            {Object.entries(r.esperadoPorForma).map(([forma, valor]) => (
              <li key={forma}>
                <span>{nome(forma)}</span>
                <strong>{formatarReais(valor)}</strong>
              </li>
            ))}
          </ul>
        </Cartao>
        {fechando ? (
          <FormularioFechamento
            resumo={r}
            nome={nome}
            aoCancelar={() => setFechando(false)}
            fechar={fechar}
          />
        ) : (
          <div>
            <Botao onClick={() => setFechando(true)}>Fechar caixa</Botao>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="caixa">
      <h1>Caixa</h1>
      {corpo}
    </div>
  );
}
