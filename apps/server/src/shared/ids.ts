import { randomUUID } from "node:crypto";

export function novoId(): string {
  return randomUUID();
}
