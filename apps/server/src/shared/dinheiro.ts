export type Centavos = number;

/**
 * Dinheiro: representa uma quantidade de dinheiro em centavos.
 * Usa brand typing para evitar confundição com números simples.
 */
export class Dinheiro {
  private constructor(readonly centavos: Centavos) {}

  static de(centavos: number): Dinheiro {
    return new Dinheiro(arredondarCentavos(centavos));
  }

  static zero(): Dinheiro {
    return new Dinheiro(0);
  }

  mais(outro: Dinheiro): Dinheiro {
    return Dinheiro.de(this.centavos + outro.centavos);
  }

  menos(outro: Dinheiro): Dinheiro {
    return Dinheiro.de(this.centavos - outro.centavos);
  }

  multiplica(fator: number): Dinheiro {
    return Dinheiro.de(this.centavos * fator);
  }

  divide(divisor: number): Dinheiro {
    return Dinheiro.de(this.centavos / divisor);
  }

  eh(outro: Dinheiro): boolean {
    return this.centavos === outro.centavos;
  }

  ehMaior(outro: Dinheiro): boolean {
    return this.centavos > outro.centavos;
  }

  ehMaiorOuIgual(outro: Dinheiro): boolean {
    return this.centavos >= outro.centavos;
  }

  ehMenor(outro: Dinheiro): boolean {
    return this.centavos < outro.centavos;
  }

  ehMenorOuIgual(outro: Dinheiro): boolean {
    return this.centavos <= outro.centavos;
  }

  toString(): string {
    return formatarBRL(this.centavos);
  }
}

/** Acrescenta pct% a v, sem arredondar (arredonde só no final com arredondarCentavos). */
export function aplicarPercentual(v: number, pct: number): number {
  return v * (1 + pct / 100);
}

function meioParaLongeDoZero(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v)) || 0; // || 0 evita -0
}

export function arredondarCentavos(v: number): Centavos {
  return meioParaLongeDoZero(v);
}

/** Arredonda para o real inteiro mais próximo (múltiplo de 100 centavos). */
export function arredondarReal(v: Centavos): Centavos {
  return meioParaLongeDoZero(v / 100) * 100;
}

export function formatarBRL(v: Centavos): string {
  const abs = Math.abs(v);
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cent = String(abs % 100).padStart(2, "0");
  return `${v < 0 ? "-" : ""}R$ ${reais},${cent}`;
}
