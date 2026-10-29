import { expect, type Page } from "@playwright/test";

export type EtapaChecklist = {
  /** Rótulo clicado em todo item da etapa, salvo os de `porItem`. */
  padrao: string;
  /** Rótulo por nome do item (o nome acessível do grupo). */
  porItem?: Record<string, string>;
  /** Passo extra depois de responder (ex.: abrir chamado, escolher o resultado). */
  depois?: () => Promise<void>;
};

/**
 * Percorre o checklist até a última etapa (a que mostra "Concluir"), respondendo cada item pelo nome.
 * Falha se aparecer uma etapa não prevista, se o título não mudar ao avançar ou se nunca chegar ao fim.
 */
export async function percorrerChecklist(page: Page, etapas: Record<string, EtapaChecklist>): Promise<void> {
  const titulo = page.locator("h2.checklist__titulo");
  for (let n = 0; n < 10; n++) {
    await expect(titulo).toBeVisible();
    const atual = (await titulo.innerText()).trim();
    const etapa = etapas[atual];
    if (!etapa) throw new Error(`Etapa inesperada no checklist: "${atual}" (previstas: ${Object.keys(etapas).join(", ")})`);

    if (etapa.padrao !== "") {
      const grupos = page.getByRole("group");
      await expect(grupos.first()).toBeVisible();
      const nomes: string[] = [];
      for (const g of await grupos.all()) nomes.push((await g.getAttribute("aria-label")) ?? "");
      for (const nome of nomes) {
        const rotulo = etapa.porItem?.[nome] ?? etapa.padrao;
        await page.getByRole("group", { name: nome, exact: true }).getByRole("button", { name: rotulo, exact: true }).click();
      }
    }
    await etapa.depois?.();

    if (await page.getByRole("button", { name: "Concluir", exact: true }).isVisible()) return;
    await page.getByRole("button", { name: "Próxima etapa" }).click();
    await expect(titulo).not.toHaveText(atual);
  }
  throw new Error("O checklist não chegou à etapa com o botão Concluir.");
}
