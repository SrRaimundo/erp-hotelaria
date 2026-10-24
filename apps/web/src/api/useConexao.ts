import { useSyncExternalStore } from "react";
import { aoMudarConexao, estaOnline } from "./cliente";

/** `online` fica false quando a última chamada falhou com SEM_CONEXAO e volta a true na próxima resposta. */
export function useConexao(): { online: boolean } {
  return { online: useSyncExternalStore(aoMudarConexao, estaOnline) };
}
