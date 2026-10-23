import { describe, expect, test } from "vitest";
import { criarContextoTeste } from "../ajuda.js";
import { buscarHospedes, pendenciasFnrh, salvarHospede, type Hospede } from "../../src/nucleo/hospedes.js";
import { criarProduto, obterProdutoPorCodigo } from "../../src/nucleo/produtos.js";
import { ativarForma, listarFormas } from "../../src/nucleo/formas-pagamento.js";
import { ErroDominio } from "../../src/shared/erros.js";

const base = { nome: "Ana", documentoTipo: "cpf" as const, documento: null, nascimento: null, nacionalidade: "BR" };
const codigoErro = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return (e as ErroDominio).codigo; }
  return null;
};

describe("hóspedes, produtos e formas de pagamento", () => {
  test("CPF inválido é rejeitado; válido é gravado só com dígitos", async () => {
    const ctx = await criarContextoTeste();
    expect(await codigoErro(salvarHospede(ctx, { ...base, documento: "123.456.789-00" }, "u1"))).toBe("CPF_INVALIDO");
    const h = await salvarHospede(ctx, { ...base, documento: "529.982.247-25" }, "u1");
    expect(h.documento).toBe("52998224725");
  });

  test("estrangeiro com passaporte não passa por validação de CPF", async () => {
    const ctx = await criarContextoTeste();
    const h = await salvarHospede(ctx, { ...base, nome: "John", documentoTipo: "passaporte", documento: "AB123456", nacionalidade: "US" }, "u1");
    expect(h.documento).toBe("AB123456");
  });

  test("documento é único por tipo; atualizar o mesmo hóspede é permitido", async () => {
    const ctx = await criarContextoTeste();
    const h = await salvarHospede(ctx, { ...base, documento: "52998224725" }, "u1");
    expect(await codigoErro(salvarHospede(ctx, { ...base, nome: "Outra", documento: "529.982.247-25" }, "u1"))).toBe("DOCUMENTO_DUPLICADO");
    const atual = await salvarHospede(ctx, { ...h, nome: "Ana Maria", telefone: "1199" }, "u1");
    expect(atual).toMatchObject({ id: h.id, nome: "Ana Maria", telefone: "1199" });
    expect(await ctx.db.selectFrom("hospedes").selectAll().execute()).toHaveLength(1);
    const pass = await salvarHospede(ctx, { ...base, documentoTipo: "passaporte", documento: "52998224725" }, "u1");
    expect(pass.id).not.toBe(h.id);
  });

  test("busca ignora acento e caixa; documento por dígitos", async () => {
    const ctx = await criarContextoTeste();
    await salvarHospede(ctx, { ...base, nome: "José Antônio", documento: "529.982.247-25" }, "u1");
    await salvarHospede(ctx, { ...base, nome: "Maria" }, "u1");
    expect(await buscarHospedes(ctx, "jose antonio")).toHaveLength(1);
    expect(await buscarHospedes(ctx, "JOSÉ")).toHaveLength(1);
    expect(await buscarHospedes(ctx, "529.982")).toHaveLength(1);
    expect(await buscarHospedes(ctx, "zzz")).toHaveLength(0);
  });

  test("pendenciasFnrh de adulto incompleto", () => {
    expect(pendenciasFnrh({ nome: "Ana", documentoTipo: "cpf", documento: null, nascimento: null, nacionalidade: "BR" } as Hospede, true))
      .toEqual(expect.arrayContaining(["documento", "nascimento", "endereco.cidade", "contato"]));
  });

  test("pendenciasFnrh: adulto completo e criança", () => {
    const completo: Hospede = {
      id: "1", nome: "Ana", documentoTipo: "cpf", documento: "52998224725", nascimento: "1990-01-01", nacionalidade: "BR",
      email: "a@b.com", endereco: { logradouro: "Rua", cidade: "SP", uf: "SP", pais: "BR" },
    };
    expect(pendenciasFnrh(completo, true)).toEqual([]);
    expect(pendenciasFnrh({ ...completo, nome: "", nascimento: null }, false)).toEqual(["nome", "nascimento"]);
    expect(pendenciasFnrh({ ...completo, documento: null, nacionalidade: "" }, true)).toEqual(["documento", "nacionalidade"]);
  });

  test("produtos: seeds, criação e código duplicado", async () => {
    const ctx = await criarContextoTeste();
    for (const c of ["EARLY_CHECKIN", "LATE_CHECKOUT", "CAMA_EXTRA"]) {
      expect(await obterProdutoPorCodigo(ctx, c)).toMatchObject({ precoCentavos: 0, tipo: "servico" });
    }
    const p = await criarProduto(ctx, { codigo: "AGUA", nome: "Água", precoCentavos: 500, unidade: "un", grupo: "frigobar", tipo: "produto" }, "u1");
    expect(await obterProdutoPorCodigo(ctx, "AGUA")).toEqual(p);
    expect(await codigoErro(criarProduto(ctx, { ...p, precoCentavos: 1 }, "u1"))).toBe("CODIGO_PRODUTO_DUPLICADO");
    expect(await codigoErro(obterProdutoPorCodigo(ctx, "NAO"))).toBe("PRODUTO_NAO_ENCONTRADO");
  });

  test("formas de pagamento padrão e ativação", async () => {
    const ctx = await criarContextoTeste();
    expect((await listarFormas(ctx)).map((f) => f.codigo)).toEqual(["dinheiro", "pix", "debito", "credito", "faturado"]);
    await ativarForma(ctx, "pix", false, "u1");
    expect((await listarFormas(ctx)).map((f) => f.codigo)).toEqual(["dinheiro", "debito", "credito", "faturado"]);
    expect((await listarFormas(ctx, false)).map((f) => f.codigo)).toEqual(["dinheiro", "pix", "debito", "credito", "faturado"]);
  });
});
