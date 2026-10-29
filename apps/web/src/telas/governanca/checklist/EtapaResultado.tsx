type Props = {
  resultado: "liberado" | "bloqueado" | undefined;
  motivo: string;
  /** Texto que explica por que "Liberado" não está disponível; undefined quando está. */
  impedimento: string | undefined;
  aoEscolher: (r: "liberado" | "bloqueado") => void;
  aoMotivo: (texto: string) => void;
};

export function EtapaResultado({ resultado, motivo, impedimento, aoEscolher, aoMotivo }: Props) {
  return (
    <div className="checklist__resultado">
      <div className="checklist__opcoes">
        <button type="button" className="checklist__opcao" aria-pressed={resultado === "liberado"} disabled={impedimento !== undefined} onClick={() => aoEscolher("liberado")}>
          Liberado
        </button>
        <button type="button" className="checklist__opcao" aria-pressed={resultado === "bloqueado"} onClick={() => aoEscolher("bloqueado")}>
          Bloqueado
        </button>
      </div>
      {impedimento && <p className="checklist__nota checklist__nota--aviso">{impedimento}</p>}
      {resultado === "bloqueado" && (
        <label className="checklist__observacao">
          Motivo
          <textarea value={motivo} onChange={(e) => aoMotivo(e.target.value)} rows={3} />
        </label>
      )}
    </div>
  );
}
