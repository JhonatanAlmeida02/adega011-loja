import { expect, test, type Page } from "@playwright/test";

// A falha de rede simulada deve passar pelas rotas do teste, sem o cache do PWA.
test.use({ serviceWorkers: "block" });

async function abrirLoja(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-13T23:00:00Z"));
  await page.addInitScript(() => localStorage.setItem("adega011:maior-de-idade", "sim"));
  await page.goto("/");
}

test("OK permanece visível e fecha os detalhes sem alterar o carrinho", async ({ page }) => {
  await abrirLoja(page);
  await page.getByRole("button", { name: "Ver detalhes de IPA 473 ml" }).click();
  const detalhe = page.getByRole("dialog", { name: "IPA 473 ml" });
  const ok = detalhe.getByRole("button", { name: "OK, voltar à loja" });
  await expect(ok).toBeInViewport();
  await detalhe.getByRole("button", { name: /Adicionar/ }).click();
  await expect(ok).toBeInViewport();
  await ok.click();
  await expect(detalhe).toBeHidden();
  await expect(page.getByRole("button", { name: "Aumentar quantidade de IPA 473 ml" })).toBeVisible();
});

test("OK fecha seleção de adicionais e também produto esgotado", async ({ page }) => {
  await abrirLoja(page);
  await page.getByRole("button", { name: "Escolher Copão de Askov" }).click();
  const detalhe = page.getByRole("dialog", { name: "Copão de Askov" });
  await detalhe.locator("summary").filter({ hasText: "Energético" }).click();
  await detalhe.locator(".overflow-y-auto").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(detalhe.getByRole("button", { name: "OK, voltar à loja" })).toBeInViewport();
  await detalhe.getByRole("button", { name: "OK, voltar à loja" }).click();
  await expect(detalhe).toBeHidden();
  await page.getByLabel("Buscar produto").fill("espumante");
  await page.getByRole("button", { name: /Ver detalhes de Espumante/ }).click();
  const esgotado = page.getByRole("dialog");
  await expect(esgotado.getByRole("button", { name: "Esgotado no momento" })).toBeDisabled();
  await esgotado.getByRole("button", { name: "OK, voltar à loja" }).click();
  await expect(esgotado).toBeHidden();
});

test("foto ausente mostra o selo e mantém o produto acessível", async ({ page }) => {
  await page.route("**/produtos/cerveja-lata.svg", (route) => route.abort());
  await abrirLoja(page);
  await page.getByLabel("Buscar produto").fill("IPA");
  const foto = page.getByRole("button", { name: "Ver detalhes de IPA 473 ml" });
  await foto.scrollIntoViewIfNeeded();
  await expect(foto.locator('img[src*="logo-selo-simples"]')).toHaveCount(2);
  await expect(foto.locator('img[alt="IPA 473 ml"]')).toHaveCount(0);
  await foto.click();
  await expect(page.getByRole("dialog", { name: "IPA 473 ml" })).toBeVisible();
});
