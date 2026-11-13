import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FinanceiroLayout } from "../../src/financeiro/FinanceiroLayout";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { abrirAba, BANCO, CAIXA, esperarChamada, rotasBase } from "./base";

afterEach(() => vi.unstubAllGlobals());
void render;

const vazio = { quantidade: 0, valor_original: 0, valor_recebido: 0, valor_pendente: 0 };
const item = (extra: object = {}) => ({
  id: "r1", numero_documento: "DOC-1", cliente_id: "cl1", cliente_nome: "Maria Eventos", data_vencimento: "2026-12-20T12:00:00.000Z", valor_original: 100000,
  valor_recebido: 0, valor_pendente: 100000, situacao: "aberto", parcela_de: null, valor_total: null, origem: "manual", categoria: "aluguel", observacao: "Salão",
  editavel: true, lancamento_id: null, ...extra,
});
const posicao = (itens: object[]) => ({ local_id: "l1", situacoes: { aberto: vazio, vencido: vazio, parcialmente_recebido: vazio, recebido: vazio }, itens });
const CLIENTES = [{ id: "cl1", local_id: "l1", nome: "Maria Eventos", cpf_cnpj: "52998224725" }, { id: "cl2", local_id: "l1", nome: "Hotel Z", cpf_cnpj: null }];

