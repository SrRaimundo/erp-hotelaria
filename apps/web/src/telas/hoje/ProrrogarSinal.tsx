import { useId, useState } from "react";
import { Botao } from "../../componentes/Botao";
import { Janela } from "../../componentes/Janela";
import { JanelaSupervisor, type Autorizacao } from "../../componentes/JanelaSupervisor";

type Props = { aberta: boolean; aoCancelar: () => void; aoConfirmar: (novoPrazo: string, a: Autorizacao) => Promise<void> };

/** Valor para o campo datetime-local: AAAA-MM-DDTHH:MM no fuso do navegador. */
function paraCampo(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Duas etapas: escolher o novo prazo e, então, autorizar com o supervisor. */
export function ProrrogarSinal({ aberta, aoCancelar, aoConfirmar }: Props) {
  const id = useId();
  const [prazo, setPrazo] = useState(() => paraCampo(new Date(Date.now() + 86_400_000)));
  const [etapa, setEtapa] = useState<"prazo" | "supervisor">("prazo");
  const valido = !Number.isNaN(new Date(prazo).getTime());

  function cancelar() {
    setEtapa("prazo");
    aoCancelar();
  }

  if (!aberta) return null;
  if (etapa === "supervisor") {
    return (
      <JanelaSupervisor
        aberta
        titulo="Prorrogar sinal"
        aoCancelar={cancelar}
        aoConfirmar={(a) => aoConfirmar(new Date(prazo).toISOString(), a)}
      />
    );
  }
  return (
    <Janela aberta aoFechar={cancelar} titulo="Prorrogar sinal">
      <div className="formulario">
        <label htmlFor={`${id}-prazo`}>Novo prazo</label>
        <input id={`${id}-prazo`} type="datetime-local" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        <div className="formulario__acoes">
          <Botao variante="contorno" ignorarConexao onClick={cancelar}>
            Cancelar
          </Botao>
          <Botao disabled={!valido} onClick={() => setEtapa("supervisor")}>
            Continuar
          </Botao>
        </div>
      </div>
    </Janela>
  );
}
