import { expect, test, type Locator, type Page } from "@playwright/test";

async function entrar(page: Page, login: string, senha: string) {
  await page.goto("/");
  await page.getByLabel("Login").fill(login);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

const gaveta = (page: Page) => page.getByRole("dialog", { name: /^#/ });
const cartao = (page: Page, numero: string): Locator => page.locator("li.governanca__item", { has: page.getByText(numero, { exact: true }) });

/** Responde a etapa aberta do checklist: um rótulo (ou uma lista, por posição) para cada item. */
async function responderEtapa(page: Page, respostas: string | string[], excecoes: Record<string, string> = {}) {
  const grupos = await page.getByRole("group").all();
  for (const [i, grupo] of grupos.entries()) {
    const nome = (await grupo.getAttribute("aria-label")) ?? "";
    const rotulo = excecoes[nome] ?? (Array.isArray(respostas) ? (respostas[i] ?? "0") : respostas);
    await grupo.getByRole("button", { name: rotulo, exact: true }).click();
  }
}

const tituloDaEtapa = async (page: Page) => (await page.locator("h2.checklist__titulo").innerText()).trim();
const proxima = (page: Page) => page.getByRole("button", { name: "Próxima etapa" }).click();

/** Percorre as etapas até "Resultado" (ou até o fim, na arrumação). */
async function percorrer(page: Page, porEtapa: Record<string, () => Promise<void>>) {
  for (let n = 0; n < 8; n++) {
    const titulo = await tituloDaEtapa(page);
    await porEtapa[titulo]!();
    if (titulo === "Resultado" || titulo === "Consumo do hóspede") return;
    await proxima(page);
  }
}

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

  test("1. camareira arruma o 201 e lança 1 água no frigobar", async () => {
    await entrar(celular, "governanca", "governanca123");
    await expect(celular.getByRole("heading", { name: "Governança" })).toBeVisible();
    await celular.getByRole("button", { name: /^201 ocupado/ }).click();

    await percorrer(celular, {
      Limpeza: () => responderEtapa(celular, "Sim"),
      "Enxoval recolhido": () => responderEtapa(celular, ["1", "1", "0", "0"]),
      Equipamentos: () => responderEtapa(celular, "Funciona"),
      Controles: () => responderEtapa(celular, "Presente"),
      "Consumo do hóspede": () => responderEtapa(celular, "0", { "Água mineral": "1" }),
    });
    await celular.getByRole("button", { name: "Concluir", exact: true }).click();

    await expect(celular.getByRole("status")).toContainText("Checklist concluído · Qto 201");
    await expect(cartao(celular, "201")).toContainText("Arrumado às");
  });

  test("2. recepção vê a água na conta, com setor Frigobar e R$ 6,00", async () => {
    await entrar(recepcao, "recepcao", "recepcao123");
    await recepcao.getByRole("link", { name: "Mapa" }).click();
    await recepcao.getByRole("button", { name: /^Ana Beatriz Costa · / }).first().click();
    await gaveta(recepcao).getByRole("tab", { name: "Conta" }).click();
    const linha = gaveta(recepcao).getByRole("row", { name: /Água mineral/ });
    await expect(linha).toContainText("Frigobar");
    await expect(linha).toContainText("R$ 6,00");
    await gaveta(recepcao).getByRole("button", { name: "Fechar" }).click();
  });

  test("3. camareira faz a saída do 103: ar-condicionado com defeito e quarto bloqueado", async () => {
    await celular.getByRole("button", { name: /^103 sujo/ }).click();

    await percorrer(celular, {
      Limpeza: () => responderEtapa(celular, "Sim"),
      "Enxoval recolhido": () => responderEtapa(celular, ["1", "1", "0", "0"]),
      Equipamentos: async () => {
        await responderEtapa(celular, "Funciona", { "Ar-condicionado": "Não funciona" });
        await celular.getByRole("button", { name: "Abrir chamado" }).click();
        await expect(celular.getByText("Chamado aberto", { exact: true })).toBeVisible();
      },
      Controles: () => responderEtapa(celular, "Presente"),
      "Reposição do frigobar": () => responderEtapa(celular, "0"),
      Resultado: async () => {
        await expect(celular.getByRole("button", { name: "Liberado", exact: true })).toBeDisabled();
        await celular.getByRole("button", { name: "Bloqueado", exact: true }).click();
        await expect(celular.getByLabel("Motivo")).toHaveValue("Ar-condicionado não funciona");
      },
    });
    await celular.getByRole("button", { name: "Concluir", exact: true }).click();

    await expect(celular.getByRole("status")).toContainText("Checklist concluído · Qto 103");
    await expect(cartao(celular, "103")).toContainText("Bloqueado: Ar-condicionado não funciona");
  });

  test("4. recepção resolve o chamado, libera o quarto e o mapa mostra o 103 livre", async () => {
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
    const linha = recepcao.locator(".mapa-linha", { has: recepcao.locator(".mapa-rotulo strong", { hasText: /^103$/ }) });
    await expect(linha).toBeVisible();
    await expect(linha.locator(".mapa-situacao")).toHaveCount(0);
  });
});