describe("Contas a Receber: lançamento manual (espelho de Contas a Pagar)", () => {
  const rotas = (extra: Record<string, unknown> = {}) => ({
    ...rotasBase(), "GET /api/financeiro/relatorios/contas-receber": posicao([item()]), "GET /api/financeiro/clientes": CLIENTES, ...extra,
  });

  test("lança conta a receber: cliente da lista, documento, categoria, valor em centavos, vencimento e observação", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "POST /api/financeiro/contas-receber": { __status: 201, id: "novo" } }));
    await abrirAba("receber");
    await u.click(await screen.findByRole("button", { name: "+ Nova conta a receber" }));
    const painel = await screen.findByRole("dialog", { name: "Nova conta a receber" });
    const lancar = within(painel).getByRole("button", { name: "Lançar conta a receber" });
    expect(lancar).toBeDisabled();
    await u.selectOptions(within(painel).getByLabelText("Cliente"), "cl2");
    await u.type(within(painel).getByLabelText("Número do documento"), "DOC-9");
    await u.selectOptions(within(painel).getByLabelText("Categoria"), "Evento");
    await u.type(within(painel).getByLabelText("Valor"), "350,50");
    fireEvent.change(within(painel).getByLabelText("Vencimento"), { target: { value: "2027-01-10" } });
    await u.type(within(painel).getByLabelText("Observação"), "Festa de fim de ano");
    await u.click(lancar);
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/contas-receber");
    expect(post.corpo).toEqual({ local_id: "l1", cliente_id: "cl2", numero_documento: "DOC-9", valor: 35050, vencimento: "2027-01-10", categoria: "evento", observacao: "Festa de fim de ano", chave: expect.any(String) });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("cria o cliente na hora, sem sair do painel, e já o seleciona", async () => {
    const u = userEvent.setup();
    let criado = false;
    instalarApiFalsa(rotas({
      "GET /api/financeiro/clientes": () => (criado ? [...CLIENTES, { id: "cl9", local_id: "l1", nome: "Cliente Novo", cpf_cnpj: null }] : CLIENTES),
      "POST /api/financeiro/clientes": () => { criado = true; return { __status: 201, id: "cl9", local_id: "l1", nome: "Cliente Novo", cpf_cnpj: null }; },
    }));
    await abrirAba("receber");
    await u.click(await screen.findByRole("button", { name: "+ Nova conta a receber" }));
    await u.click(await screen.findByRole("button", { name: "+ Novo cliente" }));
    const janela = await screen.findByRole("dialog", { name: "Novo cliente" });
    await u.type(within(janela).getByLabelText("Nome do cliente"), "Cliente Novo");
    await u.click(within(janela).getByRole("button", { name: "Cadastrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Novo cliente" })).not.toBeInTheDocument());
    const painel = screen.getByRole("dialog", { name: "Nova conta a receber" });
    await waitFor(() => expect(within(painel).getByLabelText("Cliente")).toHaveValue("cl9"));
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual({ local_id: "l1", nome: "Cliente Novo", chave: expect.any(String) });
  });

  test("erro do servidor aparece dentro do painel", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "POST /api/financeiro/contas-receber": { __status: 422, codigo: "VALIDACAO_FALHOU", mensagem: "Já existe uma conta a receber com este número de documento neste local." } }));
    await abrirAba("receber");
    await u.click(await screen.findByRole("button", { name: "+ Nova conta a receber" }));
    const painel = await screen.findByRole("dialog", { name: "Nova conta a receber" });
    await u.selectOptions(within(painel).getByLabelText("Cliente"), "cl1");
    await u.type(within(painel).getByLabelText("Número do documento"), "DOC-1");
    await u.type(within(painel).getByLabelText("Valor"), "10");
    await u.click(within(painel).getByRole("button", { name: "Lançar conta a receber" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Já existe uma conta a receber com este número de documento");
  });

  test("a lista mostra categoria e observação; só a conta manual pendente tem Editar e Cancelar", async () => {
    instalarApiFalsa(rotas({
      "GET /api/financeiro/relatorios/contas-receber": posicao([item(), item({ id: "r2", numero_documento: "FAT-1", origem: "faturamento", categoria: null, observacao: null, editavel: false, cliente_nome: "Empresa X" })]),
    }));
    await abrirAba("receber");
    const manual = (await screen.findByText("Maria Eventos")).closest("tr")!;
    expect(within(manual).getByText("Aluguel")).toBeInTheDocument();
    expect(within(manual).getByText(/Salão/)).toBeInTheDocument();
    expect(within(manual).getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(within(manual).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    const fatura = screen.getByText("Empresa X").closest("tr")!;
    expect(within(fatura).getByText("Hospedagem (fatura)")).toBeInTheDocument();
    expect(within(fatura).queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(within(fatura).queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  test("edita a conta pendente com os dados preenchidos (PUT, sem local)", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "PUT /api/financeiro/contas-receber/r1": { id: "r1" } }));
    await abrirAba("receber");
    await u.click(within((await screen.findByText("Maria Eventos")).closest("tr")!).getByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog", { name: "Editar conta a receber" });
    expect(within(painel).getByLabelText("Número do documento")).toHaveValue("DOC-1");
    expect(within(painel).getByLabelText("Valor")).toHaveValue("1.000,00");
    expect(within(painel).getByLabelText("Vencimento")).toHaveValue("2026-12-20");
    await u.clear(within(painel).getByLabelText("Valor"));
    await u.type(within(painel).getByLabelText("Valor"), "1.200,00");
    await u.click(within(painel).getByRole("button", { name: "Salvar alterações" }));
    const put = await esperarChamada(chamadas, "PUT", "/api/financeiro/contas-receber/r1");
    expect(put.corpo).toEqual({ cliente_id: "cl1", numero_documento: "DOC-1", valor: 120000, vencimento: "2026-12-20", categoria: "aluguel", observacao: "Salão" });
  });

  test("cancela com motivo e supervisor; a recusa do servidor fica na janela", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "POST /api/financeiro/contas-receber/r1/cancelar": { __status: 422, codigo: "ESTADO_INVALIDO", mensagem: "Só é possível enquanto a conta está pendente, sem nenhum recebimento nem parcela de saldo em andamento." } }));
    await abrirAba("receber");
    await u.click(within((await screen.findByText("Maria Eventos")).closest("tr")!).getByRole("button", { name: "Cancelar" }));
    const janela = await screen.findByRole("dialog", { name: "Cancelar conta a receber" });
    await u.type(within(janela).getByLabelText("Motivo"), "Evento cancelado");
    await u.type(within(janela).getByLabelText("Login do supervisor"), "admin");
    await u.type(within(janela).getByLabelText("Senha do supervisor"), "admin");
    await u.click(within(janela).getByRole("button", { name: "Autorizar" }));
    expect(await within(janela).findByText(/Só é possível enquanto a conta está pendente/)).toBeInTheDocument();
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual({ motivo: "Evento cancelado", supervisor: { login: "admin", senha: "admin" } });
  });

  test("conta com recebimento oferece Estornar recebimento (do último lançamento)", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({
      "GET /api/financeiro/relatorios/contas-receber": posicao([item({ valor_recebido: 30000, valor_original: 30000, valor_total: 100000, valor_pendente: 0, situacao: "recebido", editavel: false, lancamento_id: "lc1" })]),
      "POST /api/financeiro/lancamentos/lc1/estornar": { id: "lc1" },
    }));
    await abrirAba("receber");
    await u.click(within((await screen.findByText("Maria Eventos")).closest("tr")!).getByRole("button", { name: "Estornar recebimento" }));
    const janela = await screen.findByRole("dialog", { name: "Estornar recebimento" });
    await u.type(within(janela).getByLabelText("Motivo"), "Valor errado");
    await u.type(within(janela).getByLabelText("Login do supervisor"), "admin");
    await u.type(within(janela).getByLabelText("Senha do supervisor"), "admin");
    await u.click(within(janela).getByRole("button", { name: "Autorizar" }));
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/lancamentos/lc1/estornar");
    expect(post.corpo).toEqual({ motivo: "Valor errado", supervisor: { login: "admin", senha: "admin" } });
  });

  test("recebimento parcial da conta manual pede a nova data (mesmo painel de sempre)", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas({ "PUT /api/financeiro/contas-receber/r1/confirmar-pagamento": { id: "r1" } }));
    await abrirAba("receber");
    await u.click(within((await screen.findByText("Maria Eventos")).closest("tr")!).getByRole("button", { name: "Confirmar pagamento" }));
    const painel = await screen.findByRole("dialog", { name: "Confirmar pagamento" });
    await u.clear(within(painel).getByLabelText("Valor recebido"));
    await u.type(within(painel).getByLabelText("Valor recebido"), "400,00");
    fireEvent.change(within(painel).getByLabelText("Novo vencimento do saldo"), { target: { value: "2027-02-01" } });
    await u.selectOptions(within(painel).getByLabelText("Conta de destino"), BANCO.id);
    await u.click(within(painel).getByRole("button", { name: "Confirmar" }));
    const put = await esperarChamada(chamadas, "PUT", "/api/financeiro/contas-receber/r1/confirmar-pagamento");
    expect(put.corpo).toEqual({ valor: 40000, conta_bancaria_id: BANCO.id, novo_vencimento: "2027-02-01", chave: expect.any(String) });
  });
});

