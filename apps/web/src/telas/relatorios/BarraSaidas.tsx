import { Botao } from "../../componentes/Botao";

/** Imprimir, e (Tarefa 4) exportar PDF e compartilhar. Fica fora da folha impressa. */
export function BarraSaidas({ pronto }: { pronto: boolean }) {
  return (
    <div className="rel-barra rel-nao-imprimir">
      <Botao variante="contorno" disabled={!pronto} onClick={() => window.print()}>
        Imprimir
      </Botao>
    </div>
  );
}
