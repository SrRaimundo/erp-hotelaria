import { useNavigate } from "react-router";
import { useConfigHorarios, usePainel } from "../../api/consultas";
import { useSessao } from "../../auth/SessaoProvider";
import { Cartao } from "../../componentes/Cartao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { nomeDiaSemana } from "../../lib/datas";
import { BlocoAtencao } from "./BlocoAtencao";
import { BlocoCanais } from "./BlocoCanais";
import { BlocoChamados } from "./BlocoChamados";
import { BlocoGovernanca } from "./BlocoGovernanca";
import { ListaChegadas } from "./ListaChegadas";
import { ListaSaidas } from "./ListaSaidas";
import { ProximosDias } from "./ProximosDias";
import "./hoje.css";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Só a saudação usa o relógio do navegador; o dia da operação vem do servidor. */
function saudacao(): string {
  const hora = new Date().getHours();
  return hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
}

function dataPorExtenso(dia: string): string {
  const [, m, d] = dia.split("-").map(Number);
  return `${nomeDiaSemana(dia)}, ${String(d).padStart(2, "0")} de ${MESES[m! - 1]}`;
}

function Numero({ rotulo, valor, legenda }: { rotulo: string; valor: number; legenda: string }) {
  return (
    <Cartao className="hoje-numero">
      <span className="hoje-suave">{rotulo}</span>
      <strong className="hoje-numero__valor">{valor}</strong>
      <span className="hoje-suave">{legenda}</span>
    </Cartao>
  );
}

export function TelaHoje() {
  const painel = usePainel();
  const config = useConfigHorarios();
  const { usuario, pode } = useSessao();
  const navegar = useNavigate();

  // Com dados em cache a tela continua (o erro de uma nova consulta aparece na faixa de conexão do Shell).
  if (!painel.data) return painel.isError ? <ErroAcao erro={painel.error} /> : <p>Carregando…</p>;

  const p = painel.data;
  const n = p.numeros;
  /** Abre o painel da reserva: mantém a rota atual e troca só a consulta. */
  const abrir = (consulta: string) => void navegar({ search: `?${consulta}` });
  const reserva = (id: string, extra = "") => `reserva=${encodeURIComponent(id)}${extra}`;
  const primeiroNome = usuario?.nome.trim().split(/\s+/)[0] ?? "";

  return (
    <div className="hoje">
      <header>
        <h1>{primeiroNome ? `${saudacao()}, ${primeiroNome}` : saudacao()}</h1>
        <p className="hoje-suave">
          {`${dataPorExtenso(p.dia)} · ocupação hoje: ${p.ocupacao.ocupados} de ${p.ocupacao.total} quartos (${p.ocupacao.percentual}%)`}
        </p>
      </header>
      <div className="hoje-numeros">
        <Numero rotulo="Chegadas" valor={n.chegadas} legenda={`${n.chegadasJaHospedadas} já fez check-in`} />
        <Numero rotulo="Saídas" valor={n.saidas} legenda="hoje" />
        <Numero rotulo="Hospedados" valor={n.hospedados} legenda={`${n.pessoasHospedadas} pessoas`} />
        <Numero rotulo="Quartos sujos" valor={n.quartosSujos} legenda={`${n.quartosManutencao} em manutenção`} />
        <Numero rotulo="Livres hoje" valor={n.livresHoje} legenda="p/ walk-in" />
      </div>
      <BlocoAtencao itens={p.atencao} aoAbrir={abrir} />
      {pode("quartos.manutencao") && <BlocoChamados chamados={p.chamadosAbertos} />}
      <div className="hoje-grade">
        <ListaChegadas chegadas={p.chegadas} horaCheckin={config.data?.horaCheckin} aoAbrir={abrir} />
        <ListaSaidas saidas={p.saidas} horaCheckout={config.data?.horaCheckout} aoAbrir={(id) => abrir(reserva(id, "&fluxo=checkout"))} />
        <BlocoGovernanca governanca={p.governanca} ocupadosSemArrumacao={n.ocupadosSemArrumacao} />
        <ProximosDias dias={p.proximosDias} />
        <BlocoCanais canais={p.ocupadosPorCanal} />
      </div>
    </div>
  );
}
