import { beforeEach, describe, expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { DESCRICOES_PERMISSOES, PERMISSOES } from "../../src/nucleo/permissoes.js";
import type { UsuarioSessao } from "../../src/nucleo/permissoes.js";
import { criarPerfil, editarPerfil, excluirPerfil, listarPerfis } from "../../src/nucleo/perfis.js";
import { carregarUsuarioSessao, entrar, sessaoPorToken } from "../../src/nucleo/sessoes.js";
import { criarUsuario, definirUsuarioAtivo, listarUsuarios } from "../../src/nucleo/usuarios.js";
import { ErroDominio } from "../../src/shared/erros.js";
import { criarContextoTeste } from "../ajuda.js";

let ctx: Awaited<ReturnType<typeof criarContextoTeste>>;
let admin: UsuarioSessao;

const erro = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroDominio) return e;
    throw e;
  }
  throw new Error("esperava ErroDominio");
};
const auditorias = async (acao: string) => (await ctx.db.selectFrom("auditoria").select("id").where("acao", "=", acao).execute()).length;

beforeEach(async () => {
  ctx = await criarContextoTeste();
  admin = (await carregarUsuarioSessao(ctx, "usuario-admin"))!;
});

describe("perfis", () => {
  test("lista os três padrão com rótulo, padrão e nº de usuários", async () => {
    await criarUsuario(ctx, { nome: "Ana", login: "ana", senha: "senha-ana", perfil: "recepcao" }, "usuario-admin");
    const l = await listarPerfis(ctx);
    expect(l.map((p) => [p.nome, p.rotulo, p.padrao, p.usuarios])).toEqual([
      ["admin", "Administrador", true, 1],
      ["recepcao", "Recepção", true, 1],
      ["governanca", "Governança", true, 0],
    ]);
    expect(l[1].limiteDesconto).toBe(5);
    expect(l[0].permissoes).toHaveLength(PERMISSOES.length);
    expect((await listarUsuarios(ctx)).find((u) => u.login === "ana")!.perfilRotulo).toBe("Recepção");
  });

  test("criar perfil copiando de recepcao e gerar nome único", async () => {
    const a = await criarPerfil(ctx, { rotulo: "Mensageiro", copiarDe: "recepcao" }, admin);
    expect(a.nome).toBe("mensageiro");
    expect(a.padrao).toBe(false);
    expect(a.limiteDesconto).toBe(5);
    const rec = (await listarPerfis(ctx)).find((p) => p.nome === "recepcao")!;
    expect(a.permissoes).toEqual(rec.permissoes);
    // o identificador não muda ao renomear; um novo perfil com o rótulo antigo ganha sufixo
    await editarPerfil(ctx, "mensageiro", { rotulo: "Carregador" }, admin);
    const b = await criarPerfil(ctx, { rotulo: "Mensageiro", copiarDe: "recepcao" }, admin);
    expect(b.nome).toBe("mensageiro-2");
    await editarPerfil(ctx, "mensageiro-2", { rotulo: "Mala" }, admin);
    const c = await criarPerfil(ctx, { rotulo: "Mensageiro", copiarDe: "governanca" }, admin);
    expect(c.nome).toBe("mensageiro-3");
    expect((await criarPerfil(ctx, { rotulo: "Auxiliar de Manutenção", copiarDe: "admin" }, admin)).nome).toBe("auxiliar-de-manutencao");
    expect((await erro(criarPerfil(ctx, { rotulo: "X", copiarDe: "nao-existe" }, admin))).codigo).toBe("PERFIL_NAO_ENCONTRADO");
    expect(await auditorias("perfil.criar")).toBe(4);
  });

  test("Review Focus 1: tirar config.gerenciar do perfil do único administrador → ULTIMO_ADMINISTRADOR", async () => {
    const g = await criarPerfil(ctx, { rotulo: "Gerente", copiarDe: "admin" }, admin);
    const bia = await criarUsuario(ctx, { nome: "Bia", login: "bia", senha: "senha-bia", perfil: g.nome }, "usuario-admin");
    const biaSessao = (await carregarUsuarioSessao(ctx, bia.id))!;
    // com dois administradores ativos a edição é permitida
    await editarPerfil(ctx, g.nome, { limiteDesconto: 50 }, admin);
    await definirUsuarioAtivo(ctx, "usuario-admin", false, biaSessao);
    const sem = g.permissoes.filter((p) => p !== "config.gerenciar");
    expect((await erro(editarPerfil(ctx, g.nome, { permissoes: sem }, biaSessao))).codigo).toBe("ULTIMO_ADMINISTRADOR");
    expect((await listarPerfis(ctx)).find((p) => p.nome === g.nome)!.permissoes).toContain("config.gerenciar");
  });

  test("admin não perde config.gerenciar (PERFIL_ADMIN_PROTEGIDO)", async () => {
    const sem = PERMISSOES.filter((p) => p !== "config.gerenciar");
    expect((await erro(editarPerfil(ctx, "admin", { permissoes: sem }, admin))).codigo).toBe("PERFIL_ADMIN_PROTEGIDO");
    await editarPerfil(ctx, "admin", { rotulo: "Dono" }, admin);
    expect((await listarPerfis(ctx)).find((p) => p.nome === "admin")!.rotulo).toBe("Dono");
  });

  test("editar rótulo, limite e permissões; valida entradas; audita", async () => {
    const p = await criarPerfil(ctx, { rotulo: "Mensageiro", copiarDe: "governanca" }, admin);
    const r = await editarPerfil(ctx, p.nome, { rotulo: "Mensageiro VIP", limiteDesconto: 10, permissoes: ["caixa.operar", "conta.lancar"] }, admin);
    expect(r).toMatchObject({ nome: "mensageiro", rotulo: "Mensageiro VIP", limiteDesconto: 10, permissoes: ["caixa.operar", "conta.lancar"] });
    expect((await erro(editarPerfil(ctx, p.nome, { permissoes: ["voar"] }, admin))).codigo).toBe("PERMISSAO_INVALIDA");
    expect((await erro(editarPerfil(ctx, "nada", { rotulo: "Y" }, admin))).codigo).toBe("PERFIL_NAO_ENCONTRADO");
    expect(await auditorias("perfil.editar")).toBe(1);
  });

  test("perfil com usuários não é excluído; padrão também não", async () => {
    const p = await criarPerfil(ctx, { rotulo: "Mensageiro", copiarDe: "recepcao" }, admin);
    await criarUsuario(ctx, { nome: "Cai", login: "cai", senha: "senha-cai", perfil: p.nome }, "usuario-admin");
    expect((await erro(excluirPerfil(ctx, p.nome, admin))).codigo).toBe("PERFIL_COM_USUARIOS");
    expect((await erro(excluirPerfil(ctx, "governanca", admin))).codigo).toBe("PERFIL_PADRAO");
    const q = await criarPerfil(ctx, { rotulo: "Vazio", copiarDe: "recepcao" }, admin);
    await excluirPerfil(ctx, q.nome, admin);
    expect((await listarPerfis(ctx)).map((x) => x.nome)).not.toContain(q.nome);
    expect(await ctx.db.selectFrom("perfil_permissoes").select("permissao").where("perfil", "=", q.nome).execute()).toHaveLength(0);
    expect(await auditorias("perfil.excluir")).toBe(1);
  });

  test("permissão retirada vale na próxima requisição da sessão aberta", async () => {
    const p = await criarPerfil(ctx, { rotulo: "Mensageiro", copiarDe: "recepcao" }, admin);
    await criarUsuario(ctx, { nome: "Cai", login: "cai", senha: "senha-cai", perfil: p.nome }, "usuario-admin");
    const { token } = await entrar(ctx, "cai", "senha-cai");
    expect((await sessaoPorToken(ctx, token))!.permissoes).toContain("caixa.operar");
    expect((await sessaoPorToken(ctx, token))!.limiteDesconto).toBe(5);
    await editarPerfil(ctx, p.nome, { limiteDesconto: 2, permissoes: ["reservas.gerenciar"] }, admin);
    const depois = (await sessaoPorToken(ctx, token))!;
    expect(depois.permissoes).toEqual(["reservas.gerenciar"]);
    expect(depois.limiteDesconto).toBe(2);
  });

  test("descrições das permissões conforme a spec", () => {
    expect(DESCRICOES_PERMISSOES).toEqual({
      "reservas.gerenciar": "Criar, alterar e cancelar reservas; ver hóspedes, mapa e painel",
      "hospedagem.checkin": "Fazer check-in",
      "hospedagem.checkout": "Fazer check-out",
      "conta.lancar": "Lançar extras, frigobar e estornos na conta do hóspede",
      "caixa.operar": "Abrir e fechar caixa e receber pagamentos",
      "quartos.situacao": "Preencher checklists de governança",
      "quartos.manutencao": "Resolver chamados, bloquear, liberar e pôr quartos em manutenção",
      "cadastros.gerenciar": "Cadastrar categorias, quartos e produtos",
      "tarifas.gerenciar": "Configurar tarifas",
      "config.gerenciar": "Configurar a pousada, usuários, perfis e checklists",
      supervisor: "Autorizar ações sensíveis com a senha de supervisor",
    });
    expect(Object.keys(DESCRICOES_PERMISSOES).sort()).toEqual([...PERMISSOES].sort());
  });

  test("API: CRUD de perfis exige config.gerenciar; /api/permissoes exige só sessão", async () => {
    const app = criarApp(ctx);
    await criarUsuario(ctx, { nome: "Ana", login: "ana", senha: "senha-ana", perfil: "recepcao" }, "usuario-admin");
    const adm = { authorization: `Bearer ${(await entrar(ctx, "admin", "admin")).token}` };
    const rec = { authorization: `Bearer ${(await entrar(ctx, "ana", "senha-ana")).token}` };
    expect((await app.inject({ method: "GET", url: "/api/perfis", headers: rec })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/perfis", headers: rec, payload: { rotulo: "X", copiarDe: "admin" } })).statusCode).toBe(403);
    const perm = await app.inject({ method: "GET", url: "/api/permissoes", headers: rec });
    expect(perm.statusCode).toBe(200);
    expect(perm.json()).toHaveLength(PERMISSOES.length);
    expect(perm.json()[0]).toHaveProperty("descricao");
    expect((await app.inject({ method: "GET", url: "/api/permissoes" })).statusCode).toBe(401);
    const c = await app.inject({ method: "POST", url: "/api/perfis", headers: adm, payload: { rotulo: "Mensageiro", copiarDe: "recepcao" } });
    expect(c.statusCode).toBe(201);
    expect(c.json().nome).toBe("mensageiro");
    const e = await app.inject({ method: "PUT", url: "/api/perfis/mensageiro", headers: adm, payload: { limiteDesconto: 7 } });
    expect(e.json().limiteDesconto).toBe(7);
    expect((await app.inject({ method: "PUT", url: "/api/perfis/mensageiro", headers: adm, payload: { limiteDesconto: 700 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/perfis", headers: adm })).json()).toHaveLength(4);
    expect((await app.inject({ method: "DELETE", url: "/api/perfis/mensageiro", headers: adm })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: "/api/perfis/admin", headers: adm })).json().codigo).toBe("PERFIL_PADRAO");
  });

  test("API: GET /api/sessoes/atual devolve o usuário com as permissões atuais do perfil", async () => {
    const app = criarApp(ctx);
    const { token, usuario } = await entrar(ctx, "admin", "admin");
    const headers = { authorization: `Bearer ${token}` };
    const antes = await app.inject({ method: "GET", url: "/api/sessoes/atual", headers });
    expect(antes.statusCode).toBe(200);
    expect(antes.json()).toEqual(usuario);
    await criarPerfil(ctx, { rotulo: "Mensageiro", copiarDe: "recepcao" }, admin);
    await criarUsuario(ctx, { nome: "Ana", login: "ana", senha: "senha-ana", perfil: "mensageiro" }, "usuario-admin");
    const ana = { authorization: `Bearer ${(await entrar(ctx, "ana", "senha-ana")).token}` };
    await editarPerfil(ctx, "mensageiro", { limiteDesconto: 9, permissoes: ["caixa.operar"] }, admin);
    const depois = (await app.inject({ method: "GET", url: "/api/sessoes/atual", headers: ana })).json();
    expect(depois.permissoes).toEqual(["caixa.operar"]);
    expect(depois.limiteDesconto).toBe(9);
    expect((await app.inject({ method: "GET", url: "/api/sessoes/atual" })).statusCode).toBe(401);
  });
});

describe("rótulo duplicado", () => {
  test("criar com rótulo igual (sem caixa, acento ou espaços extras) → PERFIL_DUPLICADO", async () => {
    await criarPerfil(ctx, { rotulo: "Mensageiro", copiarDe: "recepcao" }, admin);
    for (const r of ["mensageiro", "  MENSAGEIRO ", "Recepcao", "recepção"]) {
      expect((await erro(criarPerfil(ctx, { rotulo: r, copiarDe: "recepcao" }, admin))).codigo).toBe("PERFIL_DUPLICADO");
    }
    expect(await auditorias("perfil.criar")).toBe(1);
  });

  test("editar para rótulo de outro perfil → PERFIL_DUPLICADO; manter o próprio (mesmo com outra caixa) vale", async () => {
    await criarPerfil(ctx, { rotulo: "Mensageiro", copiarDe: "recepcao" }, admin);
    expect((await erro(editarPerfil(ctx, "mensageiro", { rotulo: "governança" }, admin))).codigo).toBe("PERFIL_DUPLICADO");
    const e = await editarPerfil(ctx, "mensageiro", { rotulo: "MENSAGEIRO" }, admin);
    expect(e.rotulo).toBe("MENSAGEIRO");
  });
});
