import { expect, test, type Page } from "@playwright/test";

const EMAIL = process.env.ADMIN_EMAIL ?? "dono@adega011.test";
const SENHA = process.env.ADMIN_SENHA ?? "SenhaForte123";
const SEXTA_20H = new Date("2026-11-13T23:00:00Z");

test.describe.configure({ mode: "serial" });

async function entrar(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();
}

async function abrirLoja(page: Page) {
  await page.clock.setFixedTime(SEXTA_20H);
  await page.addInitScript(() => localStorage.setItem("adega011:maior-de-idade", "sim"));
  await page.goto("/");
}

test("rota /admin exige login e recusa senha errada", async ({ page }) => {
  await page.goto("/admin/produtos");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill("errada123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
});

test("pedido da loja é registrado e aparece no painel em tempo real", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await entrar(admin);

  const loja = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } })).newPage();
  let url = "";
  await loja.context().route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (r) => {
    if (r.request().url().startsWith("https://wa.me/")) url = r.request().url();
    return r.fulfill({ status: 200, body: "ok" });
  });
  await abrirLoja(loja);

  await loja.getByRole("button", { name: "Adicionar Whisky 12 anos 1 L" }).click();
  await loja.getByRole("button", { name: /Ver carrinho/ }).click();
  await loja.getByRole("button", { name: "Finalizar pedido" }).click();
  await loja.getByLabel("Nome").fill("Cliente Realtime");
  // Telefone aleatório: o banco limita 5 pedidos por telefone a cada 10 min.
  await loja.getByLabel("WhatsApp / telefone").fill(`119${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`);
  await loja.getByLabel("Região / bairro").selectOption({ label: "Região A · até 3 km — R$ 5,00" });
  await loja.getByLabel("Endereço (rua e número)").fill("Rua Aspicuelta, 99");
  await loja.getByRole("dialog").getByRole("radio", { name: "Cartão na entrega" }).check({ force: true });
  await loja.getByRole("button", { name: "Enviar pedido pelo WhatsApp" }).click();

  await expect.poll(() => url, { timeout: 15_000 }).toContain("wa.me");
  const texto = new URL(url).searchParams.get("text") ?? "";
  const numero = texto.match(/#(\d+)/)?.[1];
  expect(numero, "mensagem deve ter o número do pedido registrado").toBeTruthy();
  expect(texto).toContain("*Total: R$ 194,90*");

  // Chega no painel sem recarregar a página (Realtime; ou pela atualização automática de 30 s
  // quando o Realtime ainda está "frio", como logo após subir o Supabase)
  const cartao = admin.getByRole("main").getByRole("listitem").filter({ hasText: `#${numero}` });
  await expect(cartao).toBeVisible({ timeout: 40_000 });
  await expect(cartao).toContainText("Cliente Realtime");
  await expect(cartao).toContainText("Rua Aspicuelta, 99");
  await cartao.getByRole("button", { name: "Marcar: Confirmado" }).click();
  await expect(cartao.getByLabel(`Alterar status do pedido ${numero}`)).toHaveValue("confirmado");
  await expect(cartao.getByRole("button", { name: "Marcar: Saiu para entrega" })).toBeVisible();
});

test("editar preço e esgotar produto reflete na loja", async ({ page, browser }) => {
  await entrar(page);
  await page.getByRole("link", { name: "Produtos" }).click();
  await page.getByRole("button", { name: "Editar IPA 473 ml" }).click();
  await page.getByLabel("Preço (R$)").fill("16,50");
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto atualizado")).toBeVisible();
  await page.getByRole("switch", { name: "Disponível: Vodka Premium 1 L" }).click();
  await expect(page.getByRole("switch", { name: "Disponível: Vodka Premium 1 L" })).toHaveAttribute("aria-checked", "false");

  const loja = await (await browser.newContext()).newPage();
  await abrirLoja(loja);
  const ipa = loja.getByRole("article", { name: "IPA 473 ml" });
  await expect(ipa).toContainText("R$ 16,50");
  await expect(loja.getByRole("article", { name: "Vodka Premium 1 L" })).toContainText("Esgotado");

  // Desfaz para não afetar outros testes
  await page.getByRole("switch", { name: "Disponível: Vodka Premium 1 L" }).click();
  await page.getByRole("button", { name: "Editar IPA 473 ml" }).click();
  await page.getByLabel("Preço (R$)").fill("14,90");
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto atualizado").first()).toBeVisible();
});

