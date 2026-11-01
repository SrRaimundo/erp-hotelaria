import { beforeEach, describe, expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { carregarUsuarioSessao, entrar, sessaoPorToken } from "../../src/nucleo/sessoes.js";
import { criarUsuario, definirUsuarioAtivo, editarUsuario, exigirAdministradorRestante, listarUsuarios, redefinirSenha } from "../../src/nucleo/usuarios.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { ErroDominio } from "../../src/shared/erros.js";
import { emTransacao } from "../../src/shared/contexto.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

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

describe("permissões das rotas de usuários (R4)", () => {
  test("governança e perfil só com cadastros.gerenciar recebem 403 em criar, listar e editar", async () => {
    const app = criarApp(ctx);
    await ctx.db.insertInto("perfis").values({ nome: "cadastrista", limite_desconto: 0 }).execute();
    await ctx.db.insertInto("perfil_permissoes").values({ perfil: "cadastrista", permissao: "cadastros.gerenciar" }).execute();
    await criarUsuario(ctx, { nome: "Cad", login: "cad", senha: "senha-cad", perfil: "cadastrista" }, "usuario-admin");
    const cad = { authorization: `Bearer ${(await entrar(ctx, "cad", "senha-cad")).token}` };
    const gov = await entrarComo(ctx, "governanca");
    const novo = { nome: "Zé", login: "ze", senha: "senha-ze", perfil: "recepcao" };
    for (const h of [cad, gov]) {
      expect((await app.inject({ method: "POST", url: "/api/usuarios", headers: h, payload: novo })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/api/usuarios", headers: h })).statusCode).toBe(403);
      expect((await app.inject({ method: "PUT", url: `/api/usuarios/${ana}`, headers: h, payload: { nome: "x", perfil: "recepcao" } })).statusCode).toBe(403);
    }
    const adm = { authorization: `Bearer ${(await entrar(ctx, "admin", "admin")).token}` };
    expect((await app.inject({ method: "POST", url: "/api/usuarios", headers: adm, payload: novo })).statusCode).toBe(201);
  });
});

describe("exigirAdministradorRestante", () => {
  const checar = (s: Parameters<typeof exigirAdministradorRestante>[1]) => emTransacao(ctx, (tx) => exigirAdministradorRestante(tx, s));

  test("edição de permissões do único perfil administrador que tira config.gerenciar → ULTIMO_ADMINISTRADOR", async () => {
    const e = await erro(checar({ permissoesDoPerfil: { perfil: "admin", permissoes: ["reservas.gerenciar"] } }));
    expect(e.codigo).toBe("ULTIMO_ADMINISTRADOR");
    // manter a permissão, ou editar outro perfil, não bloqueia
    await checar({ permissoesDoPerfil: { perfil: "admin", permissoes: ["config.gerenciar"] } });
    await checar({ permissoesDoPerfil: { perfil: "recepcao", permissoes: [] } });
  });

  test("mudança de perfil é aceita quando há dois administradores ativos", async () => {
    const b = await criarUsuario(ctx, { nome: "Beto", login: "beto", senha: "senha-beto", perfil: "admin" }, "usuario-admin");
    const r = await editarUsuario(ctx, b.id, { nome: "Beto", perfil: "recepcao" }, admin);
    expect(r.perfil).toBe("recepcao");
  });

  test("mudança de usuário não administrador não é barrada, mesmo sem administradores ativos", async () => {
    await ctx.db.updateTable("usuarios").set({ ativo: 0 }).where("id", "=", "usuario-admin").execute();
    await checar({ usuarioId: ana, inativar: true });
    await checar({ usuarioId: ana, novoPerfil: "governanca" });
  });
});

describe("redefinir a própria senha e senha inicial", () => {
  test("R9: redefinir a própria senha → OPERACAO_SOBRE_SI, sem mudar a senha nem as sessões", async () => {
    const { token } = await entrar(ctx, "admin", "admin");
    expect((await erro(redefinirSenha(ctx, admin.id, admin))).codigo).toBe("OPERACAO_SOBRE_SI");
    expect(await sessaoPorToken(ctx, token)).toBeDefined();
    expect((await entrar(ctx, "admin", "admin")).usuario.id).toBe(admin.id);
    const app = criarApp(ctx);
    const r = await app.inject({ method: "POST", url: `/api/usuarios/${admin.id}/redefinir-senha`, headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(422);
    expect(r.json().codigo).toBe("OPERACAO_SOBRE_SI");
    expect(await ctx.db.selectFrom("auditoria").select("id").where("acao", "=", "usuario.redefinir_senha").execute()).toHaveLength(0);
  });

  test("M9: senha inicial com menos de 6 caracteres é recusada (400); com 6 vale", async () => {
    const app = criarApp(ctx);
    const adm = await entrarComo(ctx, "admin");
    const base = { nome: "Zé", login: "ze", perfil: "recepcao" };
    expect((await app.inject({ method: "POST", url: "/api/usuarios", headers: adm, payload: { ...base, senha: "12345" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/usuarios", headers: adm, payload: { ...base, senha: "123456" } })).statusCode).toBe(201);
  });
});

describe("permissão revogada vale na requisição seguinte", () => {
  test("perfil sem usuários ativos (só inativos) segue com usuários; revogar permissão → 403 na próxima requisição", async () => {
    const app = criarApp(ctx);
    await ctx.db.insertInto("perfis").values({ nome: "caixa2", rotulo: "Caixa 2", limite_desconto: 0 }).execute();
    await ctx.db.insertInto("perfil_permissoes").values({ perfil: "caixa2", permissao: "cadastros.gerenciar" }).execute();
    const u = await criarUsuario(ctx, { nome: "Cai", login: "cai", senha: "senha-cai", perfil: "caixa2" }, "usuario-admin");
    const h = { authorization: `Bearer ${(await entrar(ctx, "cai", "senha-cai")).token}` };
    expect((await app.inject({ method: "GET", url: "/api/categorias?incluirInativos=1", headers: h })).statusCode).toBe(200);
    const adm = await entrarComo(ctx, "admin");
    const ed = await app.inject({ method: "PUT", url: "/api/perfis/caixa2", headers: adm, payload: { permissoes: ["reservas.gerenciar"] } });
    expect(ed.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/categorias?incluirInativos=1", headers: h })).statusCode).toBe(403);
    // desativado, o usuário continua contando: o perfil não pode ser excluído
    await definirUsuarioAtivo(ctx, u.id, false, admin);
    const ex = await app.inject({ method: "DELETE", url: "/api/perfis/caixa2", headers: adm });
    expect(ex.statusCode).toBe(422);
    expect(ex.json().codigo).toBe("PERFIL_COM_USUARIOS");
  });
});