describe("Cartão: reversão da baixa e origem na hospedagem", () => {
  const MOV = { id: "k1", local_id: "l1", data: "2026-11-10", adquirente: "Cielo", bandeira: "Visa", tipo: "credito", valor_bruto: 10000, taxa_percentual: 2, prazo_dias: 30, valor_taxa: 200, valor_liquido: 9800, previsao: "2026-12-10", status: "baixado", revisar: 0, lancamento_id: "lx", conta_destino_id: CAIXA.id, baixado_em: "x", origem_hospedagem: false };
  const rotas = (movs: object[], extra: Record<string, unknown> = {}) => ({ ...rotasBase(), "GET /api/financeiro/cartao/movimentos": movs, "GET /api/financeiro/cobranca/condicoes": [], ...extra });

  test("Estornar baixa (motivo e supervisor) devolve a a receber", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(rotas([MOV], { "POST /api/financeiro/cartao/movimentos/k1/estornar-baixa": { ...MOV, status: "a_receber" } }));
    await abrirAba("cartao");
    await u.click(within((await screen.findByText("Visa")).closest("tr")!).getByRole("button", { name: "Estornar baixa" }));
    const janela = await screen.findByRole("dialog", { name: "Estornar baixa do cartão" });
    await u.type(within(janela).getByLabelText("Motivo"), "Conta errada");
    await u.type(within(janela).getByLabelText("Login do supervisor"), "admin");
    await u.type(within(janela).getByLabelText("Senha do supervisor"), "admin");
    await u.click(within(janela).getByRole("button", { name: "Autorizar" }));
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/cartao/movimentos/k1/estornar-baixa");
    expect(post.corpo).toEqual({ motivo: "Conta errada", supervisor: { login: "admin", senha: "admin" } });
  });

  test("movimento a receber que veio da hospedagem não tem Cancelar: avisa a origem", async () => {
    instalarApiFalsa(rotas([{ ...MOV, status: "a_receber", origem_hospedagem: true }]));
    await abrirAba("cartao");
    const linha = (await screen.findByText("Visa")).closest("tr")!;
    expect(within(linha).queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
    expect(within(linha).getByText("pagamento da hospedagem")).toBeInTheDocument();
  });
});

