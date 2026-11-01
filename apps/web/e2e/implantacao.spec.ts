import { expect, test, type Page } from "@playwright/test";

// Base vazia (porta 8098, criada por preparar.ts): só migrações e o administrador inicial.
test.use({ baseURL: "http://localhost:8098" });

async function entrar(page: Page, login: string, senha: string) {
  await page.goto("/");
  await page.getByLabel("Login").fill(login);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function trocarSenha(page: Page, atual: string, nova: string) {
  await expect(page.getByRole("heading", { name: "Trocar senha" })).toBeVisible();
  await page.getByLabel("Senha atual").fill(atual);
  await page.getByLabel("Nova senha", { exact: true }).fill(nova);
  await page.getByLabel("Confirmar nova senha").fill(nova);
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
}

test.describe.serial("implantação de uma pousada nova pelo assistente", () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext({ baseURL: "http://localhost:8098", locale: "pt-BR" })).newPage();
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("1. admin troca a senha e cai no assistente", async () => {
    await entrar(page, "admin", "admin");
    await trocarSenha(page, "admin", "admin123");
    await expect(page).toHaveURL(/\/configuracoes\/assistente/);
    await expect(page.getByRole("heading", { name: "Primeira configuração" })).toBeVisible();
  });

  test("2. passo Pousada: razão social salva libera o Avançar", async () => {
    await expect(page.getByRole("button", { name: "Avançar" })).toBeDisabled();
    const dados = page.getByRole("region", { name: "Dados" });
    await dados.getByLabel("Razão social").fill("Pousada Teste");
    await dados.getByRole("button", { name: "Salvar" }).click();
    await expect(dados.getByText("Salvo.")).toBeVisible();
    await page.getByRole("button", { name: "Avançar" }).click();
  });

  test("3. passo Quartos: categoria Standard com quartos 1 a 3", async () => {
    await page.getByLabel("Nome da categoria").fill("Standard");
    await page.getByLabel("Máximo de adultos").fill("2");
    await page.getByLabel("Diária para 1 adulto").fill("200,00");
    await page.getByLabel("Diária para 2 adultos").fill("250,00");
    await page.getByLabel("Diária para 3 adultos").fill("300,00");
    await page.getByLabel("Adulto extra").fill("50,00");
    await page.getByLabel("Quarto inicial").fill("1");
    await page.getByLabel("Quarto final").fill("3");
    await page.getByRole("button", { name: "Criar categorias e quartos" }).click();
    await expect(page.getByRole("heading", { name: "Equipe" })).toBeVisible();
  });

  test("4. passo Equipe: Rita na recepção, depois o resumo", async () => {
    await page.getByLabel("Nome", { exact: true }).fill("Rita");
    await page.getByLabel("Login").fill("rita");
    await page.getByLabel("Perfil").selectOption({ label: "Recepção" });
    await page.getByLabel("Senha inicial").fill("rita1234");
    await page.getByRole("button", { name: "Salvar e avançar" }).click();
    await expect(page.getByRole("heading", { name: "Pronto" })).toBeVisible();
    await expect(page.getByText(/1 categoria · 3 quartos/)).toBeVisible();
  });

  test("5. mapa mostra os quartos 1, 2 e 3 e uma reserva para hoje no quarto 2", async () => {
    await page.getByRole("button", { name: "Ir para o mapa" }).click();
    await expect(page).toHaveURL(/\/mapa/);
    for (const n of [1, 2, 3]) {
      await expect(page.getByRole("button", { name: new RegExp(`^Nova reserva no quarto ${n} em`) }).first()).toBeVisible();
    }

    await page.getByRole("button", { name: "+ Nova reserva" }).click();
    await page.getByLabel("Buscar hóspede").fill("Maria Souza");
    await page.getByRole("button", { name: "Cadastrar novo" }).click();
    const janela = page.getByRole("dialog", { name: "Cadastrar hóspede" });
    await janela.getByLabel("Documento", { exact: true }).fill("52998224725");
    await janela.getByLabel("Data de nascimento").fill("1990-05-10");
    await janela.getByRole("button", { name: "Salvar hóspede" }).click();
    await expect(page.getByText("Titular: Maria Souza")).toBeVisible();

    await page.getByLabel("Categoria", { exact: true }).selectOption({ label: "Standard" });
    await page.getByLabel("Quarto", { exact: true }).selectOption({ label: "2" });
    await expect(page.getByRole("region", { name: "Cotação" }).getByText("Total")).toBeVisible();
    await page.getByRole("button", { name: "Reservar", exact: true }).click();

    await expect(page).toHaveURL(/\/mapa\?reserva=/);
    await expect(page.getByRole("dialog", { name: /^#/ })).toContainText("Maria Souza");
  });

  test("6. Rita entra, troca a senha e chega à tela Hoje", async () => {
    await page.getByRole("button", { name: "Sair" }).click();
    await entrar(page, "rita", "rita1234");
    await trocarSenha(page, "rita1234", "rita12345");
    await expect(page.getByRole("heading", { name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
    await expect(page).not.toHaveURL(/\/configuracoes/);
  });
});
