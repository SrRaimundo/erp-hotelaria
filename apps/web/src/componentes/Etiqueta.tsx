import type { ReactNode } from "react";

export function Etiqueta({ tom = "neutro", children }: { tom?: "neutro" | "verde" | "terracota" | "amarelo"; children: ReactNode }) {
  return <span className={`etiqueta etiqueta--${tom}`}>{children}</span>;
}