test("criar produto com foto, categoria nova e reordenar", async ({ page, browser }) => {
  const sufixo = Date.now().toString(36).slice(-4).toUpperCase();
  const categoria = `Gelo ${sufixo}`;
  const produto = `Gelo 5 kg ${sufixo}`;
  await entrar(page);
  await page.getByRole("link", { name: "Categorias" }).click();
  await page.getByLabel("Nome da nova categoria").fill(categoria);
  await page.getByRole("button", { name: "Adicionar categoria" }).click();
  await expect(page.getByText("Categoria criada")).toBeVisible();

  // Reordena pelo teclado: leva a categoria nova para o topo
  const alca = page.getByRole("button", { name: `Arrastar ${categoria}` });
  await alca.focus();
  await page.keyboard.press("Space");
  const total = await page.getByRole("button", { name: /^Arrastar / }).count();
  for (let i = 0; i < total; i++) {
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowUp");
  }
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect(page.getByText("Ordem salva")).toBeVisible();

  await page.getByRole("link", { name: "Produtos" }).click();
  await page.getByRole("button", { name: "Novo produto" }).first().click();
  await page.locator('input[type="file"]').setInputFiles("public/icons/icon-512.png");
  await expect(page.getByText("Imagem enviada")).toBeVisible({ timeout: 15_000 });
  const form = page.getByRole("dialog", { name: "Novo produto" });
  await form.getByLabel("Nome", { exact: true }).fill(produto);
  await form.getByLabel("Preço (R$)").fill("12,00");
  await form.getByLabel("Categoria").selectOption({ label: categoria });
  await form.getByLabel("Descrição").fill("Saco de gelo em cubos.");
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto criado")).toBeVisible();

  const loja = await (await browser.newContext()).newPage();
  await abrirLoja(loja);
  // Categoria nova é a primeira da barra
  await expect(loja.getByRole("navigation", { name: "Categorias" }).getByRole("button").first()).toHaveText(categoria);
  const card = loja.getByRole("article", { name: produto });
  await expect(card).toContainText("R$ 12,00");
  await expect(card.locator("img")).toHaveAttribute("src", /_next\/image/);
});

test("taxa de entrega, banner e loja fechada", async ({ page, browser }) => {
  await entrar(page);
  await page.getByRole("link", { name: "Entrega" }).click();
  await page.getByLabel("Taxa de Região A · até 3 km em reais").fill("6,50");
  await page.getByRole("button", { name: "Salvar Região A · até 3 km" }).click();
  await expect(page.getByText("Região salva")).toBeVisible();

  await page.getByRole("link", { name: "Banner" }).click();
  await page.getByLabel("Título").fill("Sextou no 011");
  await page.getByRole("button", { name: "Salvar banner" }).click();
  await expect(page.getByText("Banner atualizado na loja")).toBeVisible();

  const loja = await (await browser.newContext()).newPage();
  await abrirLoja(loja);
  await expect(loja.getByRole("heading", { level: 1 })).toHaveText("Sextou no 011");
  await loja.getByRole("button", { name: "Adicionar Gin London Dry 750 ml" }).click();
  await loja.getByRole("button", { name: /Ver carrinho/ }).click();
  await loja.getByRole("button", { name: "Finalizar pedido" }).click();
  await loja.getByLabel("Região / bairro").selectOption({ label: "Região A · até 3 km — R$ 6,50" });
  await expect(loja.getByTestId("total")).toHaveText("R$ 126,40");

  await page.getByRole("link", { name: "Loja", exact: true }).click();
  await page.getByRole("radio", { name: /Forçar fechada/ }).click();
  await expect(page.getByText("Modo: Forçar fechada")).toBeVisible();
  await loja.reload();
  await expect(loja.getByText("Fechado agora")).toBeVisible();

  // Restaura
  await page.getByRole("radio", { name: /Automático/ }).click();
  await page.getByRole("link", { name: "Banner" }).click();
  await page.getByLabel("Título").fill("São Paulo no copo");
  await page.getByRole("button", { name: "Salvar banner" }).click();
  await page.getByRole("link", { name: "Entrega" }).click();
  await page.getByLabel("Taxa de Região A · até 3 km em reais").fill("5,00");
  await page.getByRole("button", { name: "Salvar Região A · até 3 km" }).click();
  await expect(page.getByText("Região salva")).toBeVisible();
});

