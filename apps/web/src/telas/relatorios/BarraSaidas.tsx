import { useState } from "react";
import type { Relatorio } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { nomeDoArquivo } from "./formatar";
import type { CabecalhoPdf } from "./gerarPdf";

/** O PDF (e a biblioteca que o gera) só é baixado no primeiro clique: computadores simples não carregam isso à toa. */
async function criarPdf(relatorio: Relatorio, cabecalho: CabecalhoPdf, data?: string): Promise<File> {
  const { gerarPdf } = await import("./gerarPdf");
  return new File([gerarPdf(relatorio, cabecalho)], nomeDoArquivo(relatorio, data), { type: "application/pdf" });
}

/** Só quando o navegador sabe compartilhar arquivos (precisa de HTTPS; sem isso fica só o PDF). */
function podeCompartilharArquivos(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function" || typeof navigator.share !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([""], "teste.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

function baixar(arquivo: File): void {
  const url = URL.createObjectURL(arquivo);
  const a = document.createElement("a");
  a.href = url;
  a.download = arquivo.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Props = { relatorio: Relatorio | undefined; cabecalho: CabecalhoPdf; data?: string };

/** Imprimir, exportar PDF e compartilhar. Fica fora da folha impressa. */
export function BarraSaidas({ relatorio, cabecalho, data }: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const compartilhavel = podeCompartilharArquivos();

  async function executar(acao: (pdf: File) => Promise<void> | void, falha: string) {
    if (!relatorio) return;
    setOcupado(true);
    setErro(null);
    let pdf: File;
    try {
      pdf = await criarPdf(relatorio, cabecalho, data);
    } catch {
      setErro("Não foi possível gerar o PDF. Tente de novo ou use Imprimir.");
      setOcupado(false);
      return;
    }
    try {
      await acao(pdf);
    } catch (e) {
      // Fechar a folha de compartilhamento não é erro.
      if (!(e instanceof DOMException && e.name === "AbortError")) setErro(falha);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="rel-barra rel-nao-imprimir">
      <Botao variante="contorno" disabled={!relatorio} onClick={() => window.print()}>
        Imprimir
      </Botao>
      <Botao variante="contorno" disabled={!relatorio || ocupado} onClick={() => executar(baixar, "Não foi possível baixar o PDF. Use Imprimir.")}>
        Exportar PDF
      </Botao>
      {compartilhavel && (
        <Botao variante="contorno" disabled={!relatorio || ocupado} onClick={() => executar((pdf) => navigator.share({ files: [pdf], title: relatorio?.titulo }), "Não foi possível compartilhar. Use Exportar PDF e envie o arquivo.")}>
          Compartilhar
        </Botao>
      )}
      {erro && (
        <p role="alert" className="rel-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
