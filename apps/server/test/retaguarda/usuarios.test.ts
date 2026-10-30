import { beforeEach, describe, expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { entrar, sessaoPorToken } from "../../src/nucleo/sessoes.js";
import { criarUsuario, definirUsuarioAtivo, editarUsuario, listarUsuarios, redefinirSenha } from "../../src/nucleo/usuarios.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { carregarUsuarioSessao } from "../../src/nucleo/sessoes.js";
import { ErroDominio } from "../../src/shared/erros.js";
import { criarContextoTeste } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let admin: UsuarioSessao;
let ana: string;

const erro = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroDominio) return e;
    throw e;
  }
  throw new Error("esperava ErroDominio");
};

beforeEach(async () => {
  ctx = await criarContextoTeste();
  admin = (await carregarUsuarioSessao(ctx, "usuario-admin"))!;
  ana = (await criarUsuario(ctx, { nome: "Ana", login: "ana", senha: "senha-ana", perfil: "recepcao" }, "usuario-admin")).id;
});

describe("usuários", () => {
  test("desativar encerra sessões e impede login", async () => {
    const { token } = await entrar(ctx, "ana", "senha-ana");
    expect(await sessaoPorToken(ctx, token)).toBeDefined();
    await definirUsuarioAtivo(ctx, ana, false, admin);
    expect(await ctx.db.selectFrom("sessoes").select("token").where("usuario_id", "=", ana).execute()).toHaveLength(0);
    expect(await sessaoPorToken(ctx, token)).toBeUndefined();
    expect((await erro(entrar(ctx, "ana", "senha-ana"))).codigo).toBe("USUARIO_DESATIVADO");
    expect(await ctx.db.selectFrom("auditoria").select("id").where("acao", "=", "usuario.desativar").execute()).toHaveLength(1);
    await definirUsuarioAtivo(ctx, ana, true, admin);
    expect((await entrar(ctx, "ana", "senha-ana")).usuario.id).toBe(ana);
    expect(await ctx.db.selectFrom("auditoria").select("id").where("acao", "=", "usuario.reativar").execute()).toHaveLength(1);
  });

  test("sessão aberta de usuário inativo (sem apagar a sessão) não vale", async () => {
    const { token } = await entrar(ctx, "ana", "senha-ana");
    await ctx.db.updateTable("usuarios").set({ ativo: 0 }).where("id", "=", ana).execute();
    expect(await sessaoPorToken(ctx, token)).toBeUndefined();
  });

  test("Review Focus 4: redefinir senha encerra as sessões e devolve senha de 8 caracteres", async () => {
    const { token } = await entrar(ctx, "ana", "senha-ana");
    const r = await redefinirSenha(ctx, ana, admin);
    expect(r.senhaTemporaria).toHaveLength(8);
    expect(r.senhaTemporaria).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(r.senhaTemporaria).not.toMatch(/[0O1lI]/);
    expect(await sessaoPorToken(ctx, token)).toBeUndefined();
    expect((await erro(entrar(ctx, "ana", "senha-ana"))).codigo).toBe("CREDENCIAIS_INVALIDAS");
    const novo = await entrar(ctx, "ana", r.senhaTemporaria);
    expect(novo.usuario.trocarSenha).toBe(true);
    expect(await ctx.db.selectFrom("auditoria").select("id").where("acao", "=", "usuario.redefinir_senha").execute()).toHaveLength(1);
  });

  test("redefinir senha pela API: 401 na sessão antiga, 403 sem config.gerenciar", async () => {
    const app = criarApp(ctx);
    const adm = { authorization: `Bearer ${(await entrar(ctx, "admin", "admin")).token}` };
    const antigo = { authorization: `Bearer ${(await entrar(ctx, "ana", "senha-ana")).token}` };
    expect((await app.inject({ method: "POST", url: `/api/usuarios/${ana}/redefinir-senha`, headers: antigo })).statusCode).toBe(403);
    const r = await app.inject({ method: "POST", url: `/api/usuarios/${ana}/redefinir-senha`, headers: adm });
    expect(r.statusCode).toBe(200);
    expect(r.json().senhaTemporaria).toHaveLength(8);
    expect((await app.inject({ method: "GET", url: "/api/config", headers: antigo })).statusCode).toBe(401);
    const lista = await app.inject({ method: "GET", url: "/api/usuarios", headers: adm });
    expect(lista.statusCode).toBe(200);
    expect(lista.json().map((u: { login: string }) => u.login).sort()).toEqual(["admin", "ana"]);
    expect((await app.inject({ method: "POST", url: `/api/usuarios/${ana}/desativar`, headers: adm })).statusCode).toBe(204);
    expect((await app.inject({ method: "POST", url: `/api/usuarios/${ana}/reativar`, headers: adm })).statusCode).toBe(204);
    const ed = await app.inject({ method: "PUT", url: `/api/usuarios/${ana}`, headers: adm, payload: { nome: "Ana Maria", perfil: "governanca" } });
    expect(ed.json()).toMatchObject({ nome: "Ana Maria", perfil: "governanca" });
  });

  test("não desativa a si mesmo nem muda o próprio perfil", async () => {
    expect((await erro(definirUsuarioAtivo(ctx, admin.id, false, admin))).codigo).toBe("OPERACAO_SOBRE_SI");
    expect((await erro(editarUsuario(ctx, admin.id, { nome: "Admin", perfil: "recepcao" }, admin))).codigo).toBe("OPERACAO_SOBRE_SI");
    // mudar só o nome de si mesmo é permitido
    const u = await editarUsuario(ctx, admin.id, { nome: "Dono", perfil: "admin" }, admin);
    expect(u.nome).toBe("Dono");
  });

  test("não desativa nem rebaixa o último administrador ativo", async () => {
    const outro = await criarUsuario(ctx, { nome: "Beto", login: "beto", senha: "senha-beto", perfil: "admin" }, "usuario-admin");
    const beto = (await carregarUsuarioSessao(ctx, outro.id))!;
    // com dois administradores, um pode sair
    await definirUsuarioAtivo(ctx, beto.id, false, admin);
    // agora o admin é o único ativo; outro admin (inativo) não conta
    const e1 = await erro(definirUsuarioAtivo(ctx, "usuario-admin", false, beto));
    expect(e1.codigo).toBe("ULTIMO_ADMINISTRADOR");
    const e2 = await erro(editarUsuario(ctx, "usuario-admin", { nome: "Administrador", perfil: "recepcao" }, beto));
    expect(e2.codigo).toBe("ULTIMO_ADMINISTRADOR");
    expect((await ctx.db.selectFrom("usuarios").select("ativo").where("id", "=", "usuario-admin").executeTakeFirstOrThrow()).ativo).toBe(1);
  });

  test("lista traz último acesso após login, perfil e rótulo", async () => {
    let l = await listarUsuarios(ctx);
    expect(l.find((u) => u.login === "ana")).toMatchObject({ nome: "Ana", perfil: "recepcao", perfilRotulo: "Recepção", ativo: true, ultimoAcesso: null });
    await entrar(ctx, "ana", "senha-ana");
    l = await listarUsuarios(ctx);
    const a = l.find((u) => u.login === "ana")!;
    expect(a.ultimoAcesso).toBe(ctx.relogio.agora().toISOString());
    expect(l.find((u) => u.login === "admin")).toMatchObject({ perfilRotulo: "Administrador", trocarSenha: true, ultimoAcesso: null });
  });

  test("editar valida perfil e usuário inexistente", async () => {
    expect((await erro(editarUsuario(ctx, ana, { nome: "Ana", perfil: "naoexiste" }, admin))).codigo).toBe("PERFIL_INVALIDO");
    expect((await erro(editarUsuario(ctx, "x", { nome: "Ana", perfil: "recepcao" }, admin))).codigo).toBe("USUARIO_NAO_ENCONTRADO");
    expect(await ctx.db.selectFrom("auditoria").select("id").where("acao", "=", "usuario.editar").execute()).toHaveLength(0);
    await editarUsuario(ctx, ana, { nome: "Ana B", perfil: "governanca" }, admin);
    expect(await ctx.db.selectFrom("auditoria").select("id").where("acao", "=", "usuario.editar").execute()).toHaveLength(1);
  });
});
