import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { abrirAba, BANCO, CAIXA, esperarChamada, rotasBase } from "./base";

afterEach(() => vi.unstubAllGlobals());

const COND = { id: "cd1", local_id: "l1", adquirente: "Cielo", bandeira: "Visa", tipo: "credito", prazo_dias: 31, taxa_percentual: 2.5, ativo: true };
const COND_DEB = { ...COND, id: "cd2", adquirente: "Stone", bandeira: "Elo", tipo: "debito", prazo_dias: 1, taxa_percentual: 1.5 };
const MOV = {
  id: "k1", local_id: "l1", data: "2026-11-10", adquirente: "Cielo", bandeira: "Visa", tipo: "credito", valor_bruto: 10000, taxa_percentual: 2.5, prazo_dias: 31,
  valor_taxa: 250, valor_liquido: 9750, previsao: "2026-12-11", status: "a_receber", revisar: 0, lancamento_id: "lx", conta_destino_id: null, baixado_em: null,
};
const BAIXADO = { ...MOV, id: "k2", adquirente: "Stone", bandeira: "Elo", tipo: "debito", prazo_dias: 1, status: "baixado", valor_bruto: 5000, valor_taxa: 100, valor_liquido: 4900 };
const REVISAR = { ...MOV, id: "k3", adquirente: "", bandeira: "Não informada", taxa_percentual: 0, prazo_dias: 0, valor_taxa: 0, valor_liquido: 10000, revisar: 1, previsao: "2026-11-10" };

