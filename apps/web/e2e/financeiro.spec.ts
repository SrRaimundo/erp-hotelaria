import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/** Capturas de cada tela (desktop e 390 px) para conferir o visual a olho. */
const CAPTURAS = process.env.ERP_CAPTURAS_FIN ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../.superpowers/sdd/financeiro/capturas");

const SUFIXO = Date.now().toString(36);
const USUARIO = `financeiro-${SUFIXO}`;
const SENHA = "financeiro123";
const LOCAL = `Pousada E2E ${SUFIXO}`;
const CLIENTE = `Empresa E2E ${SUFIXO} Ltda`;
const CNPJ = "11222333000181";

/** "R$ 1.234,56" -> centavos. */
const centavos = (t: string) => Math.round(Number(t.replace(/[^\d,-]/g, "").replace(",", ".")) * 100);

async function api(request: APIRequestContext, token: string, metodo: "get" | "post" | "put", caminho: string, data?: unknown) {
  const r = await request[metodo](caminho, { headers: { Authorization: `Bearer ${token}` }, data });
  return r;
}

async function token(request: APIRequestContext, login: string, senha: string): Promise<string> {
  const r = await request.post("/api/sessoes", { data: { login, senha } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).token as string;
}

async function entrar(page: Page, login: string, senha: string) {
  await page.goto("/");
  await page.getByLabel("Login").fill(login);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

/** Abre o item do grupo Financeiro pelo menu lateral. */
async function irPara(page: Page, item: string) {
  const grupo = page.getByRole("button", { name: /^Financeiro/ });
  if ((await grupo.getAttribute("aria-expanded")) !== "true") await grupo.click();
  await page.locator("#menu-grupo-financeiro").getByRole("link", { name: item, exact: true }).click();
}

/** Abre o item Cobrança do grupo Cadastros (visível para quem tem a permissão financeira). */
async function irParaCobranca(page: Page) {
  const grupo = page.getByRole("button", { name: /^Cadastros/ });
  if ((await grupo.getAttribute("aria-expanded")) !== "true") await grupo.click();
  await page.locator("#menu-grupo-cadastros").getByRole("link", { name: "Cobrança", exact: true }).click();
}

/** Captura desktop e 390 px e garante que a página não rola na horizontal no celular. */
async function capturar(page: Page, nome: string) {
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: join(CAPTURAS, `${nome}-desktop.png`), fullPage: true });
  const original = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(CAPTURAS, `${nome}-390.png`), fullPage: true });
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (sobra > 0) {
    const culpados = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        // o que está dentro de uma área com rolagem própria não alarga a página
        .filter((e) => {
          for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
            const o = getComputedStyle(p).overflowX;
            if (o === "auto" || o === "scroll" || o === "hidden") return false;
          }
          return true;
        })
        .slice(0, 8)
        .map((e) => `${e.tagName.toLowerCase()}.${(e as HTMLElement).className}`.slice(0, 80)),
    );
    console.log(`${nome}: elementos além da borda`, culpados);
    const larguras = await page.evaluate(() =>
      ["html", "body", "#root", ".shell", ".shell__coluna", ".shell__conteudo", ".fin", ".menu", ".topo", ".cartao"].map((q) => {
        const e = document.querySelector(q) as HTMLElement | null;
        return e ? `${q}: client ${e.clientWidth} scroll ${e.scrollWidth}` : `${q}: -`;
      }),
    );
    console.log(larguras);
  }
  expect(sobra, `${nome}: a página rola na horizontal no celular`).toBeLessThanOrEqual(0);
  await page.setViewportSize(original);
}

/** Senha do usuário de teste (perfil admin, também supervisor). */
const senhaAdmin = async () => `${SENHA}x`;
const loginSupervisor = USUARIO;

const saldoDaConta = async (page: Page, conta: string) => {
  const linha = page.getByRole("list", { name: "Contas do local" }).locator("li", { hasText: conta });
  return centavos(await linha.locator("strong").innerText());
};

