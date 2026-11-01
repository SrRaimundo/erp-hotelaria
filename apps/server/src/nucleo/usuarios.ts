import { randomBytes, randomInt, scrypt as scryptCb, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";
import type { UsuarioSessao } from "./permissoes.js";

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
  /** `trocarSenha`: exige a troca da senha no primeiro acesso (padrão: não). */
  opcoes: { trocarSenha?: boolean } = {},
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
      .values({ ...u, senha_hash: hash, senha_salt: salt, trocar_senha: opcoes.trocarSenha ? 1 : 0 })
      .execute();
    await auditar(tx, { ator, acao: "usuario.criar", alvoTipo: "usuario", alvoId: u.id, dados: u });
    await registrarEvento(tx, "nucleo.UsuarioCriado", { usuarioId: u.id });
    return u;
  });
}

/** Valida login/senha e devolve o id do usuário; erro genérico para não revelar qual falhou. */
export async function verificarCredenciais(ctx: Contexto, login: string, senha: string): Promise<string> {
  const l = await ctx.db.selectFrom("usuarios").select(["id", "senha_hash", "senha_salt", "ativo"]).where("login", "=", login).executeTakeFirst();
  if (!l || !(await senhaConfere(senha, l.senha_hash, l.senha_salt))) {
    throw new ErroDominio("CREDENCIAIS_INVALIDAS", "Login ou senha incorretos. Confira e tente de novo.");
  }
  // Só depois de conferir a senha: quem não a sabe não descobre quais logins existem ou estão desativados.
  if (l.ativo !== 1) throw new ErroDominio("USUARIO_DESATIVADO", "Este usuário está desativado. Procure o administrador.");
  return l.id;
}

export const TAM_MIN_SENHA = 6;

/** O próprio usuário troca a senha: confere a atual, grava o novo hash e desliga o aviso de troca obrigatória. */
export async function trocarSenha(ctx: Contexto, usuarioId: string, senhaAtual: string, novaSenha: string): Promise<void> {
  if (novaSenha.length < TAM_MIN_SENHA) {
    throw new ErroDominio("SENHA_INVALIDA", `A nova senha deve ter pelo menos ${TAM_MIN_SENHA} caracteres.`);
  }
  if (novaSenha === senhaAtual) throw new ErroDominio("SENHA_INVALIDA", "A nova senha deve ser diferente da senha atual.");
  const l = await ctx.db.selectFrom("usuarios").select(["senha_hash", "senha_salt"]).where("id", "=", usuarioId).executeTakeFirst();
  if (!l || !(await senhaConfere(senhaAtual, l.senha_hash, l.senha_salt))) {
    throw new ErroDominio("CREDENCIAIS_INVALIDAS", "A senha atual não confere. Confira e tente de novo.");
  }
  const { hash, salt } = await hashSenha(novaSenha);
  await emTransacao(ctx, async (tx) => {
    await tx.db.updateTable("usuarios").set({ senha_hash: hash, senha_salt: salt, trocar_senha: 0 }).where("id", "=", usuarioId).execute();
    await auditar(tx, { ator: usuarioId, acao: "usuario.trocar_senha", alvoTipo: "usuario", alvoId: usuarioId });
  });
}

export type UsuarioLista = {
  id: string;
  nome: string;
  login: string;
  perfil: string;
  perfilRotulo: string;
  ativo: boolean;
  ultimoAcesso: string | null;
  trocarSenha: boolean;
};

export async function listarUsuarios(ctx: Contexto): Promise<UsuarioLista[]> {
  const linhas = await ctx.db
    .selectFrom("usuarios")
    .innerJoin("perfis", "perfis.nome", "usuarios.perfil")
    .select(["usuarios.id", "usuarios.nome", "usuarios.login", "usuarios.perfil", "perfis.rotulo", "usuarios.ativo", "usuarios.ultimo_acesso", "usuarios.trocar_senha"])
    .orderBy("usuarios.nome")
    .orderBy("usuarios.login")
    .execute();
  return linhas.map((u) => ({
    id: u.id,
    nome: u.nome,
    login: u.login,
    perfil: u.perfil,
    perfilRotulo: u.rotulo,
    ativo: u.ativo === 1,
    ultimoAcesso: u.ultimo_acesso,
    trocarSenha: u.trocar_senha === 1,
  }));
}

/** Mudança hipotética a avaliar antes de gravar. */
export type SimulacaoAdministrador = {
  /** Usuário afetado (será desativado ou trocará de perfil). */
  usuarioId?: string;
  inativar?: boolean;
  novoPerfil?: string;
  /** Permissões que um perfil passaria a ter (edição de perfil). */
  permissoesDoPerfil?: { perfil: string; permissoes: string[] };
};

/**
 * Garante que, após a mudança simulada, reste ao menos um usuário ATIVO cujo perfil tenha `config.gerenciar`.
 * Avalia pelos dados de perfil_permissoes (não pelo nome do perfil). Reutilizado pela gestão de perfis.
 */
