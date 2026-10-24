import type { HTMLAttributes } from "react";

export function Cartao({ className, ...resto }: HTMLAttributes<HTMLDivElement>) {
  return <div {...resto} className={["cartao", className].filter(Boolean).join(" ")} />;
}
