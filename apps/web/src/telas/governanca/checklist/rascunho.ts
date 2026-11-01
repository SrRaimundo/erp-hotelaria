export type Resposta = {
  simNao?: boolean;
  quantidade?: number;
  equipamento?: "funciona" | "nao_funciona" | "nao_se_aplica";
  presenca?: "presente" | "faltando" | "nao_se_aplica";
  observacao?: string;
  chamadoId?: string;
  /** Quem abriu o chamado ligado; se não for a pessoa atual, voltar atrás só desvincula (não cancela). */
  chamadoAbertoPor?: string;
  alertaId?: string;
};

export type EstadoChecklist = {
  /** Situação do quarto quando o rascunho foi salvo; se mudar, o rascunho não vale mais. */
  situacaoQuarto: string;
  /** Reserva hospedada quando o rascunho nasceu (arrumação); outra reserva no mesmo quarto invalida o rascunho. */
  reservaId?: string | null;
  /** Instante em que o quarto entrou na situação atual (saída); outro período sujo invalida o rascunho. */
  situacaoDesde?: string | null;
  /** Identifica este checklist no servidor: reenviar o mesmo Concluir não grava duas vezes. */
  execucaoId: string;
  iniciadoEm: string;
  /** Ids dos itens exibidos quando o checklist foi aberto; o servidor só exige esses. Rascunhos antigos não têm o campo. */
  itensExibidos?: string[];
  etapa: string;
  respostas: Record<string, Resposta>;
  frigobar: Record<string, number>;
  resultado?: "liberado" | "bloqueado";
  motivo?: string;
  /** true quando a pessoa digitou o motivo; antes disso ele acompanha os equipamentos com defeito. */
  motivoEditado?: boolean;
};
export type Rascunho = EstadoChecklist & { salvoEm: string };

/** UUID v4; `crypto.randomUUID` só existe em contexto seguro (https), e a pousada pode abrir o sistema por http na rede local. */
export function novoIdLocal(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

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
    return { ...r, frigobar: r.frigobar ?? {}, execucaoId: typeof r.execucaoId === "string" ? r.execucaoId : novoIdLocal() };
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
