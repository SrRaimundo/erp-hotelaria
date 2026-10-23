import type { Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { exigirPermissao } from "./permissoes.js";
import { carregarUsuarioSessao } from "./sessoes.js";
import { verificarCredenciais } from "./usuarios.js";

/** Ações sensíveis exigem credencial de supervisor e motivo. */
export async function autorizarSupervisor(
  ctx: Contexto,
  cred: { login: string; senha: string } | undefined,
  motivo: string | undefined,
): Promise<{ supervisorId: string; motivo: string }> {
  if (!cred) {
    throw new ErroDominio("SUPERVISOR_NECESSARIO", "Esta ação precisa da autorização de um supervisor. Peça que ele informe login e senha.");
  }
  const texto = motivo?.trim();
  if (!texto) throw new ErroDominio("MOTIVO_OBRIGATORIO", "Informe o motivo desta ação.");
  const id = await verificarCredenciais(ctx, cred.login, cred.senha);
  const u = (await carregarUsuarioSessao(ctx, id))!;
  exigirPermissao(u, "supervisor");
  return { supervisorId: id, motivo: texto };
}
