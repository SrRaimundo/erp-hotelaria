import { expect, test, type Page } from "@playwright/test";

/** Uma noite de segunda a quinta (sem o ajuste de fim de semana) bem dentro da temporada "Alta" da demonstração (hoje+20 a hoje+40). */
function noiteDeAlta(): { chegada: string; saida: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  for (let n = 25; n < 35; n++) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    if (d.getDay() >= 1 && d.getDay() <= 4) {
      const s = new Date(d);
      s.setDate(s.getDate() + 1);
      return { chegada: iso(d), saida: iso(s) };
    }
  }
  throw new Error("sem noite útil");
}

async function entrar(page: Page, login: string, senha: string) {
  await page.goto("/");
  await page.getByLabel("Login").fill(login);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

/** O roteiro da recepção já trocou a senha do admin para admin123; rodando este arquivo sozinho a senha ainda é a inicial. */
async function entrarComoAdmin(page: Page) {
  await entrar(page, "admin", "admin123");
  const trocar = page.getByRole("heading", { name: "Trocar senha" });
  const saudacao = page.getByRole("heading", { name: /^(Bom dia|Boa tarde|Boa noite)/ });
  const erro = page.getByRole("alert");
  await expect(trocar.or(saudacao).or(erro)).toBeVisible();
  if (await erro.isVisible()) {
    await entrar(page, "admin", "admin");
    await page.getByLabel("Senha atual").fill("admin");
    await page.getByLabel("Nova senha", { exact: true }).fill("admin123");
    await page.getByLabel("Confirmar nova senha").fill("admin123");
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
  }
  await expect(saudacao).toBeVisible();
}

async function simular(page: Page, chegada: string, saida: string) {
  await page.getByLabel("Categoria").selectOption({ label: "Standard" });
  await page.getByLabel("Chegada").fill(chegada);
  await page.getByLabel("Saída").fill(saida);
  await page.getByRole("button", { name: "Simular" }).click();
}

test.describe.serial("tarifas: temporada, simulador e permissões", () => {
  test("alterar o percentual da temporada Alta muda o total do simulador", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    const { chegada, saida } = noiteDeAlta();
    await entrarComoAdmin(page);

    await page.getByRole("link", { name: "Tarifas" }).click();
    await expect(page).toHaveURL(/\/reservas\/tarifas\/tabela-base/);
    await page.getByRole("link", { name: "Simulador" }).click();
    await simular(page, chegada, saida);
    // Standard 2 adultos R$ 280,00, Alta +20%.
    await expect(page.getByText("Total: R$ 336,00")).toBeVisible();

    await page.getByRole("link", { name: "Temporadas" }).click();
    const linha = page.getByRole("row", { name: /Alta/ });
    await expect(linha).toBeVisible();
    await linha.getByRole("button", { name: "Editar" }).click();
    const painel = page.getByRole("dialog");
    await painel.getByLabel("Percentual (%)").fill("50");
    await painel.getByRole("button", { name: "Salvar" }).click();
    await expect(painel).toBeHidden();
    await expect(page.getByRole("row", { name: /Alta/ })).toContainText("50% sobre a base");

    await page.getByRole("link", { name: "Simulador" }).click();
    await simular(page, chegada, saida);
    await expect(page.getByText("Total: R$ 420,00")).toBeVisible();
    await expect(page.getByRole("region", { name: "Resultado da simulação" }).getByText(/Alta/)).toBeVisible();
    await page.context().close();
  });

  test("a recepção não vê Tarifas no menu, mas simula pelo botão da tela de reservas", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await entrar(page, "recepcao", "recepcao123");
    await expect(page.getByRole("link", { name: "Reservas" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tarifas" })).toHaveCount(0);
    await page.getByRole("link", { name: "Reservas" }).click();
    await page.getByRole("link", { name: "Simular" }).click();
    await expect(page).toHaveURL(/\/reservas\/tarifas\/simulador/);
    await expect(page.getByRole("navigation", { name: "Abas de tarifas" }).getByRole("link")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Simulador" })).toBeVisible();
    await page.context().close();
  });
});
