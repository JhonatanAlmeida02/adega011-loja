import { expect, test, type Page } from "@playwright/test";

// Sexta-feira, 20h em São Paulo (loja aberta no horário de exemplo).
const SEXTA_20H = new Date("2026-11-13T23:00:00Z");
// Segunda-feira, 10h em São Paulo (fechada; abre às 16h).
const SEGUNDA_10H = new Date("2026-11-16T13:00:00Z");

/** Intercepta o wa.me (em qualquer aba) e devolve a última URL aberta. */
async function capturarWhatsApp(page: Page) {
  const capturado = { url: "" };
  await page.context().route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (route) => {
    const url = route.request().url();
    if (url.startsWith("https://wa.me/")) capturado.url = url;
    return route.fulfill({ status: 200, contentType: "text/plain", body: "whatsapp" });
  });
  return capturado;
}

async function abrirLoja(page: Page, quando = SEXTA_20H) {
  await page.clock.setFixedTime(quando);
  await page.addInitScript(() => localStorage.setItem("adega011:maior-de-idade", "sim"));
  await page.goto("/");
}

test("verificação de idade aparece na primeira visita", async ({ page }) => {
  await page.goto("/");
  const dialogo = page.getByRole("dialog", { name: /18 anos ou mais/i });
  await expect(dialogo).toBeVisible();
  await page.getByRole("button", { name: "Sim, tenho 18+" }).click();
  await expect(dialogo).toBeHidden();
  await page.reload();
  await expect(page.getByRole("dialog", { name: /18 anos ou mais/i })).toBeHidden();
});

test("busca e esgotado", async ({ page }) => {
  await abrirLoja(page);
  await page.getByLabel("Buscar produto").fill("malbec");
  await expect(page.getByText("1 resultado")).toBeVisible();
  await page.getByLabel("Buscar produto").fill("espumante");
  await expect(page.getByRole("button", { name: "Esgotado" })).toBeDisabled();
});

test("fluxo completo: carrinho, taxa por região e link do WhatsApp", async ({ page, isMobile }) => {
  await abrirLoja(page);
  await expect(page.getByText("Aberto agora")).toBeVisible();

  const whatsapp = await capturarWhatsApp(page);

  // Adiciona 2x IPA (R$ 14,90) — abaixo do mínimo de R$ 30,00
  await page.getByRole("button", { name: "Adicionar IPA 473 ml" }).click();
  await page.getByRole("button", { name: "Aumentar quantidade de IPA 473 ml" }).click();
  await page.getByRole("button", { name: /Ver carrinho: 2 itens/ }).click();
  await expect(page.getByText("Faltam R$ 0,20")).toBeVisible();
  await expect(page.getByRole("button", { name: "Finalizar pedido" })).toBeDisabled();
  await page.getByRole("button", { name: "Fechar carrinho" }).click();

  // + 1 Malbec (R$ 69,90) => subtotal R$ 99,70
  await page.getByRole("button", { name: "Adicionar Tinto Malbec 750 ml" }).click();
  await page.getByRole("button", { name: /Ver carrinho: 3 itens, total R\$ 99,70/ }).click();
  await page.getByRole("button", { name: "Finalizar pedido" }).click();

  // Envia vazio => validação de campos obrigatórios
  await page.getByRole("button", { name: "Enviar pedido pelo WhatsApp" }).click();
  await expect(page.getByText("Informe seu nome.")).toBeVisible();
  await expect(page.getByText("Informe um telefone com DDD.")).toBeVisible();
  await expect(page.getByText("Escolha a região de entrega.")).toBeVisible();
  await expect(page.getByText("Escolha a forma de pagamento.")).toBeVisible();

  await page.getByLabel("Nome").fill("Ana Teste");
  await page.getByLabel("WhatsApp / telefone").fill("11912345678");
  await expect(page.getByLabel("WhatsApp / telefone")).toHaveValue("(11) 91234-5678");

  // Região B => taxa R$ 8,00 => total R$ 107,70
  await page.getByLabel("Região / bairro").selectOption({ label: "Região B · 3 a 6 km — R$ 8,00" });
  await expect(page.getByTestId("total")).toHaveText("R$ 107,70");
  // Troca para Região C => R$ 12,00 => R$ 111,70
  await page.getByLabel("Região / bairro").selectOption({ label: "Região C · 6 a 10 km — R$ 12,00" });
  await expect(page.getByTestId("total")).toHaveText("R$ 111,70");

  await page.getByLabel("Endereço (rua e número)").fill("Rua Harmonia, 123");
  await page.getByLabel("Complemento / referência (opcional)").fill("apto 4");
  await page.getByRole("dialog").getByRole("radio", { name: "Dinheiro" }).check({ force: true });
  await page.getByLabel("Troco para quanto?").fill("100");
  await page.getByRole("button", { name: "Enviar pedido pelo WhatsApp" }).click();
  await expect(page.getByText("O troco precisa ser para R$ 111,70 ou mais.")).toBeVisible();
  await page.getByLabel("Troco para quanto?").fill("150,00");
  await page.getByLabel("Observações (opcional)").fill("Bem gelada!");

  await page.getByRole("button", { name: "Enviar pedido pelo WhatsApp" }).click();
  await expect.poll(() => whatsapp.url, { timeout: 10_000 }).toContain("https://wa.me/5511941522867?text=");

  const texto = new URL(whatsapp.url).searchParams.get("text") ?? "";
  expect(texto).toContain("2x IPA 473 ml — R$ 29,80");
  expect(texto).toContain("1x Tinto Malbec 750 ml — R$ 69,90");
  expect(texto).toContain("Subtotal: R$ 99,70");
  expect(texto).toContain("Taxa de entrega (Região C · 6 a 10 km): R$ 12,00");
  expect(texto).toContain("*Total: R$ 111,70*");
  expect(texto).toContain("Nome: Ana Teste");
  expect(texto).toContain("Telefone: (11) 91234-5678");
  expect(texto).toContain("Endereço: Rua Harmonia, 123 — apto 4");
  expect(texto).toContain("Dinheiro — troco para R$ 150,00 (levar R$ 38,30)");
  expect(texto).toContain("Bem gelada!");

  if (!isMobile) {
    // No computador o WhatsApp abre em outra aba e a loja mostra a confirmação.
    await expect(page.getByText("Pedido pronto!")).toBeVisible();
    await page.getByRole("button", { name: "Fazer outro pedido" }).click();
  } else {
    // No celular a própria aba vai para o wa.me (abre o app); voltamos para a loja.
    await page.goto("/");
  }
  // Carrinho foi esvaziado
  await expect(page.getByRole("button", { name: /Ver carrinho/ })).toBeHidden();
});

