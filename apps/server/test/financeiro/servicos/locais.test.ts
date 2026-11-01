import { expect, test } from "vitest";
import { LocalService } from "../../../src/financeiro/servicos/locais.js";
import { ErroDominio } from "../../../src/shared/erros.js";
import { gerarUUID } from "../../../src/shared/ids.js";
import { criarContextoTeste } from "../../ajuda.js";

const usuario = { id: "u1", email: "admin@pousada.com", dispositivo: "web" };

async function preparar() {
  const ctx = await criarContextoTeste();
  return { ctx, servico: new LocalService(ctx) };
}

test("criar: Local com campos e parametros", async () => {
  const { servico } = await preparar();
  const pousada_id = gerarUUID();
  const local = await servico.criar(pousada_id, "Pousada Principal", usuario);
  expect(local.pousada_id).toBe(pousada_id);
  expect(local.nome).toBe("Pousada Principal");
  expect(local.ativo).toBe(true);
  expect(local.parametros.local_padrao_hospedagem).toBeDefined();
  expect(local.parametros.local_padrao_reserva).toBeDefined();
  expect(await servico.obter(local.id)).toEqual(local);
});

test("criar: cria ContaBancaria padrão Caixa", async () => {
  const { ctx, servico } = await preparar();
  const local = await servico.criar(gerarUUID(), "Sorveteria", usuario);
  const contas = await ctx.db.selectFrom("fin_conta_bancaria").selectAll().where("local_id", "=", local.id).where("nome", "=", "Caixa").execute();
  expect(contas.length).toBe(1);
  expect(contas[0].numero).toBe("0");
  expect(contas[0].banco).toBe("Sem banco");
});

test("criar: pousada duplicada falha com ErroDominio e nada é gravado", async () => {
  const { ctx, servico } = await preparar();
  const pousada_id = gerarUUID();
  await servico.criar(pousada_id, "A", usuario);
  await expect(servico.criar(pousada_id, "B", usuario)).rejects.toBeInstanceOf(ErroDominio);
  const n = await ctx.db.selectFrom("fin_local").select("id").execute();
  expect(n.length).toBe(1);
});

test("listarPorPousada: filtra por pousada e retorna ordenado por nome", async () => {
  const { servico } = await preparar();
  const p1 = gerarUUID();
  const p2 = gerarUUID();
  await servico.criar(p1, "Sorveteria", usuario);
  await servico.criar(p2, "Pousada", usuario);
  const l1 = await servico.listarPorPousada(p1);
  expect(l1.map((l) => l.nome)).toEqual(["Sorveteria"]);
  expect(await servico.listarPorPousada(gerarUUID())).toEqual([]);
});

test("obter: inexistente lança ErroDominio NAO_ENCONTRADO", async () => {
  const { servico } = await preparar();
  await expect(servico.obter(gerarUUID())).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
});

test("atualizar: altera campos e registra auditoria", async () => {
  const { ctx, servico } = await preparar();
  const local = await servico.criar(gerarUUID(), "Antigo", usuario);
  const outro = { email: "outro@pousada.com" };
  const novo = await servico.atualizar(local.id, { nome: "Novo", ativo: false }, outro);
  expect(novo.nome).toBe("Novo");
  expect(novo.ativo).toBe(false);
  expect(novo.parametros).toEqual(local.parametros);
  expect(await servico.obter(local.id)).toEqual(novo);
  const aud = await ctx.db.selectFrom("auditoria").selectAll().where("acao", "=", "fin_local.atualizar").where("alvo_id", "=", local.id).execute();
  expect(aud.length).toBe(1);
  expect(aud[0].ator).toBe("outro@pousada.com");
});

test("atualizar: inexistente lança NAO_ENCONTRADO", async () => {
  const { servico } = await preparar();
  await expect(servico.atualizar(gerarUUID(), { nome: "x" }, usuario)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
});
