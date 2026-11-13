import { expect, test, type Page } from "@playwright/test";

// Sexta-feira, 20h em São Paulo (loja aberta no horário de exemplo).
const SEXTA_20H = new Date("2026-11-13T23:00:00Z");

async function abrirLoja(page: Page) {
  await page.clock.setFixedTime(SEXTA_20H);
  await page.addInitScript(() => localStorage.setItem("adega011:maior-de-idade", "sim"));
  await page.goto("/");
}

test("rolar a página não puxa a tela de volta para a categoria", async ({ page }) => {
  // Conta quem mexe na rolagem da página por código enquanto a pessoa rola
  await page.addInitScript(() => {
    const w = window as unknown as { __rolagensPorCodigo: number };
    w.__rolagensPorCodigo = 0;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      w.__rolagensPorCodigo++;
      return original.apply(this, args as []);
    };
  });
  await abrirLoja(page);
  const barra = page.getByRole("navigation", { name: "Categorias" });
  await expect(barra.getByRole("button", { name: "Combos" })).toHaveAttribute("aria-current", "true");

  // Desce a página aos poucos até a última categoria
  const posicoes: number[] = [];
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let i = 0; i < 60 && posicoes.at(-1) !== total; i++) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(60);
    posicoes.push(await page.evaluate(() => Math.round(window.scrollY)));
    if (await barra.getByRole("button", { name: "Cervejas" }).getAttribute("aria-current")) break;
  }
  await expect(barra.getByRole("button", { name: "Cervejas" })).toHaveAttribute("aria-current", "true");
  // A página só desceu (nunca voltou) e nada rolou a página por código
  expect(posicoes.every((y, i) => i === 0 || y >= posicoes[i - 1])).toBe(true);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThanOrEqual(posicoes.at(-1)!);
  expect(await page.evaluate(() => (window as unknown as { __rolagensPorCodigo: number }).__rolagensPorCodigo)).toBe(0);
  // O chip ativo continua visível na barra (que rola de lado)
  await expect(barra.getByRole("button", { name: "Cervejas" })).toBeInViewport();
});

test("subcategorias: Destilados mostra Gin, Vodka e Whisky com atalhos", async ({ page }) => {
  await abrirLoja(page);
  // Na barra fixa só as categorias principais
  const barra = page.getByRole("navigation", { name: "Categorias" });
  await expect(barra.getByRole("button")).toHaveText(["Combos", "Vinhos", "Destilados", "Cervejas"]);

  await barra.getByRole("button", { name: "Destilados" }).click();
  const secao = page.getByRole("region", { name: "Destilados" });
  const atalhos = secao.getByRole("navigation", { name: "Tipos de Destilados" });
  await expect(atalhos.getByRole("button")).toHaveText([/Gin\s*1/, /Vodka\s*1/, /Whisky\s*1/]);
  // Subtítulo de cada subcategoria, com a quantidade de itens
  await expect(secao.locator('[id^="sub-"] > h3')).toHaveText([/^Gin\s*1 item$/, /^Vodka\s*1 item$/, /^Whisky\s*1 item$/]);

  await atalhos.getByRole("button", { name: /Whisky/ }).click();
  await expect(secao.locator("#sub-whisky > h3")).toBeInViewport();
  await expect(page.getByRole("article", { name: "Whisky 12 anos 1 L" })).toBeInViewport();

  // O detalhe do produto mostra a categoria completa
  await page.getByRole("article", { name: "Vodka Premium 1 L" }).getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toContainText("Destilados › Vodka");
});
