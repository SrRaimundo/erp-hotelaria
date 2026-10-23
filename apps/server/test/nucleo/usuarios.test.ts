import { describe, expect, test } from "vitest";
import { criarContextoTeste } from "../ajuda.js";
import { exigirPermissao } from "../../src/nucleo/permissoes.js";
import { entrar, sair, sessaoPorToken } from "../../src/nucleo/sessoes.js";
import { autorizarSupervisor } from "../../src/nucleo/supervisor.js";
import { criarUsuario } from "../../src/nucleo/usuarios.js";

describe("usuários, sessão e supervisor", () => {
  test("admin inicial entra com trocarSenha e todas as permissões", async () => {
    const ctx = await criarContextoTeste();
    const { token, usuario } = await entrar(ctx, "admin", "admin");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(usuario).toMatchObject({ perfil: "admin", limiteDesconto: 100, trocarSenha: true });
    expect(usuario.permissoes).toHaveLength(11);
    expect(await sessaoPorToken(ctx, token)).toEqual(usuario);
    await sair(ctx, token);
    expect(await sessaoPorToken(ctx, token)).toBeUndefined();
  });

  test("login errado", async () => {
    const ctx = await criarContextoTeste();
    await expect(entrar(ctx, "admin", "x")).rejects.toMatchObject({ codigo: "CREDENCIAIS_INVALIDAS" });
    await expect(entrar(ctx, "ninguem", "admin")).rejects.toMatchObject({ codigo: "CREDENCIAIS_INVALIDAS" });
  });

  test("perfis padrão e login único", async () => {
    const ctx = await criarContextoTeste();
    await criarUsuario(ctx, { nome: "Rec", login: "rec", senha: "123", perfil: "recepcao" }, "admin");
    await criarUsuario(ctx, { nome: "Gov", login: "gov", senha: "123", perfil: "governanca" }, "admin");
    await expect(criarUsuario(ctx, { nome: "Rec2", login: "rec", senha: "1", perfil: "recepcao" }, "admin")).rejects.toMatchObject({ codigo: "LOGIN_DUPLICADO" });
    await expect(criarUsuario(ctx, { nome: "X", login: "x", senha: "1", perfil: "inexistente" }, "admin")).rejects.toMatchObject({ codigo: "PERFIL_INVALIDO" });
    const rec = (await entrar(ctx, "rec", "123")).usuario;
    expect(rec.limiteDesconto).toBe(5);
    expect(rec.trocarSenha).toBe(false);
    for (const p of ["cadastros.gerenciar", "tarifas.gerenciar", "config.gerenciar", "supervisor"]) expect(rec.permissoes).not.toContain(p);
    expect(rec.permissoes).toHaveLength(7);
    const gov = (await entrar(ctx, "gov", "123")).usuario;
    expect(gov.permissoes).toEqual(["quartos.situacao"]);
    expect(() => exigirPermissao(gov, "caixa.operar")).toThrowError(expect.objectContaining({ codigo: "SEM_PERMISSAO" }));
  });

  test("supervisor exige motivo e permissão", async () => {
    const ctx = await criarContextoTeste();
    await criarUsuario(ctx, { nome: "Rec", login: "rec", senha: "123", perfil: "recepcao" }, "admin");
    await expect(autorizarSupervisor(ctx, { login: "admin", senha: "admin" }, "  ")).rejects.toMatchObject({ codigo: "MOTIVO_OBRIGATORIO" });
    await expect(autorizarSupervisor(ctx, { login: "rec", senha: "123" }, "ok")).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await expect(autorizarSupervisor(ctx, undefined, "ok")).rejects.toMatchObject({ codigo: "SUPERVISOR_NECESSARIO" });
    await expect(autorizarSupervisor(ctx, { login: "admin", senha: "errada" }, "ok")).rejects.toMatchObject({ codigo: "CREDENCIAIS_INVALIDAS" });
    expect(await autorizarSupervisor(ctx, { login: "admin", senha: "admin" }, " cortesia ")).toEqual({ supervisorId: "usuario-admin", motivo: "cortesia" });
  });
});
