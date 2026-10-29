import { ListaOpcoes, type OpcaoResposta } from "./EtapaEquipamentos";

const OPCOES: OpcaoResposta[] = [
  { valor: "presente", rotulo: "Presente" },
  { valor: "faltando", rotulo: "Faltando", problema: true },
  { valor: "nao_se_aplica", rotulo: "Não se aplica" },
];

type Props = Omit<Parameters<typeof ListaOpcoes>[0], "campo" | "opcoes" | "rotuloRegistrado" | "perguntaObservacao" | "aoObservar" | "aoAbrir"> & Partial<Pick<Parameters<typeof ListaOpcoes>[0], "aoObservar" | "aoAbrir">> & { tipo: "saida" | "diaria" };

/** Faltando na saída vira chamado de reposição; na diária só avisa a recepção. */
export function EtapaControles({ tipo, ...props }: Props) {
  return (
    <ListaOpcoes
      {...props}
      campo="presenca"
      opcoes={OPCOES}
      rotuloRegistrado={tipo === "saida" ? "Chamado aberto" : "Recepção avisada"}
      perguntaObservacao={tipo === "saida" ? "O que aconteceu? (opcional)" : undefined}
    />
  );
}