describe("tela Cartão de Crédito", () => {
  const rotas = (extra: Record<string, unknown> = {}) => ({
    ...rotasBase(),
    "GET /api/financeiro/cartao/movimentos": [MOV, BAIXADO],
    "GET /api/financeiro/cobranca/condicoes": [COND, COND_DEB],
    ...extra,
  });

  test("lista movimentos por adquirente, bandeira e tipo com bruto, taxa, líquido, prazo e previsão", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas());
    await abrirAba("cartao");
    const linha = (await screen.findByText("Visa")).closest("tr")!;
    expect(within(linha).getByText("Cielo")).toBeInTheDocument();
    expect(within(linha).getByText("Crédito")).toBeInTheDocument();
    expect(within(linha).getByText("R$ 100,00")).toBeInTheDocument();
    expect(within(linha).getByText("R$ 2,50")).toBeInTheDocument();
    expect(within(linha).getByText("R$ 97,50")).toBeInTheDocument();
    expect(within(linha).getByText("D+31")).toBeInTheDocument();
    expect(within(linha).getByText("11/12/2026")).toBeInTheDocument();
    expect(screen.getByText("Líquido a receber das operadoras: R$ 97,50")).toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText("Situação"), "Baixado");
    expect(screen.queryByText("Visa")).not.toBeInTheDocument();
    expect(screen.getByText("Elo")).toBeInTheDocument();
  });

  test("novo movimento usa a condição cadastrada: confere bruto, taxa, previsão e envia só a condição", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "POST /api/financeiro/cartao/movimentos": { __status: 201, ...MOV } }));
    await abrirAba("cartao");
    await u.click(await screen.findByRole("button", { name: "+ Novo movimento" }));
    const painel = await screen.findByRole("dialog", { name: "Novo movimento de cartão" });
    fireEvent.change(within(painel).getByLabelText("Data da venda"), { target: { value: "2026-11-10" } });
    await u.selectOptions(within(painel).getByLabelText("O valor informado é"), "Líquido (já sem a taxa)");
    await u.type(within(painel).getByLabelText("Valor"), "97,50");
    expect(within(painel).getByText(/Previsão de recebimento: 11\/12\/2026 \(D\+31\)/)).toBeInTheDocument();
    const conf = within(painel).getByRole("list", { name: "Conferência dos valores" });
    expect(within(conf).getByText("R$ 100,00")).toBeInTheDocument();
    expect(within(conf).getByText("R$ 2,50")).toBeInTheDocument();
    await u.click(within(painel).getByRole("button", { name: "Registrar movimento" }));
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/cartao/movimentos");
    expect(post.corpo).toEqual({ local_id: "l1", data: "2026-11-10", valor: 9750, informado: "liquido", condicao_id: "cd1", chave: expect.any(String) });
  });

  test("sem condição cadastrada não há como registrar: a tela manda cadastrar em Cobrança", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "GET /api/financeiro/cobranca/condicoes": [] }));
    await abrirAba("cartao");
    await u.click(await screen.findByRole("button", { name: "+ Novo movimento" }));
    const painel = await screen.findByRole("dialog", { name: "Novo movimento de cartão" });
    expect(within(painel).getByText(/Cadastre as condições de cobrança em Cadastros, Cobrança/)).toBeInTheDocument();
    expect(within(painel).getByRole("button", { name: "Registrar movimento" })).toBeDisabled();
  });

  test("pagamento sem condição fica sinalizado para revisão, com aviso visível", async () => {
    instalarApiFalsa(rotas({ "GET /api/financeiro/cartao/movimentos": [REVISAR] }));
    await abrirAba("cartao");
    const linha = (await screen.findByText("Não informada")).closest("tr")!;
    expect(within(linha).getByText("Revisar condição")).toBeInTheDocument();
    expect(screen.getByText(/1 movimento entrou sem condição de cobrança cadastrada/)).toBeInTheDocument();
  });

  test("baixa de movimento a revisar exige escolher a condição do tipo e a envia", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({
      "GET /api/financeiro/cartao/movimentos": [REVISAR],
      "PUT /api/financeiro/cartao/movimentos/k3/baixar": { ...REVISAR, status: "baixado", revisar: 0 },
    }));
    await abrirAba("cartao");
    await u.click(within((await screen.findByText("Não informada")).closest("tr")!).getByRole("button", { name: "Baixar" }));
    const painel = await screen.findByRole("dialog", { name: "Baixar cartão" });
    const baixar = within(painel).getByRole("button", { name: "Baixar no Caixa e Banco" });
    expect(within(painel).getByRole("note")).toHaveTextContent(/sem condição de cobrança/);
    expect(within(painel).queryByLabelText("Taxa cobrada (%)")).not.toBeInTheDocument();
    // só as condições de crédito aparecem
    expect(within(within(painel).getByLabelText("Condição de cobrança")).queryByText(/Stone/)).not.toBeInTheDocument();
    expect(baixar).toBeDisabled();
    await u.selectOptions(within(painel).getByLabelText("Condição de cobrança"), "cd1");
    expect(within(painel).getByText("R$ 97,50")).toBeInTheDocument();
    await u.click(baixar);
    const put = await esperarChamada(chamadas, "PUT", "/api/financeiro/cartao/movimentos/k3/baixar");
    expect(put.corpo).toEqual({ conta_id: CAIXA.id, condicao_id: "cd1" });
  });

  test("baixa no Caixa e Banco com a taxa efetiva e a conta escolhida", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "PUT /api/financeiro/cartao/movimentos/k1/baixar": { ...MOV, status: "baixado" } }));
    await abrirAba("cartao");
    const linha = (await screen.findByText("Visa")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Baixar" }));
    const painel = await screen.findByRole("dialog", { name: "Baixar cartão" });
    expect(within(painel).getByLabelText("Conta que recebeu")).toHaveValue(CAIXA.id);
    await u.selectOptions(within(painel).getByLabelText("Conta que recebeu"), BANCO.id);
    await u.clear(within(painel).getByLabelText("Taxa cobrada (%)"));
    await u.type(within(painel).getByLabelText("Taxa cobrada (%)"), "3");
    expect(within(painel).getByText("R$ 97,00")).toBeInTheDocument();
    await u.click(within(painel).getByRole("button", { name: "Baixar no Caixa e Banco" }));
    const put = await esperarChamada(chamadas, "PUT", "/api/financeiro/cartao/movimentos/k1/baixar");
    expect(put.corpo).toEqual({ conta_id: BANCO.id, taxa_percentual: 3 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("erro na baixa fica no painel e movimento baixado não oferece nova baixa", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "PUT /api/financeiro/cartao/movimentos/k1/baixar": { __status: 422, codigo: "ESTADO_INVALIDO", mensagem: "Movimento já baixado." } }));
    await abrirAba("cartao");
    const baixado = (await screen.findByText("Elo")).closest("tr")!;
    expect(within(baixado).queryByRole("button", { name: "Baixar" })).not.toBeInTheDocument();
    await u.click(within((await screen.findByText("Visa")).closest("tr")!).getByRole("button", { name: "Baixar" }));
    const painel = await screen.findByRole("dialog", { name: "Baixar cartão" });
    await u.click(within(painel).getByRole("button", { name: "Baixar no Caixa e Banco" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Movimento já baixado.");
  });

  test("lista vazia explica que o cartão da hospedagem chega sozinho", async () => {
    instalarApiFalsa(rotas({ "GET /api/financeiro/cartao/movimentos": [] }));
    await abrirAba("cartao");
    expect(await screen.findByText(/Pagamentos em cartão da hospedagem aparecem aqui sozinhos/)).toBeInTheDocument();
  });
});

