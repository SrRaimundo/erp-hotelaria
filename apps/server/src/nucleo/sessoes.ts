import { randomBytes } from "node:crypto";
import type { Contexto } from "../shared/contexto.js";
import type { UsuarioSessao } from "./permissoes.js";
import { verificarCredenciais } from "./usuarios.js";

export async function carregarUsuarioSessao(ctx: Contexto, usuarioId: string): Promise<UsuarioSessao | undefined> {
  const u = await ctx.db
    .selectFrom("usuarios")
    .innerJoin("perfis", "perfis.nome", "usuarios.perfil")
    .select(["usuarios.id", "usuarios.nome", "usuarios.perfil", "usuarios.trocar_senha", "perfis.limite_desconto"])
    .where("usuarios.id", "=", usuarioId)
    .executeTakeFirst();
  if (!u) return undefined;
  const perms = await ctx.db.selectFrom("perfil_permissoes").select("permissao").where("perfil", "=", u.perfil).orderBy("permissao").execute();
  return {
    id: u.id,
    nome: u.nome,
    perfil: u.perfil,
    permissoes: perms.map((p) => p.permissao),
    limiteDesconto: u.limite_desconto,
    trocarSenha: u.trocar_senha === 1,
  };
}

export async function entrar(ctx: Contexto, login: string, senha: string): Promise<{ token: string; usuario: UsuarioSessao }> {
  const usuarioId = await verificarCredenciais(ctx, login, senha);
  const token = randomBytes(32).toString("hex");
  await ctx.db.insertInto("sessoes").values({ token, usuario_id: usuarioId, criada_em: ctx.relogio.agora().toISOString() }).execute();
  const usuario = (await carregarUsuarioSessao(ctx, usuarioId))!;
  return { token, usuario };
}

export async function sessaoPorToken(ctx: Contexto, token: string): Promise<UsuarioSessao | undefined> {
  const s = await ctx.db.selectFrom("sessoes").select("usuario_id").where("token", "=", token).executeTakeFirst();
  return s ? carregarUsuarioSessao(ctx, s.usuario_id) : undefined;
}

export async function sair(ctx: Contexto, token: string): Promise<void> {
  await ctx.db.deleteFrom("sessoes").where("token", "=", token).execute();
}