export async function exigirAdministradorRestante(tx: Contexto, simulacao: SimulacaoAdministrador): Promise<void> {
  const ativos = await tx.db.selectFrom("usuarios").select(["id", "perfil"]).where("ativo", "=", 1).execute();
  const perms = await tx.db.selectFrom("perfil_permissoes").select(["perfil", "permissao"]).where("permissao", "=", "config.gerenciar").execute();
  const antes = new Set(perms.map((p) => p.perfil));
  const depois = new Set(antes);
  if (simulacao.permissoesDoPerfil) {
    const { perfil, permissoes } = simulacao.permissoesDoPerfil;
    if (permissoes.includes("config.gerenciar")) depois.add(perfil);
    else depois.delete(perfil);
  }
  const totalAntes = ativos.filter((u) => antes.has(u.perfil)).length;
  const totalDepois = ativos.filter((u) => {
    if (u.id === simulacao.usuarioId) {
      if (simulacao.inativar) return false;
      return depois.has(simulacao.novoPerfil ?? u.perfil);
    }
    return depois.has(u.perfil);
  }).length;
  // Só bloqueia quando a mudança de fato tira o último administrador; mudança alheia não é barrada.
  if (totalDepois === 0 && totalDepois < totalAntes) {
    throw new ErroDominio("ULTIMO_ADMINISTRADOR", "Deve restar ao menos um administrador ativo, com permissão de configurar a pousada.");
  }
}

async function obterUsuario(tx: Contexto, id: string): Promise<{ id: string; nome: string; perfil: string; ativo: number }> {
  const u = await tx.db.selectFrom("usuarios").select(["id", "nome", "perfil", "ativo"]).where("id", "=", id).executeTakeFirst();
  if (!u) throw new ErroDominio("USUARIO_NAO_ENCONTRADO", "Usuário não encontrado.");
  return u;
}

export async function editarUsuario(
  ctx: Contexto,
  id: string,
  d: { nome: string; perfil: string },
  autor: UsuarioSessao,
): Promise<{ id: string; nome: string; perfil: string }> {
  return emTransacao(ctx, async (tx) => {
    const atual = await obterUsuario(tx, id);
    const perfil = await tx.db.selectFrom("perfis").select("nome").where("nome", "=", d.perfil).executeTakeFirst();
    if (!perfil) throw new ErroDominio("PERFIL_INVALIDO", `O perfil "${d.perfil}" não existe. Escolha um perfil cadastrado.`);
    if (d.perfil !== atual.perfil) {
      if (id === autor.id) throw new ErroDominio("OPERACAO_SOBRE_SI", "Você não pode mudar o seu próprio perfil. Peça a outro administrador.");
      if (atual.ativo === 1) await exigirAdministradorRestante(tx, { usuarioId: id, novoPerfil: d.perfil });
    }
    await tx.db.updateTable("usuarios").set({ nome: d.nome, perfil: d.perfil }).where("id", "=", id).execute();
    await auditar(tx, {
      ator: autor.id,
      acao: "usuario.editar",
      alvoTipo: "usuario",
      alvoId: id,
      dados: { de: { nome: atual.nome, perfil: atual.perfil }, para: d },
    });
    return { id, nome: d.nome, perfil: d.perfil };
  });
}

export async function definirUsuarioAtivo(ctx: Contexto, id: string, ativo: boolean, autor: UsuarioSessao): Promise<void> {
  await emTransacao(ctx, async (tx) => {
    const atual = await obterUsuario(tx, id);
    if (!ativo) {
      if (id === autor.id) throw new ErroDominio("OPERACAO_SOBRE_SI", "Você não pode desativar o seu próprio usuário. Peça a outro administrador.");
      if (atual.ativo === 1) await exigirAdministradorRestante(tx, { usuarioId: id, inativar: true });
    }
    await tx.db.updateTable("usuarios").set({ ativo: ativo ? 1 : 0 }).where("id", "=", id).execute();
    if (!ativo) await tx.db.deleteFrom("sessoes").where("usuario_id", "=", id).execute();
    await auditar(tx, { ator: autor.id, acao: ativo ? "usuario.reativar" : "usuario.desativar", alvoTipo: "usuario", alvoId: id });
    await registrarEvento(tx, ativo ? "nucleo.UsuarioReativado" : "nucleo.UsuarioDesativado", { usuarioId: id });
  });
}

const ALFABETO_TEMPORARIA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // sem 0 O 1 l I

function gerarSenhaTemporaria(): string {
  return Array.from({ length: 8 }, () => ALFABETO_TEMPORARIA[randomInt(ALFABETO_TEMPORARIA.length)]).join("");
}

/** Gera senha temporária (mostrada uma única vez), exige troca no próximo acesso e encerra as sessões do usuário. */
export async function redefinirSenha(ctx: Contexto, id: string, autor: UsuarioSessao): Promise<{ senhaTemporaria: string }> {
  if (id === autor.id) throw new ErroDominio("OPERACAO_SOBRE_SI", "Você não pode redefinir a sua própria senha por aqui. Use Trocar senha.");
  const senhaTemporaria = gerarSenhaTemporaria();
  const { hash, salt } = await hashSenha(senhaTemporaria);
  await emTransacao(ctx, async (tx) => {
    await obterUsuario(tx, id);
    await tx.db.updateTable("usuarios").set({ senha_hash: hash, senha_salt: salt, trocar_senha: 1 }).where("id", "=", id).execute();
    await tx.db.deleteFrom("sessoes").where("usuario_id", "=", id).execute();
    await auditar(tx, { ator: autor.id, acao: "usuario.redefinir_senha", alvoTipo: "usuario", alvoId: id });
  });
  return { senhaTemporaria };
}