describe("tela Cobrança (cadastro das condições de cartão)", () => {
  const rotas = (extra: Record<string, unknown> = {}) => ({ ...rotasBase(), "GET /api/financeiro/cobranca/condicoes": [COND, { ...COND_DEB, ativo: false }], ...extra });

  test("lista as condições ativas (desativadas só quando pedido) com D+N e taxa", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas());
    await abrirAba("cobranca");
    const linha = (await screen.findByText("Cielo")).closest("tr")!;
    expect(within(linha).getByText("D+31")).toBeInTheDocument();
    expect(within(linha).getByText("2,5%")).toBeInTheDocument();
    expect(screen.queryByText("Stone")).not.toBeInTheDocument();
    await u.click(screen.getByLabelText("Mostrar desativadas"));
    expect(screen.getByText("Stone")).toBeInTheDocument();
  });

  test("cria condição com prazo D+N qualquer e taxa", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "POST /api/financeiro/cobranca/condicoes": { __status: 201, ...COND } }));
    await abrirAba("cobranca");
    await u.click(await screen.findByRole("button", { name: "+ Nova condição" }));
    const painel = await screen.findByRole("dialog", { name: "Nova condição de cobrança" });
    const salvar = within(painel).getByRole("button", { name: "Salvar" });
    expect(salvar).toBeDisabled();
    await u.type(within(painel).getByLabelText("Adquirente"), "Rede");
    await u.type(within(painel).getByLabelText("Bandeira"), "Mastercard");
    await u.selectOptions(within(painel).getByLabelText("Tipo"), "Voucher");
    await u.type(within(painel).getByLabelText("Prazo para receber (dias, D+N)"), "45");
    await u.type(within(painel).getByLabelText("Taxa (%)"), "3,75");
    await u.click(salvar);
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/cobranca/condicoes");
    expect(post.corpo).toEqual({ local_id: "l1", adquirente: "Rede", bandeira: "Mastercard", tipo: "voucher", prazo_dias: 45, taxa_percentual: 3.75, chave: expect.any(String) });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("edita, e desativa, sem criar uma nova", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "PUT /api/financeiro/cobranca/condicoes/cd1": COND }));
    await abrirAba("cobranca");
    await u.click(within((await screen.findByText("Cielo")).closest("tr")!).getByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog", { name: "Editar condição de cobrança" });
    await u.clear(within(painel).getByLabelText("Taxa (%)"));
    await u.type(within(painel).getByLabelText("Taxa (%)"), "2,9");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    const put = await esperarChamada(chamadas, "PUT", "/api/financeiro/cobranca/condicoes/cd1");
    expect(put.corpo).toEqual({ adquirente: "Cielo", bandeira: "Visa", tipo: "credito", prazo_dias: 31, taxa_percentual: 2.9 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await u.click(within((await screen.findByText("Cielo")).closest("tr")!).getByRole("button", { name: "Editar" }));
    await u.click(await screen.findByRole("button", { name: "Desativar" }));
    await waitFor(() => expect(chamadas.filter((c) => c.metodo === "PUT")).toHaveLength(2));
    expect(chamadas.filter((c) => c.metodo === "PUT")[1]!.corpo).toEqual({ ativo: false });
  });

  test("validação na hora e erro do servidor no painel", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "POST /api/financeiro/cobranca/condicoes": { __status: 422, codigo: "NAO_ENCONTRADO", mensagem: "Local não encontrado." } }));
    await abrirAba("cobranca");
    await u.click(await screen.findByRole("button", { name: "+ Nova condição" }));
    const painel = await screen.findByRole("dialog", { name: "Nova condição de cobrança" });
    await u.type(within(painel).getByLabelText("Adquirente"), "Rede");
    await u.type(within(painel).getByLabelText("Bandeira"), "Visa");
    await u.type(within(painel).getByLabelText("Taxa (%)"), "100");
    await u.type(within(painel).getByLabelText("Prazo para receber (dias, D+N)"), "30");
    expect(within(painel).getByText("Informe a taxa, de 0% a 99,99%.")).toBeInTheDocument();
    await u.clear(within(painel).getByLabelText("Taxa (%)"));
    await u.type(within(painel).getByLabelText("Taxa (%)"), "2");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Local não encontrado.");
  });
});