test.describe.serial("financeiro: do cadastro ao saldo", () => {
  let page: Page;
  let admin: string;
  let saldoBanco = 0;

  test.beforeAll(async ({ browser, request }) => {
    // Usuário próprio de perfil admin: o admin padrão tem a troca de senha obrigatória tratada no roteiro da recepção.
    admin = await token(request, "admin", "admin");
    const criado = await api(request, admin, "post", "/api/usuarios", { nome: "Financeiro E2E", login: USUARIO, senha: SENHA, perfil: "admin" });
    expect(criado.status()).toBe(201);
    const meu = await token(request, USUARIO, SENHA);
    const troca = await request.put("/api/usuarios/me/senha", { headers: { Authorization: `Bearer ${meu}` }, data: { senhaAtual: SENHA, novaSenha: `${SENHA}x` } });
    expect(troca.status()).toBe(204);
    page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
    await entrar(page, USUARIO, `${SENHA}x`);
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("1. Local: cria o local que recebe a hospedagem", async () => {
    await expect(page.getByRole("button", { name: /^Financeiro/ })).toBeVisible();
    await irPara(page, "Local");
    await expect(page.getByRole("heading", { name: "Locais", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "+ Novo local" }).click();
    const painel = page.getByRole("dialog", { name: /Locais/ });
    await painel.getByLabel("Nome do local").fill(LOCAL);
    await painel.getByLabel("Recebe os lançamentos da hospedagem").check();
    await painel.getByRole("button", { name: "Salvar" }).click();
    await expect(painel).toBeHidden();
    await expect(page.getByRole("row", { name: new RegExp(LOCAL) })).toContainText("recebe a hospedagem");
    await capturar(page, "01-local");
  });

  test("2. Caixa e Banco: cria uma conta com saldo inicial", async () => {
    await irPara(page, "Caixa e Banco");
    await expect(page.getByLabel("Local", { exact: true })).toContainText(LOCAL);
    await page.getByRole("button", { name: "+ Nova conta" }).click();
    const painel = page.getByRole("dialog", { name: "Nova conta" });
    await painel.getByLabel("Nome da conta").fill("Banco E2E");
    await painel.getByLabel("Banco", { exact: true }).fill("341");
    await painel.getByLabel("Agência").fill("0001");
    await painel.getByLabel("Número da conta").fill("12345-6");
    await painel.getByLabel("Saldo inicial").fill("1.000,00");
    await painel.getByRole("button", { name: "Criar conta" }).click();
    await expect(painel).toBeHidden();
    saldoBanco = 100000;
    expect(await saldoDaConta(page, "Banco E2E")).toBe(saldoBanco);
    await expect(page.getByLabel("Conta (caixa/banco)")).toContainText("Banco E2E");
    await capturar(page, "02-caixa-e-banco");
  });

  test("3. Contas a Pagar: lança, paga e o saldo do banco diminui", async () => {
    await irPara(page, "Contas a Pagar");
    await page.getByRole("button", { name: "+ Nova conta a pagar" }).click();
    let painel = page.getByRole("dialog", { name: "Nova conta a pagar" });
    await painel.getByLabel("Tipo").selectOption({ label: "Serviço" });
    await painel.getByLabel("Descrição").fill("Energia elétrica E2E");
    await painel.getByLabel("Valor").fill("150,00");
    await capturar(page, "03a-nova-conta-a-pagar");
    await painel.getByRole("button", { name: "Lançar conta a pagar" }).click();
    await expect(painel).toBeHidden();
    const linha = page.getByRole("row", { name: /Energia elétrica E2E/ });
    await expect(linha).toContainText("Pendente");
    await capturar(page, "03-contas-a-pagar");

    await linha.getByRole("button", { name: "Pagar" }).click();
    painel = page.getByRole("dialog", { name: "Pagar conta" });
    const opcaoBanco = await painel.getByLabel("Pagar com a conta").locator("option", { hasText: "Banco E2E" }).textContent();
    await painel.getByLabel("Pagar com a conta").selectOption({ label: opcaoBanco! });
    await painel.getByRole("button", { name: "Confirmar pagamento" }).click();
    await expect(painel).toBeHidden();
    await expect(linha).toContainText("Pago");

    await irPara(page, "Caixa e Banco");
    saldoBanco -= 15000;
    await expect.poll(() => saldoDaConta(page, "Banco E2E")).toBe(saldoBanco);
  });

  test("3b. Contas a Pagar: pagamento parcial cria a parcela do saldo e só o valor pago sai da conta", async () => {
    await irPara(page, "Contas a Pagar");
    await page.getByRole("button", { name: "+ Nova conta a pagar" }).click();
    let painel = page.getByRole("dialog", { name: "Nova conta a pagar" });
    await painel.getByLabel("Descrição").fill("Aluguel E2E");
    await painel.getByLabel("Valor").fill("200,00");
    await painel.getByRole("button", { name: "Lançar conta a pagar" }).click();
    await expect(painel).toBeHidden();
    await page.getByRole("row", { name: /Aluguel E2E/ }).getByRole("button", { name: "Pagar" }).click();
    painel = page.getByRole("dialog", { name: "Pagar conta" });
    const opcao = await painel.getByLabel("Pagar com a conta").locator("option", { hasText: "Banco E2E" }).textContent();
    await painel.getByLabel("Pagar com a conta").selectOption({ label: opcao! });
    await painel.getByLabel("Valor a pagar agora").fill("80,00");
    await painel.getByLabel("Novo vencimento do saldo").fill("2030-01-15");
    await painel.getByRole("button", { name: "Confirmar pagamento" }).click();
    await expect(painel).toBeHidden();
    await expect(page.getByText(/pago parcial \(R\$ 80,00 de R\$ 200,00\)/)).toBeVisible();
    await expect(page.getByText(/saldo de pagamento parcial/)).toBeVisible();
    await capturar(page, "03b-pagamento-parcial");
    await irPara(page, "Caixa e Banco");
    saldoBanco -= 8000;
    await expect.poll(() => saldoDaConta(page, "Banco E2E")).toBe(saldoBanco);
  });

  let faturado = 0;
  test("4. Hospedagem: check-out com valor faturado chega em Faturamento aberto", async ({ request }) => {
    const lista = await (await api(request, admin, "get", "/api/reservas?estado=hospedada&porPagina=100")).json();
    const reserva = (lista.itens as { reservaId: string; quartoNumero: string | null }[]).find((r) => r.quartoNumero === "102");
    expect(reserva, "a pousada de demonstração tem a reserva hospedada no quarto 102").toBeDefined();
    const previa = await (await api(request, admin, "get", `/api/reservas/${reserva!.reservaId}/checkout`)).json();
    faturado = previa.saldo as number;
    expect(faturado).toBeGreaterThan(0);
    const r = await api(request, admin, "post", `/api/reservas/${reserva!.reservaId}/checkout`, {
      pagamentos: [], faturado: { nome: CLIENTE, documento: CNPJ, valor: faturado },
    });
    expect(r.ok(), await r.text()).toBeTruthy();

    await irPara(page, "Faturamento");
    const linha = page.getByRole("row", { name: new RegExp(CLIENTE) });
    await expect(linha).toBeVisible();
    await expect(linha).toContainText("Para fechar");
    await capturar(page, "04-faturamento");
  });

  test("5. Faturamento: fecha a fatura e ela vai para Contas a Receber", async () => {
    await page.getByRole("row", { name: new RegExp(CLIENTE) }).getByRole("button", { name: "Fechar fatura" }).click();
    const painel = page.getByRole("dialog", { name: "Fechar fatura" });
    await expect(painel).toContainText(CNPJ);
    await painel.getByLabel("E-mail para cobrança").fill("cobranca@e2e.com.br");
    await painel.getByLabel("Telefone").fill("8133334444");
    await painel.getByLabel("Endereço").fill("Av. Principal, 100");
    await painel.getByLabel("Forma de cobrança").selectOption({ label: "Pix" });
    await capturar(page, "05a-fechar-fatura");
    await painel.getByRole("button", { name: "Fechar fatura" }).click();
    await expect(painel).toBeHidden();
    await expect(page.getByText(/Nenhum fechamento marcado/)).toBeVisible();
    await page.getByLabel("Mostrar").selectOption({ label: "Fechadas" });
    await page.getByRole("row", { name: new RegExp(CLIENTE) }).getByRole("button", { name: "Extrato" }).click();
    const extrato = page.getByRole("dialog", { name: "Extrato da cobrança" });
    await expect(extrato).toContainText(CLIENTE);
    await expect(extrato).toContainText("Total da fatura");
    await capturar(page, "05b-extrato-da-cobranca");
    await extrato.getByRole("button", { name: "Fechar" }).click();

    await irPara(page, "Contas a Receber");
    const linha = page.getByRole("row", { name: new RegExp(CLIENTE) });
    await expect(linha).toContainText("FAT-");
    await expect(linha).toContainText("Aberto");
    await capturar(page, "05-contas-a-receber");
  });

  test("6. Contas a Receber: recebe na conta do banco e o saldo sobe", async () => {
    await page.getByRole("row", { name: new RegExp(CLIENTE) }).getByRole("button", { name: "Confirmar pagamento" }).click();
    const painel = page.getByRole("dialog", { name: "Confirmar pagamento" });
    await painel.getByLabel("Conta de destino").selectOption({ label: "Banco E2E" });
    await painel.getByRole("button", { name: "Confirmar" }).click();
    await expect(painel).toBeHidden();
    await expect(page.getByRole("row", { name: new RegExp(CLIENTE) })).toContainText("Recebido");

    await irPara(page, "Caixa e Banco");
    saldoBanco += faturado;
    await expect.poll(() => saldoDaConta(page, "Banco E2E")).toBe(saldoBanco);
    await expect(page.getByLabel("Conta (caixa/banco)")).toBeVisible();
    await page.getByLabel("Conta (caixa/banco)").selectOption({ label: "Banco E2E" });
    await expect(page.locator(".fin__destaque")).toHaveText(new RegExp(`R\\$`));
    await capturar(page, "06-caixa-e-banco-depois");
  });

  test("6a. Contas a Receber manual: cliente na hora, recebimento parcial, estorno e cancelamento", async () => {
    await irPara(page, "Contas a Receber");
    await page.getByRole("button", { name: "+ Nova conta a receber" }).click();
    let painel = page.getByRole("dialog", { name: "Nova conta a receber" });
    await painel.getByRole("button", { name: "+ Novo cliente" }).click();
    const novo = page.getByRole("dialog", { name: "Novo cliente" });
    await novo.getByLabel("Nome do cliente").fill(`Salão E2E ${SUFIXO}`);
    await novo.getByRole("button", { name: "Cadastrar" }).click();
    await expect(novo).toBeHidden();
    await painel.getByLabel("Número do documento").fill(`ALU-${SUFIXO}`);
    await painel.getByLabel("Categoria").selectOption({ label: "Aluguel" });
    await painel.getByLabel("Valor").fill("500,00");
    await painel.getByLabel("Observação").fill("Salão de festas");
    await painel.getByRole("button", { name: "Lançar conta a receber" }).click();
    await expect(painel).toBeHidden();
    const linha = page.getByRole("row", { name: new RegExp(`ALU-${SUFIXO}`) });
    await expect(linha).toContainText("Aluguel");
    await expect(linha).toContainText("Salão de festas");
    await capturar(page, "06a-conta-a-receber-manual");

    // edita enquanto pendente
    await linha.getByRole("button", { name: "Editar" }).click();
    painel = page.getByRole("dialog", { name: "Editar conta a receber" });
    await painel.getByLabel("Observação").fill("Salão e som");
    await painel.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(painel).toBeHidden();
    await expect(linha).toContainText("Salão e som");

    // recebe parte, com nova data para o saldo
    await linha.getByRole("button", { name: "Confirmar pagamento" }).click();
    painel = page.getByRole("dialog", { name: "Confirmar pagamento" });
    await painel.getByLabel("Valor recebido").fill("200,00");
    await painel.getByLabel("Novo vencimento do saldo").fill("2030-02-01");
    await painel.getByLabel("Conta de destino").selectOption({ label: "Banco E2E" });
    await painel.getByRole("button", { name: "Confirmar" }).click();
    await expect(painel).toBeHidden();
    await expect(page.getByText(/saldo de recebimento parcial/)).toBeVisible();
    await expect(page.getByText(/recebido parcial de R\$ 500,00/)).toBeVisible();
    saldoBanco += 20000;

    // estorna o recebimento: a conta volta inteira, a parcela do saldo some
    await page.getByRole("row", { name: /recebido parcial de/ }).getByRole("button", { name: "Estornar recebimento" }).click();
    const janela = page.getByRole("dialog", { name: "Estornar recebimento" });
    await janela.getByLabel("Motivo").fill("Valor errado");
    await janela.getByLabel("Login do supervisor").fill(loginSupervisor);
    await janela.getByLabel("Senha do supervisor").fill(await senhaAdmin());
    await janela.getByRole("button", { name: "Autorizar" }).click();
    await expect(janela).toBeHidden();
    saldoBanco -= 20000;
    await expect(page.getByText(/saldo de recebimento parcial/)).toHaveCount(0);
    const volta = page.getByRole("row", { name: new RegExp(`ALU-${SUFIXO}`) });
    await expect(volta).toContainText("R$ 500,00");

    // cancela a conta pendente
    await volta.getByRole("button", { name: "Cancelar" }).click();
    const cancelar = page.getByRole("dialog", { name: "Cancelar conta a receber" });
    await cancelar.getByLabel("Motivo").fill("Evento desmarcado");
    await cancelar.getByLabel("Login do supervisor").fill(loginSupervisor);
    await cancelar.getByLabel("Senha do supervisor").fill(await senhaAdmin());
    await cancelar.getByRole("button", { name: "Autorizar" }).click();
    await expect(cancelar).toBeHidden();
    await expect(page.getByRole("row", { name: new RegExp(`ALU-${SUFIXO}`) })).toHaveCount(0);

    await irPara(page, "Caixa e Banco");
    await expect.poll(() => saldoDaConta(page, "Banco E2E")).toBe(saldoBanco);
  });

  test("6b. Cobrança: cadastra a condição do cartão no grupo Cadastros", async () => {
    await irParaCobranca(page);
    await expect(page.getByRole("heading", { name: "Cobrança", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "+ Nova condição" }).click();
    const painel = page.getByRole("dialog", { name: "Nova condição de cobrança" });
    await painel.getByLabel("Adquirente").fill("Cielo E2E");
    await painel.getByLabel("Bandeira").fill("Visa");
    await painel.getByLabel("Prazo para receber (dias, D+N)").fill("30");
    await painel.getByLabel("Taxa (%)").fill("2");
    await painel.getByRole("button", { name: "Salvar" }).click();
    await expect(painel).toBeHidden();
    await expect(page.getByRole("row", { name: /Cielo E2E/ })).toContainText("D+30");
    await capturar(page, "06b-cobranca");
  });

  test("7. Cartão de Crédito: registra pela condição, baixa o líquido e a taxa vira despesa só de registro", async () => {
    await irPara(page, "Cartão de Crédito");
    await page.getByRole("button", { name: "+ Novo movimento" }).click();
    let painel = page.getByRole("dialog", { name: "Novo movimento de cartão" });
    const cond = await painel.getByLabel("Condição de cobrança").locator("option", { hasText: "Cielo E2E" }).textContent();
    await painel.getByLabel("Condição de cobrança").selectOption({ label: cond! });
    await painel.getByLabel("O valor informado é").selectOption({ label: "Líquido (já sem a taxa)" });
    await painel.getByLabel("Valor", { exact: true }).fill("98,00");
    await expect(painel.getByRole("list", { name: "Conferência dos valores" })).toContainText("R$ 100,00");
    await capturar(page, "07a-novo-movimento-cartao");
    await painel.getByRole("button", { name: "Registrar movimento" }).click();
    await expect(painel).toBeHidden();
    const linha = page.getByRole("row", { name: /Cielo E2E/ });
    await expect(linha).toContainText("A receber");
    await expect(linha).toContainText("D+30");
    await capturar(page, "07-cartao");

    await linha.getByRole("button", { name: "Baixar" }).click();
    painel = page.getByRole("dialog", { name: "Baixar cartão" });
    await painel.getByLabel("Conta que recebeu").selectOption({ label: "Banco E2E" });
    await painel.getByRole("button", { name: "Baixar no Caixa e Banco" }).click();
    await expect(painel).toBeHidden();
    await expect(linha).toContainText("Baixado");

    await irPara(page, "Caixa e Banco");
    saldoBanco += 9800; // só o líquido
    await expect.poll(() => saldoDaConta(page, "Banco E2E")).toBe(saldoBanco);

    await irPara(page, "Contas a Pagar");
    const taxa = page.getByRole("row", { name: /Taxa do cartão Visa/ });
    await expect(taxa).toContainText("Cartão de Crédito (taxa)");
    await expect(taxa).toContainText("Liquidado");
    await expect(taxa.getByRole("button")).toHaveCount(0);
    await capturar(page, "07b-taxa-do-cartao");
  });

  test("8. Relatórios: abre sem erro", async () => {
    await irPara(page, "Relatórios");
    await expect(page.getByRole("heading", { name: "Fluxo de caixa (hoje)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cartão (líquido)" })).toBeVisible();
    await expect(page.locator(".erro-acao")).toHaveCount(0);
    // O fluxo de hoje enxerga os movimentos do dia local, mesmo à noite (quando o dia UTC já virou).
    const fluxo = page.getByRole("heading", { name: "Fluxo de caixa (hoje)" }).locator("..");
    await expect(fluxo.locator(".fin__resumo li", { hasText: "Entradas" })).not.toContainText("R$ 0,00");
    await expect(fluxo.locator(".fin__resumo li", { hasText: "Saídas" })).not.toContainText("R$ 0,00");
    await capturar(page, "08-relatorios");
  });

  test("9. Nenhum item do grupo Financeiro é tela provisória", async () => {
    for (const item of ["Local", "Contas a Pagar", "Contas a Receber", "Cartão de Crédito", "Caixa e Banco", "Faturamento", "Relatórios", "Fila do Financeiro"]) {
      await irPara(page, item);
      await expect(page.getByText("Esta tela ainda será construída.")).toHaveCount(0);
      await expect(page.locator("h1").first()).toBeVisible();
    }
  });

  test("9b. Fila do Financeiro: em dia, sem evento bloqueado", async () => {
    await irPara(page, "Fila do Financeiro");
    await expect(page.getByRole("heading", { name: "Fila do Financeiro", level: 1 })).toBeVisible();
    await expect(page.getByText("Fila em dia")).toBeVisible();
    await expect(page.getByText("Nenhum evento foi ignorado.")).toBeVisible();
    await capturar(page, "09b-fila-do-financeiro");
  });

  test("10. Recepção não vê o grupo Financeiro nem a API", async ({ browser, request }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await entrar(p, "recepcao", "recepcao123");
    await expect(p.getByRole("link", { name: "Mapa" })).toBeVisible();
    await expect(p.getByRole("button", { name: /^Financeiro/ })).toHaveCount(0);
    await p.goto("/financeiro/local");
    await expect(p.getByRole("heading", { name: "Locais" })).toHaveCount(0);
    await ctx.close();
    const rec = await token(request, "recepcao", "recepcao123");
    expect((await api(request, rec, "get", "/api/financeiro/locais")).status()).toBe(403);
  });
});
