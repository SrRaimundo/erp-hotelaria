import { useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useConfig, useRelatorio } from "../../api/consultas";
import { ExigePermissao } from "../../auth/ExigePermissao";
import { useSessao } from "../../auth/SessaoProvider";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { useAtrasado } from "../../lib/useAtrasado";
import { BarraSaidas } from "./BarraSaidas";
import { buscarNoCatalogo, type ItemCatalogo } from "./catalogo";
import { CabecalhoImpressao } from "./CabecalhoImpressao";
import { FiltrosRelatorio } from "./FiltrosRelatorio";
import { VisorRelatorio } from "./VisorRelatorio";
import "./relatorios.css";

/** Chaves da URL que viram filtro do servidor, por tipo de filtro do catálogo. */
const CHAVES: Record<string, string[]> = { data: ["data"], reserva: ["reserva"], periodo: ["inicio", "fim", "turno"] };

function Corpo({ item }: { item: ItemCatalogo }) {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const local = useLocation();
  const { usuario } = useSessao();
  const config = useConfig();
  const [textoBusca, setTextoBusca] = useState("");
  const busca = useAtrasado(textoBusca.trim(), 300);

  const valores: Record<string, string> = {};
  for (const tipo of item.filtros) for (const k of CHAVES[tipo] ?? []) valores[k] = params.get(k) ?? "";
  const filtros: Record<string, string> = Object.fromEntries(Object.entries(valores).filter(([, v]) => v !== ""));
  if (item.filtros.includes("busca") && busca) filtros.busca = busca;

  const faltaReserva = item.filtros.includes("reserva") && !valores.reserva;
  const relatorio = useRelatorio(item.id, filtros, !faltaReserva);

  function mudar(mudancas: Record<string, string>) {
    setParams(
      (atual) => {
        const novo = new URLSearchParams(atual);
        for (const [k, v] of Object.entries(mudancas)) {
          if (v) novo.set(k, v);
          else novo.delete(k);
        }
        return novo;
      },
      { replace: true },
    );
  }
  // Veio de outra tela (reserva, caixa, catálogo): volta nela; aberto direto, vai ao catálogo.
  const voltar = () => (local.key === "default" ? navegar("/relatorios") : navegar(-1));

  let conteudo;
  if (faltaReserva) {
    conteudo = (
      <p className="rel-guia">
        Escolha uma reserva para ver a conta. Procure a reserva na <Link to="/reservas">lista de reservas</Link>, abra-a e use “Imprimir conta”.
      </p>
    );
  } else if (relatorio.data) {
    conteudo = (
      <>
        <CabecalhoImpressao relatorio={relatorio.data} config={config.data} usuario={usuario?.nome ?? ""} />
        <div className="rel-nao-imprimir rel-titulo">
          <h2>{relatorio.data.subtitulo}</h2>
        </div>
        <VisorRelatorio relatorio={relatorio.data} />
      </>
    );
  } else if (relatorio.isError) {
    conteudo = <ErroAcao erro={relatorio.error} />;
  } else {
    conteudo = <p>Carregando…</p>;
  }

  return (
    <div className="rel">
      <div className="rel-topo rel-nao-imprimir">
        <Botao variante="contorno" tamanho="pequeno" ignorarConexao onClick={voltar}>
          Voltar
        </Botao>
        <h1>{item.nome}</h1>
      </div>
      <FiltrosRelatorio item={item} valores={valores} aoMudar={mudar} busca={textoBusca} aoMudarBusca={setTextoBusca} />
      <BarraSaidas pronto={relatorio.data !== undefined} />
      {conteudo}
    </div>
  );
}

/** `/relatorios/:id`: filtros no topo, visor genérico e as saídas (imprimir, PDF). */
export function TelaRelatorio() {
  const { id = "" } = useParams();
  const item = buscarNoCatalogo(id);
  if (!item) {
    return (
      <div className="rel">
        <h1>Relatório não encontrado</h1>
        <p>
          <Link to="/relatorios">Ver todos os relatórios</Link>
        </p>
      </div>
    );
  }
  return (
    <ExigePermissao permissao={item.permissao}>
      <Corpo key={item.id} item={item} />
    </ExigePermissao>
  );
}