const FAT = {
  id: "f1", cliente_id: "cli1", cliente_nome: "Empresa X Ltda", cliente_documento: "11222333000181", cliente_contato: {}, cliente_politica: {},
  reserva_codigo: 42, valor_original: 90000, valor_liquido: 90000, data_vencimento: "2026-12-01T00:00:00.000Z", forma_cobranca: "boleto",
  numero_documento: "", status: "aberto", fechada: false, criado_em: "2026-11-02T12:00:00.000Z",
};
const FAT2 = { ...FAT, id: "f3", reserva_codigo: 43, valor_liquido: 10000, valor_original: 10000 };
const FAT_OUTRO = { ...FAT, id: "f4", cliente_id: "cli9", cliente_nome: "Hotel Z", reserva_codigo: 50 };
const FECHADA = { ...FAT, id: "f2", cliente_nome: "Hotel Y", numero_documento: "FAT-2026-000007", fechada: true, valor_liquido: 12000 };

describe("tela Faturamento", () => {
  const rotas = (extra: Record<string, unknown> = {}) => ({ ...rotasBase(), "GET /api/financeiro/faturamentos": [FAT, FECHADA], ...extra });

  test("mostra por padrão os fechamentos marcados para faturar e alterna para as faturas fechadas", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas());
    await abrirAba("faturamento");
    const linha = (await screen.findByText("Empresa X Ltda")).closest("tr")!;
    expect(within(linha).getByText("42")).toBeInTheDocument();
    expect(within(linha).getByText("R$ 900,00")).toBeInTheDocument();
    expect(screen.queryByText("Hotel Y")).not.toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText("Mostrar"), "Fechadas");
    expect(screen.getByText("Hotel Y")).toBeInTheDocument();
    expect(screen.getByText("FAT-2026-000007")).toBeInTheDocument();
    expect(screen.getByText("Em Contas a Receber")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fechar fatura" })).not.toBeInTheDocument();
  });

  test("fecha a fatura: salva dados e política do cliente e envia ids, forma e vencimento", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({
      "PUT /api/financeiro/clientes/cli1": { ok: true },
      "POST /api/financeiro/faturamentos/fechar-grupo": { ...FAT, numero_documento: "FAT-2026-000008" },
    }));
    await abrirAba("faturamento");
    const linha = (await screen.findByText("Empresa X Ltda")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Fechar fatura" }));
    const painel = await screen.findByRole("dialog", { name: "Fechar fatura" });
    expect(within(painel).getByText(/11222333000181/)).toBeInTheDocument();
    await u.type(within(painel).getByLabelText("E-mail para cobrança"), "fin@x.com");
    await u.type(within(painel).getByLabelText("Telefone"), "1199999");
    await u.type(within(painel).getByLabelText("Endereço"), "Rua A, 10");
    await u.clear(within(painel).getByLabelText("Prazo de pagamento (dias)"));
    await u.type(within(painel).getByLabelText("Prazo de pagamento (dias)"), "15");
    await u.selectOptions(within(painel).getByLabelText("Forma de cobrança"), "Pix");
    await u.type(within(painel).getByLabelText("Observações"), "Enviar nota junto");
    fireEvent.change(within(painel).getByLabelText("Vencimento desta fatura"), { target: { value: "2026-12-20" } });
    await u.click(within(painel).getByRole("button", { name: "Fechar fatura" }));
    const fechar = await esperarChamada(chamadas, "POST", "/api/financeiro/faturamentos/fechar-grupo");
    expect(fechar.corpo).toEqual({ ids: ["f1"], forma: "pix", data_vencimento: "2026-12-20", chave: expect.any(String) });
    const cliente = chamadas.find((c) => c.metodo === "PUT")!;
    expect(cliente.caminho).toBe("/api/financeiro/clientes/cli1");
    expect(cliente.corpo).toEqual({
      contato: { email: "fin@x.com", telefone: "1199999", endereco: "Rua A, 10" },
      politica: { prazo_dias: 15, forma_cobranca: "pix", observacoes: "Enviar nota junto" },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("agrupa fechamentos do mesmo cliente: outros clientes ficam bloqueados e a fatura leva todos os ids", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({
      "GET /api/financeiro/faturamentos": [FAT, FAT2, FAT_OUTRO],
      "PUT /api/financeiro/clientes/cli1": { ok: true },
      "POST /api/financeiro/faturamentos/fechar-grupo": { ...FAT, numero_documento: "FAT-2026-000009" },
    }));
    await abrirAba("faturamento");
    await screen.findByText("Hotel Z");
    await u.click(screen.getByLabelText("Selecionar Empresa X Ltda, reserva 42"));
    expect(screen.getByLabelText("Selecionar Hotel Z, reserva 50")).toBeDisabled();
    await u.click(screen.getByLabelText("Selecionar Empresa X Ltda, reserva 43"));
    await u.click(screen.getByRole("button", { name: "Fechar uma fatura com os 2 selecionados" }));
    const painel = await screen.findByRole("dialog", { name: "Fechar fatura" });
    expect(within(painel).getByText(/2 fechamentos numa só fatura/)).toBeInTheDocument();
    const lista = within(painel).getByRole("list", { name: "Fechamentos da fatura" });
    expect(within(lista).getByText("Reserva 42")).toBeInTheDocument();
    expect(within(lista).getByText("Reserva 43")).toBeInTheDocument();
    expect(within(painel).getByText("R$ 1.000,00")).toBeInTheDocument();
    await u.click(within(painel).getByRole("button", { name: "Fechar fatura" }));
    const fechar = await esperarChamada(chamadas, "POST", "/api/financeiro/faturamentos/fechar-grupo");
    expect((fechar.corpo as { ids: string[] }).ids).toEqual(["f1", "f3"]);
  });

  test("extrato da cobrança lista cada fechamento (reserva, hóspede, período, valor) e imprime", async () => {
    const u = userEvent.setup();
    const imprimir = vi.fn();
    vi.stubGlobal("print", imprimir);
    instalarApiFalsa(rotas({
      "GET /api/financeiro/faturamentos/extrato": {
        numero_documento: "FAT-2026-000007", forma_cobranca: "pix", data_vencimento: "2026-12-20T12:00:00.000Z", status: "aberto", total: 40000,
        cliente: { id: "cli1", nome: "Empresa X Ltda", documento: "11222333000181", contato: { email: "fin@x.com" } },
        itens: [
          { id: "a", reserva_codigo: 101, hospede: "Ana Silva", chegada: "2026-11-01", saida: "2026-11-03", valor: 30000 },
          { id: "b", reserva_codigo: 102, hospede: "Bruno Costa", chegada: "2026-11-02", saida: "2026-11-04", valor: 10000 },
        ],
      },
    }));
    await abrirAba("faturamento");
    await u.selectOptions(await screen.findByLabelText("Mostrar"), "Fechadas");
    await u.click(screen.getByRole("button", { name: "Extrato" }));
    const janela = await screen.findByRole("dialog", { name: "Extrato da cobrança" });
    expect(await within(janela).findByText("Fatura FAT-2026-000007")).toBeInTheDocument();
    expect(within(janela).getByText("Ana Silva")).toBeInTheDocument();
    expect(within(janela).getByText("01/11/2026 a 03/11/2026")).toBeInTheDocument();
    expect(within(janela).getByText("Bruno Costa")).toBeInTheDocument();
    expect(within(janela).getByText("R$ 400,00")).toBeInTheDocument();
    const consulta = chamadas.find((c) => c.caminho.startsWith("/api/financeiro/faturamentos/extrato"))!;
    expect(consulta.caminho).toContain("numero=FAT-2026-000007");
    await u.click(within(janela).getByRole("button", { name: "Imprimir" }));
    expect(imprimir).toHaveBeenCalledTimes(1);
  });

  test("a política já salva do cliente vem preenchida", async () => {
    const u = userEvent.setup();
    const fat = { ...FAT, cliente_contato: { email: "a@b.com" }, cliente_politica: { prazo_dias: 45, forma_cobranca: "deposito", observacoes: "Só às sextas" } };
    instalarApiFalsa(rotas({ "GET /api/financeiro/faturamentos": [fat] }));
    await abrirAba("faturamento");
    await u.click(await screen.findByRole("button", { name: "Fechar fatura" }));
    const painel = await screen.findByRole("dialog", { name: "Fechar fatura" });
    expect(within(painel).getByLabelText("E-mail para cobrança")).toHaveValue("a@b.com");
    expect(within(painel).getByLabelText("Prazo de pagamento (dias)")).toHaveValue(45);
    expect(within(painel).getByLabelText("Forma de cobrança")).toHaveValue("deposito");
    expect(within(painel).getByLabelText("Observações")).toHaveValue("Só às sextas");
  });

  test("prazo inválido bloqueia o fechamento e erro do servidor aparece no painel", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({
      "PUT /api/financeiro/clientes/cli1": { ok: true },
      "POST /api/financeiro/faturamentos/fechar-grupo": { __status: 422, codigo: "ESTADO_INVALIDO", mensagem: "Um dos fechamentos já está em fatura fechada." },
    }));
    await abrirAba("faturamento");
    await u.click(await screen.findByRole("button", { name: "Fechar fatura" }));
    const painel = await screen.findByRole("dialog", { name: "Fechar fatura" });
    await u.clear(within(painel).getByLabelText("Prazo de pagamento (dias)"));
    expect(within(painel).getByRole("button", { name: "Fechar fatura" })).toBeDisabled();
    expect(within(painel).getByText("Informe um prazo entre 0 e 365 dias.")).toBeInTheDocument();
    await u.type(within(painel).getByLabelText("Prazo de pagamento (dias)"), "30");
    await u.click(within(painel).getByRole("button", { name: "Fechar fatura" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Um dos fechamentos já está em fatura fechada.");
  });

  test("sem fechamentos marcados para faturar mostra o aviso", async () => {
    instalarApiFalsa(rotas({ "GET /api/financeiro/faturamentos": [] }));
    await abrirAba("faturamento");
    expect(await screen.findByText(/Nenhum fechamento marcado para faturar/)).toBeInTheDocument();
  });
});
