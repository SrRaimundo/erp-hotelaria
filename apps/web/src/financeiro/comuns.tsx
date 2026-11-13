import { useId, type ReactNode } from "react";
import { ErroAcao } from "../componentes/ErroAcao";

export const dataBr = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return d && m && a ? `${d}/${m}/${a}` : iso;
};

/** Carregando / erro de uma consulta; renderiza `children` quando há dados. */
export function Estado({ carregando, erro, children }: { carregando: boolean; erro: Error | null | undefined; children: ReactNode }) {
  if (erro) return <ErroAcao erro={erro} />;
  if (carregando) return <p className="fin__suave" role="status">Carregando…</p>;
  return <>{children}</>;
}


/** Barras horizontais simples (CSS) para valores em centavos. */
export function Barras({ itens }: { itens: { rotulo: string; valor: number; tom?: "verde" | "terracota" | "amarelo" }[] }) {
  const max = Math.max(1, ...itens.map((i) => Math.abs(i.valor)));
  return (
    <ul className="fin__barras">
      {itens.map((i) => (
        <li key={i.rotulo}>
          <span className="fin__barra-rotulo">{i.rotulo}</span>
          <span className="fin__barra-trilho" role="img" aria-label={`${i.rotulo}: ${Math.round((Math.abs(i.valor) / max) * 100)}% do maior valor`}>
            <span className={`fin__barra fin__barra--${i.tom ?? "verde"}`} style={{ width: `${(Math.abs(i.valor) / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

type Opcao = { valor: string; rotulo: string };

/** Lista de escolha com rótulo; `vazio` acrescenta a primeira opção sem valor (ex.: "Todos"). */
export function Selecao({ rotulo, valor, aoMudar, opcoes, vazio, desabilitado }: {
  rotulo: string; valor: string; aoMudar: (v: string) => void; opcoes: Opcao[]; vazio?: string; desabilitado?: boolean;
}) {
  const id = useId();
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <select id={id} value={valor} disabled={desabilitado} onChange={(e) => aoMudar(e.target.value)}>
        {vazio !== undefined && <option value="">{vazio}</option>}
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
    </div>
  );
}

/** Campo de texto simples com rótulo ligado ao controle. */
export function CampoTexto({ rotulo, valor, aoMudar, tipo = "text", obrigatorio }: {
  rotulo: string; valor: string; aoMudar: (v: string) => void; tipo?: "text" | "date" | "email" | "tel" | "number"; obrigatorio?: boolean;
}) {
  const id = useId();
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <input id={id} type={tipo} value={valor} required={obrigatorio} onChange={(e) => aoMudar(e.target.value)} />
    </div>
  );
}

export const ROTULO_ORIGEM: Record<string, string> = {
  hospedagem: "Hospedagem", reserva: "Reserva", bar: "Bar", lavanderia: "Lavanderia", rh: "RH", manual: "Manual",
};
export const ROTULO_FORMA: Record<string, string> = {
  dinheiro: "Dinheiro", pix: "Pix", debito: "Débito", credito: "Crédito", voucher: "Voucher", cheque: "Cheque", boleto: "Boleto",
  transferencia: "Transferência", deposito: "Depósito",
};
export const ROTULO_STATUS: Record<string, string> = {
  pendente: "Pendente", confirmado: "Pago", liquidado: "Liquidado", cancelado: "Cancelado", a_receber: "A receber", baixado: "Baixado",
  aberto: "Aberto", vencido: "Vencido", parcialmente_recebido: "Parcialmente recebido", recebido: "Recebido",
};
export const rotulo = (mapa: Record<string, string>, k: string) => mapa[k] ?? k.replace(/_/g, " ");
export const FORMAS_COBRANCA: Opcao[] = [
  { valor: "boleto", rotulo: "Boleto" }, { valor: "pix", rotulo: "Pix" }, { valor: "deposito", rotulo: "Depósito" },
];
