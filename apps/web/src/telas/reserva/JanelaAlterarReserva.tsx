import { useState } from "react";
import { useCanais } from "../tarifas/consultas";
import type { ReservaDetalhe } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Janela } from "../../componentes/Janela";
import { JanelaPreviaAlteracao } from "../mapa/JanelaPreviaAlteracao";
import type { Movimento } from "../mapa/usoArrastar";
import { adultosValidos, dataValida } from "../nova-reserva/CamposAcomodacao";

type Props = { reserva: ReservaDetalhe; aoFechar: () => void };

/** Formulário de datas e hóspedes; ao continuar, cai no mesmo fluxo de prévia/confirmação/supervisor do mapa. */
export function JanelaAlterarReserva({ reserva, aoFechar }: Props) {
  const hospedada = reserva.estado === "hospedada";
  const [chegada, setChegada] = useState(reserva.chegada);
  const [saida, setSaida] = useState(reserva.saida);
  const [adultos, setAdultos] = useState(String(reserva.adultos));
  const [criancas, setCriancas] = useState<string[]>(reserva.criancasNascimento);
  const [canal, setCanal] = useState(reserva.canal);
  const canaisQ = useCanais();
  const [movimento, setMovimento] = useState<Movimento | null>(null);

  const nAdultos = adultosValidos(adultos);
  const datasOk = dataValida(chegada) && dataValida(saida);
  const erros: string[] = [];
  if (!datasOk) erros.push("Informe chegada e saída válidas.");
  else if (saida <= chegada) erros.push("A saída deve ser depois da chegada.");
  if (nAdultos === null) erros.push("Informe ao menos 1 adulto.");
  if (criancas.some((c) => !dataValida(c))) erros.push("Informe a data de nascimento de cada criança.");

  // Só vai o que mudou: o servidor recalcula e audita apenas os campos enviados.
  const mudou: Omit<Movimento, "reservaId" | "tipo"> = {};
  if (!hospedada && chegada !== reserva.chegada) mudou.chegada = chegada;
  if (saida !== reserva.saida) mudou.saida = saida;
  if (nAdultos !== null && nAdultos !== reserva.adultos) mudou.adultos = nAdultos;
  if (criancas.join(",") !== reserva.criancasNascimento.join(",")) mudou.criancasNascimento = criancas;
  if (canal !== reserva.canal) mudou.canal = canal;
  const semMudanca = Object.keys(mudou).length === 0;

  if (movimento) return <JanelaPreviaAlteracao movimento={movimento} aoFechar={aoFechar} />;

  return (
    <Janela aberta aoFechar={aoFechar} titulo="Alterar datas e hóspedes">
      <div className="formulario">
        <div className="campo">
          <label htmlFor="alt-chegada">Chegada</label>
          <input id="alt-chegada" type="date" value={chegada} disabled={hospedada} onChange={(e) => setChegada(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="alt-saida">Saída</label>
          <input id="alt-saida" type="date" value={saida} onChange={(e) => setSaida(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="alt-adultos">Adultos</label>
          <input id="alt-adultos" type="number" min={1} value={adultos} onChange={(e) => setAdultos(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="alt-canal">Canal</label>
          <select id="alt-canal" value={canal} onChange={(e) => setCanal(e.target.value)}>
            {/* O canal atual aparece mesmo que a lista ainda não tenha chegado. */}
            {!(canaisQ.data ?? []).some((c) => c.nome === reserva.canal) && <option value={reserva.canal}>{reserva.canal}</option>}
            {(canaisQ.data ?? []).map((c) => <option key={c.id} value={c.nome}>{c.nome}</option>)}
          </select>
        </div>
        {criancas.map((nasc, i) => (
          <div className="campo" key={i}>
            <label htmlFor={`alt-crianca-${i}`}>{`Nascimento da criança ${i + 1}`}</label>
            <input id={`alt-crianca-${i}`} type="date" value={nasc} onChange={(e) => setCriancas((c) => c.map((x, j) => (j === i ? e.target.value : x)))} />
            <Botao variante="contorno" tamanho="pequeno" aria-label={`Remover criança ${i + 1}`} onClick={() => setCriancas((c) => c.filter((_, j) => j !== i))}>
              Remover
            </Botao>
          </div>
        ))}
        <div>
          <Botao variante="contorno" tamanho="pequeno" onClick={() => setCriancas((c) => [...c, ""])}>+ criança</Botao>
        </div>
        {erros.map((e) => (
          <ErroAcao key={e} erro={new Error(e)} />
        ))}
        <div className="formulario__acoes">
          <Botao variante="contorno" ignorarConexao onClick={aoFechar}>Cancelar</Botao>
          <Botao disabled={erros.length > 0 || semMudanca} onClick={() => setMovimento({ reservaId: reserva.id, tipo: "alterar", ...mudou })}>
            Ver prévia
          </Botao>
        </div>
      </div>
    </Janela>
  );
}
