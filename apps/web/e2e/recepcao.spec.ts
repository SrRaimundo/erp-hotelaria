import { expect, test, type Locator, type Page } from "@playwright/test";

/** "R$ 1.234,56" (ou "−R$ ...") -> centavos. */
function centavos(texto: string): number {
  const negativo = texto.includes("−") || texto.includes("-");
  const n = Number(texto.replace(/[^\d,]/g, "").replace(",", "."));
  return Math.round(n * 100) * (negativo ? -1 : 1);
}

/** centavos -> "1.234,56" (como se digita em reais). */
function digitavel(c: number): string {
  const reais = Math.floor(c / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${reais},${String(c % 100).padStart(2, "0")}`;
}

async function entrar(page: Page, login: string, senha: string) {
  await page.goto("/");
  await page.getByLabel("Login").fill(login);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

const gaveta = (page: Page) => page.getByRole("dialog", { name: /^#/ });
const itemAtencao = (page: Page, titular: string): Locator => page.locator("li.hoje-atencao__item", { hasText: titular });

test.describe.serial("recepção: um dia de ponta a ponta", () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("1. login do admin com troca de senha obrigatória", async () => {
    await entrar(page, "admin", "admin");
    await expect(page.getByRole("heading", { name: "Trocar senha" })).toBeVisible();
    await page.getByLabel("Senha atual").fill("admin");
    await page.getByLabel("Nova senha", { exact: true }).fill("admin123");
    await page.getByLabel("Confirmar nova senha").fill("admin123");
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page.getByRole("heading", { name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  });

  test("2. sinal vencendo: caixa fechado leva ao caixa; depois o sinal é recebido em Pix", async () => {
    await expect(page.getByRole("heading", { name: /Precisa da sua atenção/ })).toBeVisible();
    const item = itemAtencao(page, "Paulo Henrique Rocha");
    await expect(item).toBeVisible();
    await item.getByRole("button", { name: "Registrar sinal" }).click();

    await expect(gaveta(page)).toBeVisible();
    await expect(gaveta(page).getByText("Abra o caixa para receber pagamentos")).toBeVisible();
    await gaveta(page).getByRole("link", { name: "Ir para o caixa" }).click();

    await expect(page).toHaveURL(/\/caixa/);
    await page.getByLabel("Valor inicial em dinheiro").fill("100,00");
    await page.getByRole("button", { name: "Abrir caixa" }).click();
    await expect(page.getByRole("heading", { name: "Movimentos" })).toBeVisible();

    await page.getByRole("link", { name: "Hoje" }).click();
    await itemAtencao(page, "Paulo Henrique Rocha").getByRole("button", { name: "Registrar sinal" }).click();
    await expect(gaveta(page).getByLabel("Valor a receber")).not.toHaveValue("");
    await gaveta(page).getByLabel("Forma de pagamento").selectOption({ label: "Pix" });
    await gaveta(page).getByRole("button", { name: "Receber", exact: true }).click();
    await expect(gaveta(page).getByText("Pagamento Pix")).toBeVisible();

    await gaveta(page).getByRole("button", { name: "Fechar" }).click();
    await expect(itemAtencao(page, "Paulo Henrique Rocha")).toHaveCount(0);
  });

  test("3. nova reserva para hoje aparece no mapa", async () => {
    await page.getByRole("button", { name: "+ Nova reserva" }).click();
    await page.getByLabel("Buscar hóspede").fill("Beatriz Fernandes");
    await page.getByRole("button", { name: /Beatriz Fernandes/ }).click();
    await expect(page.getByText("Titular: Beatriz Fernandes")).toBeVisible();
    // A chegada já nasce em "hoje" (dia do servidor) e a saída em 2 noites.
    const chegada = await page.getByLabel("Chegada").inputValue();
    const saida = new Date(`${chegada}T00:00:00Z`);
    saida.setUTCDate(saida.getUTCDate() + 2);
    await page.getByLabel("Saída").fill(saida.toISOString().slice(0, 10));
    await page.getByLabel("Categoria", { exact: true }).selectOption({ label: "Standard" });
    await page.getByLabel("Canal").selectOption({ label: "Balcão" });
    await expect(page.getByRole("region", { name: "Cotação" }).getByText("Total")).toBeVisible();
    await page.getByRole("button", { name: "Reservar", exact: true }).click();

    await expect(page).toHaveURL(/\/mapa\?reserva=/);
    await expect(gaveta(page)).toContainText("Beatriz Fernandes");
    await gaveta(page).getByRole("button", { name: "Fechar" }).click();
    await expect(page.getByRole("button", { name: /^Beatriz Fernandes · / }).first()).toBeVisible();
  });

  test("4. check-in de uma chegada de hoje com o quarto sugerido", async () => {
    await page.getByRole("link", { name: "Hoje" }).click();
    const linha = page.locator("li.hoje-linha", { hasText: "Fernanda Oliveira" });
    await linha.getByRole("button", { name: "Check-in" }).click();
    await expect(gaveta(page).getByRole("radio", { checked: true })).toBeVisible();
    await gaveta(page).getByRole("button", { name: "Concluir check-in" }).click();
    await expect(gaveta(page).getByText(/Check-in concluído/)).toBeVisible();
    await expect(gaveta(page).getByRole("tab", { name: "Resumo" })).toBeVisible();
    await gaveta(page).getByRole("button", { name: "Fechar" }).click();
    await expect(page.locator("li.hoje-linha", { hasText: "Fernanda Oliveira" }).getByText("hospedada")).toBeVisible();
  });

  test("5. extra de frigobar e check-out pagando em dinheiro + crédito; quarto fica sujo", async () => {
    // A reserva que sai hoje (Carlos Eduardo Lima, quarto 202) vem da pousada de demonstração.
    const saida = page.locator("li.hoje-linha", { hasText: "Carlos Eduardo Lima" });
    await saida.getByRole("button", { name: "Check-out" }).click();
    await gaveta(page).getByRole("button", { name: "Cancelar" }).click();

    await gaveta(page).getByRole("tab", { name: "Conta" }).click();
    await gaveta(page).getByLabel("Produto").selectOption({ label: "Outro (descrição livre)" });
    await gaveta(page).getByLabel("Descrição").fill("Frigobar");
    await gaveta(page).getByLabel("Valor unitário").fill("12,00");
    await gaveta(page).getByRole("button", { name: "Lançar", exact: true }).click();
    await expect(gaveta(page).getByRole("cell", { name: "Frigobar", exact: true })).toBeVisible();

    await gaveta(page).getByRole("button", { name: "Fechar" }).click();
    await page.locator("li.hoje-linha", { hasText: "Carlos Eduardo Lima" }).getByRole("button", { name: "Check-out" }).click();
    await expect(gaveta(page).getByRole("heading", { name: "Check-out" })).toBeVisible();

    const total = centavos(await gaveta(page).locator(".checkout-devido strong").last().innerText());
    expect(total).toBeGreaterThan(1200);
    const metade = Math.floor(total / 2);
    await gaveta(page).getByLabel("Forma de pagamento 1").selectOption({ label: "Dinheiro" });
    await gaveta(page).getByLabel("Valor da forma 1").fill(digitavel(metade));
    await gaveta(page).getByRole("button", { name: "+ outra forma" }).click();
    await gaveta(page).getByLabel("Forma de pagamento 2").selectOption({ label: "Cartão de crédito" });
    await expect(gaveta(page).getByLabel("Valor da forma 2")).toHaveValue(digitavel(total - metade));
    await expect(gaveta(page).getByText("Tudo certo: R$ 0,00")).toBeVisible();
    await gaveta(page).getByRole("button", { name: "Concluir check-out" }).click();
    await expect(gaveta(page).getByText(/Check-out concluído/)).toBeVisible();

    await expect(gaveta(page)).toHaveCount(0);
    await expect(page.locator("li.hoje-pilula", { hasText: "202 sujo" })).toBeVisible();
  });

  test("6. fechar o caixa com os valores esperados deixa todas as diferenças em R$ 0,00", async () => {
    await page.getByRole("link", { name: "Caixa" }).click();
    const esperado = page.getByRole("list", { name: "Esperado por forma" }).locator("li");
    await expect(esperado.first()).toBeVisible();
    const pares: { forma: string; valor: string }[] = [];
    for (const li of await esperado.all()) {
      pares.push({ forma: (await li.locator("span").innerText()).trim(), valor: (await li.locator("strong").innerText()).trim() });
    }
    expect(pares.map((p) => p.forma)).toEqual(expect.arrayContaining(["Dinheiro", "Pix", "Cartão de crédito"]));

    await page.getByRole("button", { name: "Fechar caixa" }).click();
    for (const p of pares) await page.getByLabel(`Contado em ${p.forma}`).fill(p.valor.replace("R$ ", ""));
    await page.getByRole("button", { name: "Confirmar fechamento" }).click();

    await expect(page.getByRole("heading", { name: "Caixa fechado" })).toBeVisible();
    const diferencas = page.locator("table.caixa-tabela tbody tr td:last-child");
    expect(await diferencas.count()).toBe(pares.length);
    for (const d of await diferencas.all()) await expect(d).toHaveText("R$ 0,00");
  });
});

test("7. governança no celular marca o quarto sujo como limpo @celular", async ({ page }) => {
  await entrar(page, "governanca", "governanca123");
  await expect(page.getByRole("heading", { name: "Governança" })).toBeVisible();
  const sujo = page.getByRole("button", { name: /^202 sujo/ });
  await sujo.click();
  await page.getByRole("dialog", { name: "Marcar 202 como limpo?" }).getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("button", { name: /^202 / })).toHaveCount(0);
  await expect(page.getByText("202", { exact: true })).toBeVisible();
});
