import { Barramento } from "../src/infra/barramento.js";
import { entrar } from "../src/nucleo/sessoes.js";
import { criarUsuario } from "../src/nucleo/usuarios.js";
import { abrirBanco, migrar } from "../src/shared/banco.js";
import type { Contexto } from "../src/shared/contexto.js";
import { todasMigracoes } from "../src/shared/migracoes.js";
import { RelogioFixo } from "../src/shared/relogio.js";

export async function criarContextoTeste(
  iso = "2026-11-10T15:00:00Z",
): Promise<Contexto & { relogio: RelogioFixo; barramento: Barramento }> {
  const db = abrirBanco(":memory:");
  await migrar(db, todasMigracoes);
  return { db, relogio: new RelogioFixo(iso), barramento: new Barramento(), eventosPendentes: [] };
}

/** Entra com um usuário do perfil pedido (criando-o se preciso) e devolve o cabeçalho Bearer. */
export async function entrarComo(ctx: Contexto, perfil: "admin" | "recepcao" | "governanca"): Promise<{ authorization: string }> {
  let login = "admin";
  let senha = "admin";
  if (perfil !== "admin") {
    login = `teste-${perfil}`;
    senha = "senha-teste";
    const existe = await ctx.db.selectFrom("usuarios").select("id").where("login", "=", login).executeTakeFirst();
    if (!existe) await criarUsuario(ctx, { nome: `Teste ${perfil}`, login, senha, perfil }, "admin");
  }
  const { token } = await entrar(ctx, login, senha);
  return { authorization: `Bearer ${token}` };
}
