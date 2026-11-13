import { expect, test } from "vitest";
import { LançamentoService } from "../../../src/financeiro/servicos/lançamentos.js";
import { LocalService } from "../../../src/financeiro/servicos/locais.js";
import { Dinheiro } from "../../../src/shared/dinheiro.js";
import { gerarUUID } from "../../../src/shared/ids.js";
import { criarContextoTeste } from "../../ajuda.js";

const usuario = { id: "u1", email: "admin@pousada.com", dispositivo: "web" };

async function preparar() {
  const ctx = await criarContextoTeste();
  const local = await new LocalService(ctx).criar(gerarUUID(), "Pousada", usuario);
  const servico = new LançamentoService(ctx);
  const base = {
    local_id: local.id,
    data: new Date("2026-11-05T12:00:00Z"),
    tipo: "recebimento" as const,
    origem: "manual" as const,
    valor: Dinheiro.de(10000),
    forma_pagamento: "pix" as const,
    usuario,
  };
  return { ctx, servico, local, base };
}

test("criar: grava com status confirmado e auditoria", async () => {
  const { ctx, servico, base } = await preparar();
  const l = await servico.criar(base);
  expect(l.status).toBe("confirmado");
  expect(l.valor.centavos).toBe(10000);
  expect(l.auditoria.criado_por).toBe("admin@pousada.com");
  expect(l.auditoria.dispositivo).toBe("web");
  expect(l.auditoria.data_criacao.toISOString()).toBe("2026-11-10T15:00:00.000Z");
  expect(await servico.obter(l.id)).toEqual(l);
  const aud = await ctx.db.selectFrom("auditoria").selectAll().where("acao", "=", "fin_lancamento.criar").execute();
  expect(aud.length).toBe(1);
});

test("criar: valor não positivo e local inexistente falham", async () => {
  const { servico, base } = await preparar();
  await expect(servico.criar({ ...base, valor: Dinheiro.zero() })).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  await expect(servico.criar({ ...base, local_id: gerarUUID() })).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
});

test("cancelar: registra motivo e atualizador; exige supervisor e motivo", async () => {
  const { servico, base } = await preparar();
  const l = await servico.criar(base);
  await expect(servico.cancelar(l.id, "erro", "", usuario)).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  await expect(servico.cancelar(l.id, " ", "sup@pousada.com", usuario)).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  const c = await servico.cancelar(l.id, "lançado em duplicidade", "sup@pousada.com", usuario);
  expect(c.status).toBe("cancelado");
  expect(c.auditoria.motivo_cancelamento).toBe("lançado em duplicidade");
  expect(c.auditoria.supervisor_autorizou).toBe(true);
  expect(c.auditoria.atualizado_por).toBe("admin@pousada.com");
});

test("cancelar: duplo cancelamento e inexistente falham", async () => {
  const { servico, base } = await preparar();
  const l = await servico.criar(base);
  await servico.cancelar(l.id, "x", "sup", usuario);
  await expect(servico.cancelar(l.id, "x", "sup", usuario)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
  await expect(servico.cancelar(gerarUUID(), "x", "sup", usuario)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
});

test("estornar: cria lançamento de tipo oposto referenciando o original", async () => {
  const { servico, base } = await preparar();
  const l = await servico.criar(base);
  const e = await servico.estornar(l.id, "devolução", "sup@pousada.com", usuario);
  expect(e.tipo).toBe("pagamento");
  expect(e.valor.centavos).toBe(10000);
  expect(e.referencia_id).toBe(l.id);
  expect(e.referencia_tipo).toBe("estorno");
  expect((await servico.obter(l.id)).status).toBe("confirmado");
});

test("estornar: exige supervisor, não estorna duas vezes nem cancelado", async () => {
  const { servico, base } = await preparar();
  const l = await servico.criar(base);
  await expect(servico.estornar(l.id, "m", "", usuario)).rejects.toMatchObject({ codigo: "VALIDACAO_FALHOU" });
  const e = await servico.estornar(l.id, "m", "sup", usuario);
  await expect(servico.estornar(l.id, "m", "sup", usuario)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
  await expect(servico.estornar(e.id, "m", "sup", usuario)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
  const l2 = await servico.criar(base);
  await servico.cancelar(l2.id, "m", "sup", usuario);
  await expect(servico.estornar(l2.id, "m", "sup", usuario)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
});

test("listar: filtra por local e período, ordenado por data", async () => {
  const { ctx, servico, local, base } = await preparar();
  const outro = await new LocalService(ctx).criar(gerarUUID(), "Sorveteria", usuario);
  const a = await servico.criar({ ...base, data: new Date("2026-11-03T10:00:00Z") });
  const b = await servico.criar({ ...base, data: new Date("2026-11-01T10:00:00Z") });
  const c = await servico.criar({ ...base, data: new Date("2026-11-08T10:00:00Z") });
  await servico.criar({ ...base, local_id: outro.id });
  expect((await servico.listar(local.id)).map((x) => x.id)).toEqual([c.id, a.id, b.id]);
  const r = await servico.listar(local.id, { data_inicio: new Date("2026-11-02T00:00:00Z"), data_fim: new Date("2026-11-05T00:00:00Z") });
  expect(r.map((x) => x.id)).toEqual([a.id]);
  expect(await servico.listar(gerarUUID())).toEqual([]);
});
