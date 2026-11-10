import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SEXTA_20H = new Date("2026-11-13T23:00:00Z");

async function auditar(page: Page, contexto: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const resumo = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(resumo, `Violações de acessibilidade em: ${contexto}`).toEqual([]);
}

test("acessibilidade: verificação de idade, vitrine, carrinho e checkout", async ({ page }) => {
  await page.clock.setFixedTime(SEXTA_20H);
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: /18 anos/ })).toBeVisible();
  await auditar(page, "verificação de idade");
  await page.getByRole("button", { name: "Sim, tenho 18+" }).click();
  await page.waitForTimeout(1800); // animação do banner
  await auditar(page, "vitrine");

  await page.getByRole("button", { name: "Ver detalhes de Gin London Dry 750 ml" }).click();
  await page.waitForTimeout(400);
  await auditar(page, "detalhe do produto");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Adicionar Gin London Dry 750 ml" }).click();
  await page.getByRole("button", { name: /Ver carrinho/ }).click();
  await page.waitForTimeout(400);
  await auditar(page, "carrinho");
  await page.getByRole("button", { name: "Finalizar pedido" }).click();
  await page.getByRole("button", { name: "Enviar pedido pelo WhatsApp" }).click();
  await page.waitForTimeout(400);
  await auditar(page, "checkout com erros");
});

test("acessibilidade: login do painel", async ({ page }) => {
  await page.goto("/admin/login");
  await auditar(page, "login");
});
