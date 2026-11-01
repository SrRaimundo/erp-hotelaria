import { randomUUID } from "node:crypto";

export type UUID = string & { readonly __brand: "UUID" };

export function novoId(): UUID {
  return randomUUID() as UUID;
}

export function gerarUUID(): UUID {
  return novoId();
}
