export type Resposta = {
  simNao?: boolean;
  quantidade?: number;
  equipamento?: "funciona" | "nao_funciona" | "nao_se_aplica";
  presenca?: "presente" | "faltando" | "nao_se_aplica";
  observacao?: string;
  chamadoId?: string;
  alertaId?: string;
};

export type EstadoChecklist = {
  /** Situação do quarto quando o rascunho foi salvo; se mudar, o rascunho não vale mais. */
  situacaoQuarto: string;
  iniciadoEm: string;
  etapa: string;
  respostas: Record<string, Resposta>;
  frigobar: Record<string, number>;
  resultado?: "liberado" | "bloqueado";
  motivo?: string;
  /** true quando a pessoa digitou o motivo; antes disso ele acompanha os equipamentos com defeito. */
  motivoEditado?: boolean;
};
export type Rascunho = EstadoChecklist & { salvoEm: string };

const chave = (quartoId: string, tipo: string) => `erp.checklist.${quartoId}.${tipo}`;

export function salvarRascunho(quartoId: string, tipo: string, estado: EstadoChecklist): void {
  try {
    const r: Rascunho = { ...estado, salvoEm: new Date().toISOString() };
    localStorage.setItem(chave(quartoId, tipo), JSON.stringify(r));
  } catch {
    /* sem armazenamento: o fluxo segue sem rascunho */
  }
}

export function lerRascunho(quartoId: string, tipo: string): Rascunho | null {
  try {
    const texto = localStorage.getItem(chave(quartoId, tipo));
    if (!texto) return null;
    const r = JSON.parse(texto) as Rascunho;
    if (!r || typeof r !== "object" || typeof r.iniciadoEm !== "string" || typeof r.respostas !== "object" || r.respostas === null) return null;
    return { ...r, frigobar: r.frigobar ?? {} };
  } catch {
    return null;
  }
}

export function apagarRascunho(quartoId: string, tipo: string): void {
  try {
    localStorage.removeItem(chave(quartoId, tipo));
  } catch {
    /* ignora */
  }
}
