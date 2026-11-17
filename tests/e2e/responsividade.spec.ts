import { expect, test, type Page } from "@playwright/test";

// Sexta-feira, 20h em São Paulo (loja aberta no horário de exemplo).
const SEXTA_20H = new Date("2026-11-13T23:00:00Z");

// Do celular mais estreito em uso (320 px) até monitor Full HD.
const LARGURAS = [320, 360, 375, 414, 768, 1024, 1280, 1920];

// As larguras são simuladas no projeto "desktop"; o projeto "celular" já cobre o Pixel 7.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "larguras simuladas só no projeto desktop");
});

/** Elementos que passam da borda direita da tela (causam rolagem horizontal). */
async function vazamentos(page: Page) {
  return page.evaluate(() => {
    const largura = document.documentElement.clientWidth;
    const rolagem = document.documentElement.scrollWidth - largura;
    const culpados: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= largura + 1) continue;
      // Ignora o que está dentro de uma área com rolagem própria (ex.: barra de categorias).
      let pai = el.parentElement;
      let rolavel = false;
      while (pai && pai !== document.body) {
        const ox = getComputedStyle(pai).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") {
          rolavel = true;
          break;
        }
        pai = pai.parentElement;
      }
      if (rolavel) continue;
      const nome = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String(el.className).split(" ").slice(0, 2).join(".")}`;
      culpados.push(`${nome} (direita em ${Math.round(r.right)}px)`);
    }
    return { rolagem, culpados: culpados.slice(0, 5) };
  });
}

async function semRolagemHorizontal(page: Page, tela: string) {
  const { rolagem, culpados } = await vazamentos(page);
  expect(rolagem, `${tela}: a página rola ${rolagem}px para o lado. Culpados: ${culpados.join("; ")}`).toBeLessThanOrEqual(1);
}

for (const largura of LARGURAS) {
  test(`sem rolagem horizontal em ${largura}px: vitrine, carrinho e checkout`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 800 });
    await page.clock.setFixedTime(SEXTA_20H);
    await page.addInitScript(() => localStorage.setItem("adega011:maior-de-idade", "sim"));
    await page.goto("/");
    await expect(page.getByText("Aberto agora")).toBeVisible();
    await semRolagemHorizontal(page, "vitrine");

    await page.getByRole("button", { name: "Adicionar Tinto Malbec 750 ml" }).click();
    await page.getByRole("button", { name: /Ver carrinho/ }).click();
    await expect(page.getByRole("button", { name: "Finalizar pedido" })).toBeVisible();
    await semRolagemHorizontal(page, "carrinho");

    await page.getByRole("button", { name: "Finalizar pedido" }).click();
    await expect(page.getByLabel("Nome")).toBeVisible();
    await semRolagemHorizontal(page, "checkout");
    // O botão de envio precisa caber inteiro na largura da tela.
    const enviar = await page.getByRole("button", { name: /Enviar pedido/ }).boundingBox();
    expect(enviar && enviar.x >= 0 && enviar.x + enviar.width <= largura + 1, "botão de envio cortado").toBeTruthy();
  });

  test(`sem rolagem horizontal em ${largura}px: verificação de idade e login do painel`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("dialog")).toBeVisible();
    await semRolagemHorizontal(page, "verificação de idade");

    await page.goto("/admin/login");
    await semRolagemHorizontal(page, "login do painel");
  });
}

test("alvos de toque da vitrine têm pelo menos 24×24 px no celular (WCAG 2.5.8)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.clock.setFixedTime(SEXTA_20H);
  await page.addInitScript(() => localStorage.setItem("adega011:maior-de-idade", "sim"));
  await page.goto("/");
  await expect(page.getByText("Aberto agora")).toBeVisible();
  const pequenos = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button, a[href], input, select, [role=button]"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        // Ignora o que está escondido, inclusive o "pular para o cardápio" (sr-only até receber foco).
        const visivel = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.matches(".sr-only");
        // Links dentro de texto corrido são exceção na regra.
        const emTexto = el.tagName === "A" && getComputedStyle(el).display === "inline";
        return visivel && !emTexto && (r.width < 24 || r.height < 24);
      })
      .map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`),
  );
  expect(pequenos, `alvos menores que 24px: ${pequenos.join("; ")}`).toEqual([]);
});
