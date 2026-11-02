import type { ConfigPousada, Relatorio } from "../../api/tipos";
import { formatarInstante } from "./formatar";

/** Cabeçalho que só aparece na folha impressa (CSS de impressão). O PDF monta o equivalente em gerarPdf. */
export function CabecalhoImpressao({ relatorio, config, usuario }: { relatorio: Relatorio; config: Partial<ConfigPousada> | undefined; usuario: string }) {
  const nome = config?.nomeEstabelecimento || config?.razaoSocial || "";
  return (
    <header className="rel-cabecalho-impressao" data-testid="cabecalho-impressao">
      {nome && <strong className="rel-cabecalho-impressao__nome">{nome}</strong>}
      {config?.razaoSocial && config.razaoSocial !== nome && <div>{config.razaoSocial}</div>}
      {config?.cnpj && <div>{`CNPJ ${config.cnpj}`}</div>}
      {config?.endereco && <div>{config.endereco}</div>}
      <h1>{relatorio.titulo}</h1>
      <div>{relatorio.subtitulo}</div>
      <div>{`Gerado em ${formatarInstante(relatorio.geradoEm)} por ${usuario}`}</div>
    </header>
  );
}