describe("Fila do Financeiro (administração)", () => {
  const abrirFila = () => {
    const r = renderizar(<FinanceiroLayout aba="fila" />, { usuario: { permissoes: ["config.gerenciar"], perfil: "admin" } });
    return r;
  };
  const BLOQ = {
    cursor: 10, pendentes: 3,
    bloqueado: { seq: 11, tipo: "hospedagem.ValorAReceberCriado", valor: 9000, erro: "Financeiro: valor a receber v1 não encontrado.", falhas: 5, criado_em: "2026-11-10T15:00:00.000Z" },
    ignorados: [],
  };

  test("mostra o evento bloqueado com valor e erro, em português", async () => {
    instalarApiFalsa({ "GET /api/financeiro/locais": [], "GET /api/financeiro/fila": BLOQ });
    abrirFila();
    expect(await screen.findByRole("alert")).toHaveTextContent("A fila está parada neste evento");
    const lista = screen.getByRole("list", { name: "Evento bloqueado" });
    expect(within(lista).getByText("Checkout faturado na hospedagem (nº 11)")).toBeInTheDocument();
    expect(within(lista).getByText("R$ 90,00")).toBeInTheDocument();
    expect(screen.getByText(/valor a receber v1 não encontrado/)).toBeInTheDocument();
  });

  test("Tentar de novo chama a fila e atualiza", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/financeiro/locais": [], "GET /api/financeiro/fila": BLOQ,
      "POST /api/financeiro/fila/tentar-novamente": { processados: 0, falhou: { seq: 11, erro: "x" } },
    });
    abrirFila();
    await u.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    await esperarChamada(chamadas, "POST", "/api/financeiro/fila/tentar-novamente");
  });

  test("Ignorar evento exige motivo e supervisor e envia o número do evento; o erro fica na janela", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/financeiro/locais": [], "GET /api/financeiro/fila": BLOQ,
      "POST /api/financeiro/fila/ignorar": { __status: 422, codigo: "SUPERVISOR_INVALIDO", mensagem: "Senha do supervisor incorreta." },
    });
    abrirFila();
    await u.click(await screen.findByRole("button", { name: "Ignorar evento" }));
    const janela = await screen.findByRole("dialog", { name: "Ignorar evento" });
    await u.type(within(janela).getByLabelText("Motivo"), "Dado inválido da hospedagem");
    await u.type(within(janela).getByLabelText("Login do supervisor"), "admin");
    await u.type(within(janela).getByLabelText("Senha do supervisor"), "errada");
    await u.click(within(janela).getByRole("button", { name: "Autorizar" }));
    expect(await within(janela).findByText("Senha do supervisor incorreta.")).toBeInTheDocument();
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual({ seq: 11, motivo: "Dado inválido da hospedagem", supervisor: { login: "admin", senha: "errada" } });
  });

  test("fila em dia mostra o histórico de eventos ignorados com valor e motivo", async () => {
    instalarApiFalsa({
      "GET /api/financeiro/locais": [],
      "GET /api/financeiro/fila": { cursor: 12, pendentes: 0, bloqueado: null, ignorados: [{ seq: 11, tipo: "hospedagem.ValorAReceberCriado", valor: 9000, motivo: "Dado inválido", ator: "usuario-admin", criado_em: "2026-11-10T15:00:00.000Z" }] },
    });
    abrirFila();
    expect(await screen.findByText("Fila em dia")).toBeInTheDocument();
    const linha = screen.getByText("Dado inválido").closest("tr")!;
    expect(within(linha).getByText("R$ 90,00")).toBeInTheDocument();
    expect(within(linha).getByText("11")).toBeInTheDocument();
  });
});
