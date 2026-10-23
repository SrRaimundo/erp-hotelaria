export class ErroDominio extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
    public readonly detalhes?: unknown,
  ) {
    super(mensagem);
    this.name = "ErroDominio";
  }
}