test("retirada na loja não cobra taxa e lembra os dados do cliente", async ({ page }) => {
  await abrirLoja(page);
  const whatsapp = await capturarWhatsApp(page);

  await page.getByRole("button", { name: "Adicionar Gin London Dry 750 ml" }).click();
  await page.getByRole("button", { name: /Ver carrinho/ }).click();
  await page.getByRole("button", { name: "Finalizar pedido" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "Retirada" }).check({ force: true });
  await expect(page.getByTestId("total")).toHaveText("R$ 119,90");
  await page.getByLabel("Nome").fill("Bruno");
  await page.getByLabel("WhatsApp / telefone").fill("11987654321");
  await page.getByRole("dialog").getByRole("radio", { name: "Pix" }).check({ force: true });
  await page.getByRole("button", { name: "Enviar pedido pelo WhatsApp" }).click();
  await expect.poll(() => whatsapp.url).toContain("wa.me");
  const texto = new URL(whatsapp.url).searchParams.get("text") ?? "";
  expect(texto).toContain("*Retirada na loja*");
  expect(texto).toContain("*Total: R$ 119,90*");
  expect(texto).not.toContain("Taxa de entrega");
  expect(texto).toContain("*Pagamento*\nPix");
  await page.goto("/");

  // Novo pedido: nome e telefone já preenchidos
  await page.getByRole("button", { name: "Adicionar Gin London Dry 750 ml" }).click();
  await page.getByRole("button", { name: /Ver carrinho/ }).click();
  await page.getByRole("button", { name: "Finalizar pedido" }).click();
  await expect(page.getByLabel("Nome")).toHaveValue("Bruno");
});

test("loja fechada bloqueia o envio e mostra quando abre", async ({ page }) => {
  await abrirLoja(page, SEGUNDA_10H);
  await expect(page.getByText("Fechado agora")).toBeVisible();
  await expect(page.getByText("Abre hoje às 14h").first()).toBeVisible();
  await page.getByRole("button", { name: "Adicionar Gin London Dry 750 ml" }).click();
  await page.getByRole("button", { name: /Ver carrinho/ }).click();
  await page.getByRole("button", { name: "Finalizar pedido" }).click();
  await expect(page.getByRole("button", { name: "Loja fechada" })).toBeDisabled();
});

test("adicionais: Copão de Askov com Baly entra no carrinho e na mensagem", async ({ page }) => {
  await abrirLoja(page);
  const whatsapp = await capturarWhatsApp(page);

  await page.getByRole("button", { name: "Escolher Copão de Askov" }).click();
  const detalhe = page.getByRole("dialog", { name: "Copão de Askov" });
  await expect(detalhe.getByRole("button", { name: /Adicionar · R\$ 10,00/ })).toBeVisible();
  const opcao = (nome: string) => detalhe.locator("label").filter({ hasText: nome });
  await opcao("Baly").click();
  // Rádio opcional: escolher outro troca a opção
  await opcao("Red Bull").click();
  await expect(detalhe.getByRole("radio", { name: /Baly/ })).not.toBeChecked();
  await opcao("Baly").click();
  await detalhe.getByRole("button", { name: "Aumentar quantidade de Copão de Askov" }).click();
  await detalhe.getByRole("button", { name: /Adicionar · R\$ 26,00/ }).click();

  // Sem adicional também (linha separada no carrinho)
  await page.getByRole("button", { name: "Escolher Copão de Askov" }).click();
  await page.getByRole("dialog", { name: "Copão de Askov" }).getByRole("button", { name: /Adicionar · R\$ 10,00/ }).click();

  await page.getByRole("button", { name: /Ver carrinho: 3 itens, total R\$ 36,00/ }).click();
  const carrinho = page.getByRole("dialog");
  await expect(carrinho.getByText("+ Baly")).toBeVisible();
  await carrinho.getByRole("button", { name: "Finalizar pedido" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "Retirada" }).check({ force: true });
  await page.getByLabel("Nome").fill("Duda");
  await page.getByLabel("WhatsApp / telefone").fill("11912340000");
  await page.getByRole("dialog").getByRole("radio", { name: "Pix" }).check({ force: true });
  await page.getByRole("button", { name: "Enviar pedido pelo WhatsApp" }).click();

  await expect.poll(() => whatsapp.url).toContain("wa.me");
  const texto = new URL(whatsapp.url).searchParams.get("text") ?? "";
  expect(texto).toContain("2x Copão de Askov (+ Baly) — R$ 26,00");
  expect(texto).toContain("1x Copão de Askov — R$ 10,00");
  expect(texto).toContain("*Total: R$ 36,00*");
});
