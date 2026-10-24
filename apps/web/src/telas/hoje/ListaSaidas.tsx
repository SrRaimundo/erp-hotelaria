import type { Painel } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { formatarReais } from "../../lib/dinheiro";
import { LinhaReserva } from "./LinhaReserva";
import { SecaoHoje } from "./SecaoHoje";

type Props = { saidas: Painel["saidas"]; horaCheckout?: string; aoAbrir: (reservaId: string) => void };

export function ListaSaidas({ saidas, horaCheckout, aoAbrir }: Props) {
  return (
    <SecaoHoje titulo="Saídas de hoje" subtitulo={horaCheckout ? `até ${horaCheckout}` : undefined}>
      {saidas.length === 0 ? (
        <p className="hoje-suave">Nenhuma saída hoje.</p>
      ) : (
        <ul className="hoje-lista">
          {saidas.map((s) => (
            <LinhaReserva
              key={s.reservaId}
              quarto={s.quartoNumero}
              titulo={s.titular}
              detalhe={`saldo ${formatarReais(s.saldo)}`}
              acao={
                <Botao tamanho="pequeno" onClick={() => aoAbrir(s.reservaId)}>
                  Check-out
                </Botao>
              }
            />
          ))}
        </ul>
      )}
    </SecaoHoje>
  );
}
