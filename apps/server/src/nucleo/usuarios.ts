import { randomBytes, scrypt as scryptCb, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";

const scrypt = promisify(scryptCb) as (senha: string, salt: Buffer, tam: number) => Promise<Buffer>;
const TAM_CHAVE = 64;

/** Hash síncrono, usado apenas pela migração (seed do admin). */
export function hashSenhaSync(senha: string): { hash: string; salt: string } {
  const salt = randomBytes(16);
  return { hash: scryptSync(senha, salt, TAM_CHAVE).toString("hex"), salt: salt.toString("hex") };
}

async function hashSenha(senha: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16);
  return { hash: (await scrypt(senha, salt, TAM_CHAVE)).toString("hex"), salt: salt.toString("hex") };
}

async function senhaConfere(senha: string, hash: string, salt: string): Promise<boolean> {
  const esperado = Buffer.from(hash, "hex");
  const obtido = await scrypt(senha, Buffer.from(salt, "hex"), TAM_CHAVE);
  return esperado.length === obtido.length && timingSafeEqual(esperado, obtido);
}

export type Usuario = { id: string; nome: string; login: string; perfil: string };

export async function criarUsuario(
  ctx: Contexto,
  d: { nome: string; login: string; senha: string; perfil: string },
  ator: string,
): Promise<Usuario> {
  const { hash, salt } = await hashSenha(d.senha);
  return emTransacao(ctx, async (tx) => {
    const perfil = await tx.db.selectFrom("perfis").select("nome").where("nome", "=", d.perfil).executeTakeFirst();
    if (!perfil) throw new ErroDominio("PERFIL_INVALIDO", `O perfil "${d.perfil}" não existe. Escolha um perfil cadastrado.`);
    const dup = await tx.db.selectFrom("usuarios").select("id").where("login", "=", d.login).executeTakeFirst();
    if (dup) throw new ErroDominio("LOGIN_DUPLICADO", `Já existe um usuário com o login ${d.login}. Use outro login.`);
    const u: Usuario = { id: novoId(), nome: d.nome, login: d.login, perfil: d.perfil };
    await tx.db
      .insertInto("usuarios")
      .values({ ...u, senha_hash: hash, senha_salt: salt, trocar_senha: 0 })
      .execute();
    await auditar(tx, { ator, acao: "usuario.criar", alvoTipo: "usuario", alvoId: u.id, dados: u });
    await registrarEvento(tx, "nucleo.UsuarioCriado", { usuarioId: u.id });
    return u;
  });
}

/** Valida login/senha e devolve o id do usuário; erro genérico para não revelar qual falhou. */
export async function verificarCredenciais(ctx: Contexto, login: string, senha: string): Promise<string> {
  const l = await ctx.db.selectFrom("usuarios").select(["id", "senha_hash", "senha_salt"]).where("login", "=", login).executeTakeFirst();
  if (!l || !(await senhaConfere(senha, l.senha_hash, l.senha_salt))) {
    throw new ErroDominio("CREDENCIAIS_INVALIDAS", "Login ou senha incorretos. Confira e tente de novo.");
  }
  return l.id;
}
