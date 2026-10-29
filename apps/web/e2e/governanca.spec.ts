import { expect, test, type Locator, type Page } from "@playwright/test";
import { percorrerChecklist } from "./checklist";

async function entrar(page: Page, login: string, senha: string) {
  await page.goto("/");
  await page.getByLabel("Login").fill(login);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

const gaveta = (page: Page) => page.getByRole("dialog", { name: /^#/ });
const cartao = (page: Page, numero: string): Locator => page.locator("li.governanca__item", { has: page.getByText(numero, { exact: true }) });
const linhaDoMapa = (page: Page, numero: string): Locator =>
  page.locator(".mapa-linha", { has: page.locator(".mapa-rotulo strong", { hasText: new RegExp(`^${numero}$`) }) });

test.describe.serial("governança: checklist, frigobar e chamado de ponta a ponta", () => {
  let celular: Page;
  let recepcao: Page;
  test.beforeAll(async ({ browser }) => {
    celular = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
    recepcao = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  });
  test.afterAll(async () => {
    await celular.context().close();
    await recepcao.context().close();
  });

  /** Abre a reserva hospedada no quarto pelo mapa, na aba Conta; devolve as linhas de "Água mineral" do setor Frigobar. */
  async function abrirContaDe(numero: string): Promise<Locator> {
    await recepcao.getByRole("link", { name: "Mapa" }).click();
    await linhaDoMapa(recepcao, numero).getByRole("button", { name: /^Ana Beatriz Costa · / }).click();
    await gaveta(recepcao).getByRole("tab", { name: "Conta" }).click();
    await expect(gaveta(recepcao).getByRole("table", { name: "Extrato da conta" })).toBeVisible();
    return gaveta(recepcao).getByRole("row", { name: /Água mineral/ }).filter({ hasText: "Frigobar" });
  }
  let aguasAntes = 0;

  test("1. recepção anota quantas águas a conta do 201 já tem", async () => {
    await entrar(recepcao, "recepcao", "recepcao123");
    aguasAntes = await (await abrirContaDe("201")).count();
    await gaveta(recepcao).getByRole("button", { name: "Fechar" }).click();
  });

  test("2. camareira arruma o 201 e lança 1 água no frigobar", async () => {
    await entrar(celular, "governanca", "governanca123");
    await expect(celular.getByRole("heading", { name: "Governança" })).toBeVisible();
    await celular.getByRole("button", { name: /^201 ocupado/ }).click();

    await percorrerChecklist(celular, {
      Limpeza: { padrao: "Sim" },
      "Enxoval recolhido": { padrao: "0", porItem: { Toalhas: "1", Pisos: "1" } },
      Equipamentos: { padrao: "Funciona" },
      Controles: { padrao: "Presente" },
      "Consumo do hóspede": { padrao: "0", porItem: { "Água mineral": "1" } },
    });
    await celular.getByRole("button", { name: "Concluir", exact: true }).click();

    await expect(celular.getByRole("status")).toContainText("Checklist concluído · Qto 201");
    await expect(cartao(celular, "201")).toContainText("Arrumado às");
  });

  test("3. a conta do 201 ganha uma linha de água, setor Frigobar, R$ 6,00", async () => {
    const aguas = await abrirContaDe("201");
    await expect(aguas).toHaveCount(aguasAntes + 1);
    await expect(aguas.filter({ hasText: "R$ 6,00" })).toHaveCount(aguasAntes + 1);
    await gaveta(recepcao).getByRole("button", { name: "Fechar" }).click();
  });

  test("4. camareira faz a saída do 103: ar-condicionado com defeito e quarto bloqueado", async () => {
    await celular.getByRole("button", { name: /^103 sujo/ }).click();

    await percorrerChecklist(celular, {
      Limpeza: { padrao: "Sim" },
      "Enxoval recolhido": { padrao: "0", porItem: { Toalhas: "1", Pisos: "1" } },
      Equipamentos: {
        padrao: "Funciona",
        porItem: { "Ar-condicionado": "Não funciona" },
        depois: async () => {
          await celular.getByRole("button", { name: "Abrir chamado" }).click();
          await expect(celular.getByText("Chamado aberto", { exact: true })).toBeVisible();
        },
      },
      Controles: { padrao: "Presente" },
      "Reposição do frigobar": { padrao: "0" },
      Resultado: {
        padrao: "",
        depois: async () => {
          await expect(celular.getByRole("button", { name: "Liberado", exact: true })).toBeDisabled();
          await celular.getByRole("button", { name: "Bloqueado", exact: true }).click();
          await expect(celular.getByLabel("Motivo")).toHaveValue("Ar-condicionado não funciona");
        },
      },
    });
    await celular.getByRole("button", { name: "Concluir", exact: true }).click();

    await expect(celular.getByRole("status")).toContainText("Checklist concluído · Qto 103");
    await expect(cartao(celular, "103")).toContainText("Bloqueado: Ar-condicionado não funciona");
  });

  test("5. recepção resolve o chamado, libera o quarto e o 103 fica livre", async () => {
    await recepcao.getByRole("link", { name: "Hoje" }).click();
    const bloco = recepcao.getByRole("region", { name: /Chamados abertos/ });
    const item = bloco.locator("li.hoje-atencao__item", { hasText: "Qto 103" });
    await expect(item).toContainText("Defeito");
    await expect(item).toContainText("Ar-condicionado");
    await item.getByRole("button", { name: "Resolvido" }).click();
    await recepcao.getByRole("dialog", { name: /^Resolver chamado/ }).getByRole("button", { name: "Confirmar" }).click();

    await item.getByRole("button", { name: "Liberar quarto" }).click();
    await recepcao.getByRole("dialog", { name: /^Liberar quarto/ }).getByRole("button", { name: "Confirmar" }).click();
    await expect(bloco.locator("li.hoje-atencao__item", { hasText: "Qto 103" })).toHaveCount(0);

    await recepcao.getByRole("link", { name: "Mapa" }).click();
    await expect(linhaDoMapa(recepcao, "103")).toBeVisible();
    await expect(linhaDoMapa(recepcao, "103").locator(".mapa-situacao")).toHaveCount(0);

    // Positivo: na Governança o cartão do 103 agora diz "livre", sem bloqueio.
    await celular.reload();
    await expect(cartao(celular, "103")).toContainText("livre");
    await expect(cartao(celular, "103")).not.toContainText("Bloqueado");
  });
});
