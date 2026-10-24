import { useState } from "react";
import { chamarApi } from "../../api/cliente";
import { useAcao } from "../../api/consultas";
import type { ItemAtencao } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { JanelaSupervisor, type Autorizacao } from "../../componentes/JanelaSupervisor";
import { ProrrogarSinal } from "../../componentes/ProrrogarSinal";

type Props = { itens: ItemAtencao[]; aoAbrir: (consulta: string) => void };
type Acao = ItemAtencao["acoes"][number];
type Pendente = { tipo: "prorrogar" | "no-show"; item: ItemAtencao };

const ROTULOS: Record<Acao, string> = {
  registrar_sinal: "Registrar sinal",
  prorrogar_sinal: "Prorrogar sinal",
  marcar_no_show: "Marcar no-show",
  abrir_reserva: "Abrir reserva",
  abrir_conta: "Abrir conta",
  resolver_alerta: "Resolver alerta",
};

const reserva = (id: string) => `/api/reservas/${encodeURIComponent(id)}`;

export function BlocoAtencao({ itens, aoAbrir }: Props) {
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const noShow = useAcao(({ id, ...a }: Autorizacao & { id: string }) => chamarApi("POST", `${reserva(id)}/no-show`, a));
  const prorrogar = useAcao(({ id, ...corpo }: Autorizacao & { id: string; novoPrazo: string }) =>
    chamarApi("POST", `${reserva(id)}/prorrogar-sinal`, corpo),
  );
  const resolver = useAcao((id: string) => chamarApi("POST", `/api/alertas/${encodeURIComponent(id)}/resolver`));

  if (itens.length === 0) return null;

  function executar(acao: Acao, item: ItemAtencao) {
    const rid = item.reservaId === null ? null : encodeURIComponent(item.reservaId);
    switch (acao) {
      case "registrar_sinal":
        if (rid) aoAbrir(`reserva=${rid}&aba=conta${item.sinalPendente ? `&receber=${item.sinalPendente}` : ""}`);
        break;
      case "abrir_conta":
        if (rid) aoAbrir(`reserva=${rid}&aba=conta`);
        break;
      case "abrir_reserva":
        if (rid) aoAbrir(`reserva=${rid}`);
        break;
      case "prorrogar_sinal":
        setPendente({ tipo: "prorrogar", item });
        break;
      case "marcar_no_show":
        setPendente({ tipo: "no-show", item });
        break;
      case "resolver_alerta":
        resolver.mutate(item.id);
        break;
    }
  }

  const disponivel = (acao: Acao, item: ItemAtencao) => acao === "resolver_alerta" || item.reservaId !== null;
  const fechar = () => setPendente(null);

  return (
    <section className="hoje-atencao" aria-labelledby="hoje-atencao-titulo">
      <h2 id="hoje-atencao-titulo">{`Precisa da sua atenção (${itens.length})`}</h2>
      <ErroAcao erro={resolver.error} />
      <ul className="hoje-lista">
        {itens.map((item) => (
          <li key={item.id} className="hoje-atencao__item">
            <div className="hoje-linha__texto">
              <strong>{item.titulo}</strong>
              {item.detalhe && <span className="hoje-suave">{item.detalhe}</span>}
              {item.telefone && <span className="hoje-suave">{item.telefone}</span>}
            </div>
            <div className="hoje-atencao__acoes">
              {item.acoes
                .filter((a) => disponivel(a, item))
                .map((a, i) => (
                  <Botao
                    key={a}
                    tamanho="pequeno"
                    variante={i === 0 ? "principal" : "contorno"}
                    disabled={a === "resolver_alerta" && resolver.isPending && resolver.variables === item.id}
                    onClick={() => executar(a, item)}
                  >
                    {ROTULOS[a]}
                  </Botao>
                ))}
            </div>
          </li>
        ))}
      </ul>
      <JanelaSupervisor
        aberta={pendente?.tipo === "no-show"}
        titulo="Marcar no-show"
        aoCancelar={fechar}
        aoConfirmar={async (a) => {
          await noShow.mutateAsync({ ...a, id: pendente!.item.reservaId! });
          fechar();
        }}
      />
      <ProrrogarSinal
        key={pendente?.item.id}
        aberta={pendente?.tipo === "prorrogar"}
        aoCancelar={fechar}
        aoConfirmar={async (novoPrazo, a) => {
          await prorrogar.mutateAsync({ ...a, novoPrazo, id: pendente!.item.reservaId! });
          fechar();
        }}
      />
    </section>
  );
}
