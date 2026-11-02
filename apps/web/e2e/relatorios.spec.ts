import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/** Com ERP_CAPTURAS=<pasta>, guarda capturas em mídia de impressão e um PDF de amostra (evidência visual, fora do roteiro normal). */
const CAPTURAS = process.env.ERP_CAPTURAS;

async function entrar(page: Page, login: string, senha: string) {
  await page.goto("/");
  await page.getByLabel("Login").fill(login);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("link", { name: "Relatórios" })).toBeVisible();
}

const amanha = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Em mídia de impressão: menu, barra e filtros somem, o cabeçalho aparece e a tabela ocupa a largura da folha. */
async function conferirImpressao(page: Page, nome: string) {
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("cabecalho-impressao")).toBeVisible();
  await expect(page.locator(".menu")).toBeHidden();
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeHidden();
  const largura = await page.locator(".rel-tabela").last().evaluate((t) => t.getBoundingClientRect().width);
  expect(largura).toBeGreaterThan(page.viewportSize()!.width * 0.6);
  if (CAPTURAS) {
    mkdirSync(CAPTURAS, { recursive: true });
    await page.screenshot({ path: join(CAPTURAS, nome), fullPage: true });
  }
  await page.emulateMedia({ media: "screen" });
}

test.describe.serial("relatórios do hotel", () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true })).newPage();
    await entrar(page, "recepcao", "recepcao123");
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("1. check-in: abre pelo catálogo, troca a data e baixa o PDF", async () => {
    await page.getByRole("link", { name: "Relatórios" }).click();
    await page.getByRole("link", { name: /Lista de check-in/ }).click();
    await expect(page.getByRole("heading", { name: "Lista de check-in", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exportar PDF" })).toBeEnabled();

    const outra = amanha();
    const resposta = page.waitForResponse((r) => r.url().includes(`/api/relatorios/check-in?data=${outra}`) && r.ok());
    await page.getByLabel("Data").fill(outra);
    await resposta;
    await expect(page).toHaveURL(new RegExp(`data=${outra}`));
    const [, mes, dia] = outra.split("-");
    await expect(page.getByRole("heading", { level: 2, name: new RegExp(`${dia}/${mes}/`) })).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar PDF" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^check-in-\d{4}-\d{2}-\d{2}\.pdf$/);
    const caminho = await download.path();
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(caminho);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    if (CAPTURAS) {
      mkdirSync(CAPTURAS, { recursive: true });
      writeFileSync(join(CAPTURAS, "amostra-check-in.pdf"), bytes);
    }
  });

  test("2. café da manhã: abre e mostra a tabela ou a mensagem de vazio", async () => {
    await page.goto("/relatorios/cafe");
    await expect(page.getByRole("heading", { name: "Lista do café da manhã", level: 1 })).toBeVisible();
    await expect(page.getByRole("table").or(page.getByText("Nada para mostrar neste filtro")).first()).toBeVisible();
  });

  test("3. limpeza: colunas em branco e captura em mídia de impressão", async () => {
    await page.goto("/relatorios/limpeza");
    await expect(page.getByRole("heading", { name: "Limpeza dos apartamentos", level: 1 })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Feito" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exportar PDF" })).toBeEnabled();
    await conferirImpressao(page, "impressao-limpeza.png");
  });

  test("4. conta: 'Imprimir conta' da reserva abre o relatório da reserva", async () => {
    await page.getByRole("link", { name: "Mapa" }).click();
    await page.locator(".mapa-linha button", { hasText: /Ana Beatriz Costa/ }).first().click();
    await page.getByRole("button", { name: "Imprimir conta" }).click();
    await expect(page).toHaveURL(/\/relatorios\/conta\?reserva=/);
    await expect(page.getByRole("heading", { name: "Conta do hóspede", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Extrato", level: 2 })).toBeVisible();
    // o painel da reserva não cobre o relatório
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await conferirImpressao(page, "impressao-conta.png");
  });
});

test("5. relatório no celular não rola a página na horizontal @celular", async ({ page }) => {
  await entrar(page, "recepcao", "recepcao123");
  for (const id of ["check-in", "limpeza"]) {
    await page.goto(`/relatorios/${id}`);
    await expect(page.getByRole("button", { name: "Exportar PDF" })).toBeEnabled();
    const medidas = await page.evaluate(() => ({ rolagem: document.documentElement.scrollWidth, janela: document.documentElement.clientWidth }));
    expect(medidas.rolagem, `/relatorios/${id}`).toBeLessThanOrEqual(medidas.janela);
  }
});
