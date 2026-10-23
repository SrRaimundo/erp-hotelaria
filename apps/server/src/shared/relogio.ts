export interface Relogio {
  agora(): Date;
}

export const relogioSistema: Relogio = { agora: () => new Date() };

export class RelogioFixo implements Relogio {
  private atual: Date;
  constructor(iso: string) {
    this.atual = new Date(iso);
  }
  agora(): Date {
    return new Date(this.atual.getTime());
  }
  definir(iso: string): void {
    this.atual = new Date(iso);
  }
  avancarHoras(h: number): void {
    this.atual = new Date(this.atual.getTime() + h * 3_600_000);
  }
}