test("RLS: visitante anônimo não lê pedidos nem altera produtos", async ({ request }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const h = { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json" };
  const pedidos = await request.get(`${url}/rest/v1/pedidos?select=*`, { headers: h });
  expect(pedidos.status()).toBe(401);
  const alterar = await request.patch(`${url}/rest/v1/produtos?nome=eq.IPA%20473%20ml`, {
    headers: { ...h, Prefer: "return=representation" },
    data: { preco: 1 },
  });
  expect([401, 403]).toContain(alterar.status());
  const inserir = await request.post(`${url}/rest/v1/pedidos`, {
    headers: h,
    data: { cliente_nome: "x", cliente_telefone: "11999999999", tipo: "retirada", pagamento: "pix", itens: [], subtotal: 0, total: 0 },
  });
  expect([401, 403]).toContain(inserir.status());
  const produtos = await request.get(`${url}/rest/v1/produtos?select=nome,preco&nome=eq.IPA%20473%20ml`, { headers: h });
  expect(produtos.ok()).toBeTruthy();
  expect((await produtos.json())[0].preco).toBe(1490);
  // Visitante não lista os arquivos do bucket (só acessa pela URL pública)
  const lista = await request.post(`${url}/storage/v1/object/list/produtos`, {
    headers: h,
    data: { prefix: "produtos", limit: 10 },
  });
  expect(lista.ok() ? await lista.json() : []).toEqual([]);
});

// Servidor de e-mail de teste do `supabase start` (Mailpit).
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

async function ultimoLinkDeEmail(request: import("@playwright/test").APIRequestContext, para: string, depois: number) {
  let link = "";
  await expect
    .poll(
      async () => {
        const lista = await (await request.get(`${MAILPIT}/api/v1/messages`)).json();
        const msg = lista.messages?.find(
          (m: { To: { Address: string }[]; Created: string }) =>
            m.To.some((t) => t.Address === para) && new Date(m.Created).getTime() >= depois,
        );
        if (!msg) return "";
        const corpo = await (await request.get(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
        link = (corpo.HTML as string).match(/href="([^"]+verify[^"]+)"/)?.[1]?.replace(/&amp;/g, "&") ?? "";
        return link;
      },
      { timeout: 20_000 },
    )
    .toContain("type=recovery");
  return link;
}

test("recuperar senha por e-mail e entrar com a nova senha", async ({ page, request }) => {
  const NOVA = "NovaSenha456";
  const inicio = Date.now() - 2000;

  await page.goto("/admin/login");
  await page.getByRole("link", { name: "Esqueci minha senha" }).click();
  await expect(page.getByRole("heading", { name: "Recuperar senha" })).toBeVisible();
  await page.locator("#recuperar-email").fill(EMAIL);
  await page.getByRole("button", { name: "Enviar link" }).click();
  await expect(page.getByRole("heading", { name: "Confira seu e-mail" })).toBeVisible();

  // Abre o link do e-mail no mesmo navegador
  await page.goto(await ultimoLinkDeEmail(request, EMAIL, inicio));
  await expect(page).toHaveURL(/\/admin\/nova-senha$/);

  await page.locator("#nova-senha").fill(NOVA);
  await page.locator("#nova-senha-confirmacao").fill("outra-coisa");
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page.getByText("As senhas não são iguais.")).toBeVisible();
  await page.locator("#nova-senha-confirmacao").fill(NOVA);
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();

  // Sai e entra com a senha nova
  await page.getByRole("button", { name: "Sair" }).first().click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.locator("#login-email").fill(EMAIL);
  await page.locator("#login-senha").fill(NOVA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();

  // Volta a senha original (logado, a tela de nova senha também serve para trocar)
  await page.goto("/admin/nova-senha");
  await page.locator("#nova-senha").fill(SENHA);
  await page.locator("#nova-senha-confirmacao").fill(SENHA);
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();
});

test("link de recuperação inválido volta com aviso; nova senha exige login", async ({ page }) => {
  await page.goto("/admin/auth/confirmar?code=codigo-invalido&proximo=/admin/nova-senha");
  await expect(page).toHaveURL(/\/admin\/recuperar\?erro=link$/);
  await expect(page.getByRole("alert").filter({ hasText: "expirou" })).toBeVisible();
  await page.goto("/admin/nova-senha");
  await expect(page).toHaveURL(/\/admin\/login$/);
  // Não aceita redirecionar para fora do painel
  await page.goto("/admin/auth/confirmar?proximo=https://exemplo.com");
  await expect(page).toHaveURL(/\/admin\/recuperar\?erro=link$/);
});

test("foto enviada e descartada (ou substituída) é apagada do Storage", async ({ page, request }) => {
  await entrar(page);
  await page.getByRole("link", { name: "Produtos", exact: true }).click();

  const urlOriginal = async () => {
    const img = page.getByRole("dialog").getByAltText("Pré-visualização");
    if (!(await img.count())) return "";
    const src = await img.getAttribute("src");
    return decodeURIComponent(new URL(src!, "http://x").searchParams.get("url")!);
  };
  const enviar = async (arquivo: string) => {
    const antes = await urlOriginal();
    await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(arquivo);
    // Espera a pré-visualização trocar para a imagem recém-enviada
    await expect.poll(urlOriginal, { timeout: 15_000 }).not.toBe(antes);
    return urlOriginal();
  };
  const existe = async (url: string) => (await request.get(url)).status() === 200;

  // 1) Envia e fecha sem salvar => apaga
  await page.getByRole("button", { name: "Novo produto" }).first().click();
  const descartada = await enviar("public/icons/icon-192.png");
  expect(await existe(descartada)).toBe(true);
  await page.getByRole("button", { name: "Fechar formulário" }).click();
  await expect.poll(() => existe(descartada)).toBe(false);

  // 2) Envia duas, salva com a segunda => a primeira some, a segunda fica
  const nome = `Teste foto ${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "Novo produto" }).first().click();
  const primeira = await enviar("public/icons/icon-192.png");
  const segunda = await enviar("public/icons/icon-512.png");
  expect(primeira).not.toBe(segunda);
  const form = page.getByRole("dialog", { name: "Novo produto" });
  await form.getByLabel("Nome", { exact: true }).fill(nome);
  await form.getByLabel("Preço (R$)").fill("9,90");
  await form.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto criado")).toBeVisible();
  await expect.poll(() => existe(primeira)).toBe(false);
  expect(await existe(segunda)).toBe(true);

  // 3) Excluir o produto apaga a foto
  await page.getByRole("button", { name: `Excluir ${nome}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByText("Produto excluído")).toBeVisible();
  await expect.poll(() => existe(segunda)).toBe(false);
});

test("importar foto por link (e recusar link que não é imagem)", async ({ page, request }) => {
  // Precisa de internet. Imagem pública e estável usada só para o teste.
  const LINK = process.env.LINK_IMAGEM_TESTE ?? "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png";
  await entrar(page);
  await page.getByRole("link", { name: "Produtos", exact: true }).click();
  await page.getByRole("button", { name: "Editar IPA 473 ml" }).click();
  const form = page.getByRole("dialog", { name: "Editar produto" });

  await form.getByRole("button", { name: "Colar link" }).click();
  const campo = form.getByLabel("Link da imagem");

  // Link de página: mensagem de ajuda, sem enviar o formulário do produto
  await campo.fill("https://www.google.com/");
  await campo.press("Enter");
  await expect(form.getByRole("alert")).toContainText("não de uma imagem");
  await expect(form).toBeVisible();

  // Link de imagem: baixa, converte e mostra a prévia vinda do Supabase
  await campo.fill(LINK);
  await form.getByRole("button", { name: "Importar" }).click();
  await expect(page.getByText("Imagem importada")).toBeVisible({ timeout: 20_000 });
  const src = await form.getByAltText("Pré-visualização").getAttribute("src");
  const original = decodeURIComponent(new URL(src!, "http://x").searchParams.get("url")!);
  expect(original).toContain("/storage/v1/object/public/produtos/produtos/");
  expect(original).toMatch(/\.webp$/);
  const img = await request.get(original);
  expect(img.headers()["content-type"]).toBe("image/webp");

  // Fecha sem salvar: a imagem importada é descartada do Storage
  await page.getByRole("button", { name: "Fechar formulário" }).click();
  await expect.poll(async () => (await request.get(original)).status()).not.toBe(200);
});
