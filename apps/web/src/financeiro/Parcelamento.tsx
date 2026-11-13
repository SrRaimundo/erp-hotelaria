import { useEffect, useState, type ReactNode } from "react";
import { CampoDinheiro } from "../componentes/CampoDinheiro";
import { formatarReais } from "../lib/dinheiro";
import { Dicas } from "../telas/configuracoes/Dicas";
import { CampoTexto, Selecao } from "./comuns";
import { dividirValor, gerarDatas, MAX_PARCELAS, validarParcelas, type Intervalo, type ParcelaEditavel } from "./calculo-parcelas";

const INTERVALOS: { valor: Intervalo; rotulo: string }[] = [
  { valor: "30_dias", rotulo: "A cada 30 dias" },
  { valor: "mensal", rotulo: "Todo mês no mesmo dia" },
  { valor: "livre", rotulo: "Datas livres" },
];

/**
 * Estado do parcelamento de um lançamento: À vista (uma conta, como sempre) ou Parcelado (um título com a prévia das parcelas).
 * A prévia nasce da divisão padrão e das datas do intervalo; editar uma parcela vale até mudar total, quantidade, primeira data ou intervalo.
 */
export function useParcelamento(total: number | null, primeiroVencimento: string) {
  const [parcelado, setParcelado] = useState(false);
  const [qtd, setQtd] = useState("2");
  const [intervalo, setIntervalo] = useState<Intervalo>("30_dias");
  const [editadas, setEditadas] = useState<ParcelaEditavel[] | null>(null);
  const n = /^\d+$/.test(qtd.trim()) ? Number(qtd) : NaN;
  useEffect(() => setEditadas(null), [total, primeiroVencimento, n, intervalo]);

  const padrao = (): ParcelaEditavel[] => {
    if (!total || !primeiroVencimento || !(n >= 2 && n <= MAX_PARCELAS) || total < n) return [];
    const valores = dividirValor(total, n);
    return gerarDatas(primeiroVencimento, n, intervalo).map((vencimento, i) => ({ vencimento, valor: valores[i]! }));
  };
  const parcelas = editadas && editadas.length === n ? editadas : padrao();
  const editar = (i: number, p: Partial<ParcelaEditavel>) => setEditadas(parcelas.map((x, k) => (k === i ? { ...x, ...p } : x)));

  const motivos: string[] = [];
  if (parcelado && total) {
    if (!(n >= 2)) motivos.push("Parcelado precisa de pelo menos 2 parcelas.");
    else if (n > MAX_PARCELAS) motivos.push(`Parcelado aceita no máximo ${MAX_PARCELAS} parcelas.`);
    else if (total < n) motivos.push("O total é pequeno demais: cada parcela precisa de pelo menos 1 centavo.");
    else motivos.push(...validarParcelas(total, parcelas));
  }
  return {
    parcelado, setParcelado, qtd, setQtd, intervalo, setIntervalo, parcelas, editar, motivos,
    /** Corpo do título (sem os dados do lançamento) quando Parcelado. */
    corpo: () => ({ intervalo, parcelas: parcelas.map((p) => ({ vencimento: p.vencimento, valor: p.valor as number })) }),
  };
}

export type Parcelamento = ReturnType<typeof useParcelamento>;

/** Escolha À vista/Parcelado e, no Parcelado, quantidade, intervalo, prévia editável e a explicação do que impede salvar. */
export function SecaoParcelamento({ p, total, vencimento }: { p: Parcelamento; total: number | null; vencimento: ReactNode }) {
  const soma = p.parcelas.reduce((s, x) => s + (x.valor ?? 0), 0);
  return (
    <>
      <Selecao rotulo="Forma" valor={p.parcelado ? "parcelado" : "vista"} aoMudar={(v) => p.setParcelado(v === "parcelado")} opcoes={[{ valor: "vista", rotulo: "À vista" }, { valor: "parcelado", rotulo: "Parcelado" }]} />
      {vencimento}
      {p.parcelado && (
        <>
          <CampoTexto rotulo="Número de parcelas" tipo="number" valor={p.qtd} aoMudar={p.setQtd} />
          <Selecao rotulo="Intervalo" valor={p.intervalo} aoMudar={(v) => p.setIntervalo(v as Intervalo)} opcoes={INTERVALOS} />
          {p.intervalo === "livre" && <p className="fin__suave">Digite a data e o valor de cada parcela.</p>}
          {p.parcelas.length > 0 && (
            <fieldset className="fin__grupo">
              <legend>Prévia das parcelas</legend>
              {p.parcelas.map((x, i) => (
                <div key={i} className="fin__parcela">
                  <strong>{i + 1}/{p.parcelas.length}</strong>
                  <CampoTexto rotulo={`Vencimento da parcela ${i + 1}`} tipo="date" valor={x.vencimento} aoMudar={(v) => p.editar(i, { vencimento: v })} />
                  <CampoDinheiro rotulo={`Valor da parcela ${i + 1}`} valor={x.valor} aoMudar={(v) => p.editar(i, { valor: v })} />
                </div>
              ))}
              <p className="fin__suave">Soma das parcelas: {formatarReais(soma)}{total ? ` de ${formatarReais(total)}` : ""}</p>
            </fieldset>
          )}
          <Dicas motivos={p.motivos} />
        </>
      )}
    </>
  );
}
