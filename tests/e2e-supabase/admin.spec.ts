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

/** Navega pelo menu do painel (no celular, algumas telas ficam em "Mais"). */
async function irPara(page: Page, nome: string) {
  const link = page.getByRole("link", { name: nome, exact: true });
  if (await link.first().isVisible()) return link.first().click();
  await page.getByRole("button", { name: "Mais", exact: true }).click();
  await page.getByRole("dialog").getByRole("link", { name: nome, exact: true }).click();
}

/** Abre o menu "Ações de <produto>" na tabela de produtos. */
async function abrirAcoes(page: Page, produto: string) {
  await page.getByRole("button", { name: `Ações de ${produto}`, exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

/** Abre a página de edição do produto pelo menu de ações. */
async function editarProduto(page: Page, produto: string) {
  await abrirAcoes(page, produto);
  await page.getByRole("menuitem", { name: "Editar produto" }).click();
  await expect(page.getByTestId("cadastro-produto")).toBeVisible();
}

/** Liga/desliga "Disponível para venda" pelo menu de ações. */
async function alternarDisponivel(page: Page, produto: string) {
  await abrirAcoes(page, produto);
  await page.getByRole("menuitemcheckbox", { name: /Disponível para venda/ }).click();
  await page.keyboard.press("Escape");
}

/**
 * O banco confere o horário com o relógio de verdade (o da página é simulado),
 * então a loja fica "forçada aberta" por 3 h durante os testes.
 */
async function forcarAberta(page: Page) {
  await irPara(page, "Configurações");
  await page.getByRole("radio", { name: /Forçar aberta/ }).click();
  await page.getByRole("button", { name: /^\+3h/ }).click();
  await expect(page.getByText(/Modo: Forçar aberta até/)).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await entrar(page);
  await forcarAberta(page);
  await page.context().close();
});

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
  await irPara(page, "Produtos");
  await editarProduto(page, "IPA 473 ml");
  await page.getByTestId("cadastro-produto").getByLabel("Preço (R$)").fill("16,50");
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto atualizado")).toBeVisible();
  await alternarDisponivel(page, "Vodka Premium 1 L");
  await expect(page.getByText("Venda pausada").first()).toBeVisible();

  const loja = await (await browser.newContext()).newPage();
  await abrirLoja(loja);
  const ipa = loja.getByRole("article", { name: "IPA 473 ml" });
  await expect(ipa).toContainText("R$ 16,50");
  await expect(loja.getByRole("article", { name: "Vodka Premium 1 L" })).toContainText("Esgotado");

  // Desfaz para não afetar outros testes
  await alternarDisponivel(page, "Vodka Premium 1 L");
  await editarProduto(page, "IPA 473 ml");
  await page.getByTestId("cadastro-produto").getByLabel("Preço (R$)").fill("14,90");
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto atualizado").first()).toBeVisible();
});

test("criar produto com foto, categoria nova e reordenar", async ({ page, browser }) => {
  const sufixo = Date.now().toString(36).slice(-4).toUpperCase();
  const categoria = `Gelo ${sufixo}`;
  const produto = `Gelo 5 kg ${sufixo}`;
  await entrar(page);
  await irPara(page, "Categorias");
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
  await page.getByRole("tab", { name: "Fotos", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles("public/icons/icon-512.png");
  await expect(page.getByText("Imagem enviada")).toBeVisible({ timeout: 15_000 });
  const form = page.getByTestId("cadastro-produto");
  await form.getByRole("tab", { name: "Dados gerais", exact: true }).click();
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
  await irPara(page, "Entrega");
  await page.getByLabel("Taxa de Região A · até 3 km em reais").fill("6,50");
  await page.getByRole("button", { name: "Salvar Região A · até 3 km" }).click();
  await expect(page.getByText("Região salva")).toBeVisible();

  await irPara(page, "Banner");
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

  await irPara(page, "Configurações");
  await page.getByRole("radio", { name: /Forçar fechada/ }).click();
  await page.getByRole("button", { name: /Até eu reabrir/ }).click();
  await expect(page.getByText("Modo: Forçar fechada")).toBeVisible();
  await expect(page.getByText("Fechada até você reabrir.")).toBeVisible();
  await loja.reload();
  await expect(loja.getByText("Fechado agora")).toBeVisible();

  // Restaura (aberta por 3 h, como no começo dos testes)
  await forcarAberta(page);
  await irPara(page, "Banner");
  await page.getByLabel("Título").fill("São Paulo no copo");
  await page.getByRole("button", { name: "Salvar banner" }).click();
  await irPara(page, "Entrega");
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
    const img = page.getByTestId("cadastro-produto").getByAltText("Pré-visualização");
    if (!(await img.count())) return "";
    const src = await img.getAttribute("src");
    return decodeURIComponent(new URL(src!, "http://x").searchParams.get("url")!);
  };
  const enviar = async (arquivo: string) => {
    await page.getByRole("tab", { name: "Fotos", exact: true }).click();
    const antes = await urlOriginal();
    await page.getByTestId("cadastro-produto").locator('input[type="file"]').setInputFiles(arquivo);
    // Espera a pré-visualização trocar para a imagem recém-enviada
    await expect.poll(urlOriginal, { timeout: 15_000 }).not.toBe(antes);
    return urlOriginal();
  };
  const existe = async (url: string) => (await request.get(url)).status() === 200;

  // 1) Envia e fecha sem salvar => apaga
  await page.getByRole("button", { name: "Novo produto" }).first().click();
  const descartada = await enviar("public/icons/icon-192.png");
  expect(await existe(descartada)).toBe(true);
  await page.getByRole("button", { name: "Voltar para produtos" }).click();
  await expect.poll(() => existe(descartada)).toBe(false);

  // 2) Envia duas, salva com a segunda => a primeira some, a segunda fica
  const nome = `Teste foto ${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "Novo produto" }).first().click();
  const primeira = await enviar("public/icons/icon-192.png");
  const segunda = await enviar("public/icons/icon-512.png");
  expect(primeira).not.toBe(segunda);
  const form = page.getByTestId("cadastro-produto");
  await form.getByRole("tab", { name: "Dados gerais", exact: true }).click();
  await form.getByLabel("Nome", { exact: true }).fill(nome);
  await form.getByLabel("Preço (R$)").fill("9,90");
  await form.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto criado")).toBeVisible();
  await expect.poll(() => existe(primeira)).toBe(false);
  expect(await existe(segunda)).toBe(true);

  // 3) Excluir o produto apaga a foto
  await abrirAcoes(page, nome);
  await page.getByRole("button", { name: "Excluir produto" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByText("Produto excluído")).toBeVisible();
  await expect.poll(() => existe(segunda)).toBe(false);
});

test("importar foto por link (e recusar link que não é imagem)", async ({ page, request }) => {
  // Precisa de internet. Imagem pública e estável usada só para o teste.
  const LINK = process.env.LINK_IMAGEM_TESTE ?? "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png";
  await entrar(page);
  await irPara(page, "Produtos");
  await editarProduto(page, "IPA 473 ml");
  const form = page.getByTestId("cadastro-produto");

  await form.getByRole("tab", { name: "Fotos", exact: true }).click();
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
  await page.getByRole("button", { name: "Voltar para produtos" }).click();
  await expect.poll(async () => (await request.get(original)).status()).not.toBe(200);
});

test("estoque: entrada, esgota com pedidos e volta ao cancelar", async ({ page, browser }) => {
  await entrar(page);
  await page.getByRole("link", { name: "Estoque", exact: true }).click();
  await page.getByLabel("Filtrar por estoque").selectOption("todos");
  await page.getByLabel("Buscar produto no estoque").fill("Whisky 12");
  await page.getByRole("switch", { name: "Controlar estoque de Whisky 12 anos 1 L" }).click();
  await page.getByRole("button", { name: "Entrada de Whisky 12 anos 1 L" }).click();
  await page.getByLabel("Quantas unidades chegaram?").fill("2");
  await page.getByRole("button", { name: "Registrar entrada" }).click();
  await expect(page.getByText("Whisky 12 anos 1 L: 2 un em estoque")).toBeVisible();

  const loja = await (await browser.newContext()).newPage();
  await loja.context().route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (r) => r.fulfill({ status: 200, body: "ok" }));
  await abrirLoja(loja);
  const card = loja.getByRole("article", { name: "Whisky 12 anos 1 L" });
  await expect(card).toContainText("Últimas 2");
  await loja.getByRole("button", { name: "Adicionar Whisky 12 anos 1 L" }).click();
  await loja.getByRole("button", { name: "Aumentar quantidade de Whisky 12 anos 1 L" }).click();
  await expect(loja.getByRole("button", { name: "Aumentar quantidade de Whisky 12 anos 1 L" })).toBeDisabled();
  await loja.getByRole("button", { name: /Ver carrinho/ }).click();
  await loja.getByRole("button", { name: "Finalizar pedido" }).click();
  await loja.getByRole("dialog").getByRole("radio", { name: "Retirada" }).check({ force: true });
  await loja.getByLabel("Nome").fill("Cliente Estoque");
  await loja.getByLabel("WhatsApp / telefone").fill(`119${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`);
  await loja.getByRole("dialog").getByRole("radio", { name: "Pix" }).check({ force: true });
  await loja.getByRole("button", { name: "Enviar pedido pelo WhatsApp" }).click();
  await expect.poll(async () => (await loja.evaluate(() => location.href)) + "").not.toBe("");

  // Esgotou: com a visibilidade automática pelo estoque, o produto sai da loja
  const outra = await (await browser.newContext()).newPage();
  await abrirLoja(outra);
  await expect(outra.getByRole("article", { name: "IPA 473 ml" })).toBeVisible();
  await expect(outra.getByRole("article", { name: "Whisky 12 anos 1 L" })).toHaveCount(0);

  // Cancelar o pedido devolve as 2 unidades
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByRole("tab", { name: "Todos" }).click();
  const pedido = page.getByRole("main").getByRole("listitem").filter({ hasText: "Cliente Estoque" });
  const numero = (await pedido.locator("p.titulo").first().textContent())!.replace("#", "");
  await pedido.getByLabel(`Alterar status do pedido ${numero}`).selectOption("cancelado");
  await expect(page.getByText(`Pedido #${numero}: Cancelado`)).toBeVisible();
  await page.goto("/admin/estoque");
  await page.getByLabel("Buscar produto no estoque").fill("Whisky 12");
  await expect(page.getByRole("row").filter({ hasText: "Whisky 12 anos 1 L" })).toContainText("2 un");
});

test("PDV: abre caixa, vende com adicional e desconto, imprime cupom e fecha", async ({ browser }) => {
  // Desktop: painel da venda na coluna ao lado
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  await entrar(page);
  await page.getByRole("link", { name: "PDV", exact: true }).click();
  await page.getByLabel("Troco inicial (R$)").fill("50");
  await page.getByRole("button", { name: "Abrir caixa" }).click();
  await expect(page.getByText("Caixa aberto. Boas vendas!")).toBeVisible();

  await page.getByRole("button", { name: "Vender Copão de Askov" }).click();
  const opcoes = page.getByRole("dialog", { name: "Copão de Askov" });
  // Grupos de adicionais abrem como sanfona
  await opcoes.getByRole("heading", { name: "Energético" }).click();
  await opcoes.locator("label").filter({ hasText: "Baly" }).click();
  await opcoes.getByRole("button", { name: /Adicionar · R\$ 13,00/ }).click();
  await page.getByRole("button", { name: "Vender IPA 473 ml" }).click();
  await page.getByRole("button", { name: "Vender IPA 473 ml" }).click();

  const venda = page.getByRole("complementary");
  await expect(venda.getByTestId("pdv-total")).toHaveText("R$ 42,80");
  await venda.getByRole("button", { name: "Ir para pagamento", exact: true }).click();
  await venda.locator("summary").filter({ hasText: "Desconto e identificação do cliente" }).click();
  await venda.getByLabel("Desconto", { exact: true }).fill("2,80");
  await expect(venda.getByTestId("pdv-total")).toHaveText("R$ 40,00");
  await venda.getByLabel("Recebido", { exact: true }).fill("50");
  await expect(venda.getByText("Troco: R$ 10,00")).toBeVisible();
  await venda.getByRole("button", { name: "Finalizar · R$ 40,00" }).click();

  const cupom = page.getByRole("dialog", { name: /Venda #/ });
  await expect(cupom).toContainText("Troco");
  await expect(cupom).toContainText("R$ 10,00");
  await expect(cupom).toContainText("+ Baly");
  await cupom.getByRole("button", { name: "Nova venda" }).click();

  await page.getByRole("button", { name: "Fechar caixa" }).click();
  const fechar = page.getByRole("dialog", { name: "Fechar caixa" });
  // 50 de troco + 40 da venda em dinheiro = 90 esperados
  await expect(fechar).toContainText("R$ 90,00");
  await fechar.getByLabel("Dinheiro contado na gaveta (R$)").fill("88");
  await expect(fechar.getByText("Falta R$ 2,00")).toBeVisible();
  await fechar.getByRole("button", { name: "Fechar caixa" }).click();
  await expect(page.getByText(/faltou R\$ 2,00/)).toBeVisible();
});

test("PDV no celular: só a busca no topo e a venda ocupa a tela", async ({ page }) => {
  await entrar(page);
  await page.getByRole("link", { name: "PDV", exact: true }).click();
  await page.getByLabel("Troco inicial (R$)").fill("0");
  await page.getByRole("button", { name: "Abrir caixa" }).click();
  await expect(page.getByText("Caixa aberto. Boas vendas!")).toBeVisible();

  // Sem busca, nenhum produto listado; a venda aparece direto (sem gaveta)
  await expect(page.getByRole("button", { name: "Vender IPA 473 ml" })).toBeHidden();
  const venda = page.getByRole("complementary", { name: "Venda atual" });
  await expect(venda).toBeVisible();

  const busca = page.getByLabel("Buscar produto no PDV");
  await busca.fill("ipa");
  await page.getByRole("button", { name: "Vender IPA 473 ml" }).click();
  // Escolheu: a busca limpa, a lista some e o item aparece na venda
  await expect(busca).toHaveValue("");
  await expect(page.getByRole("button", { name: "Vender IPA 473 ml" })).toBeHidden();
  await expect(venda).toContainText("IPA 473 ml");
  await expect(venda.getByTestId("pdv-total")).toHaveText("R$ 14,90");
  await expect(venda.getByRole("button", { name: "Ir para pagamento" })).toBeInViewport();

  await venda.getByRole("button", { name: "Ir para pagamento" }).click();
  await venda.getByRole("radio", { name: "Pix" }).click();
  await venda.getByRole("button", { name: "Finalizar · R$ 14,90" }).click();
  await page.getByRole("dialog", { name: /Venda #/ }).getByRole("button", { name: "Nova venda" }).click();

  // Fecha o caixa para não afetar outros testes
  await page.getByRole("button", { name: "Fechar caixa" }).click();
  const fechar = page.getByRole("dialog", { name: "Fechar caixa" });
  await fechar.getByLabel("Dinheiro contado na gaveta (R$)").fill("0");
  await fechar.getByRole("button", { name: "Fechar caixa" }).click();
});

test("produtos: clicar no título da coluna ordena de A a Z e de Z a A", async ({ page }) => {
  await entrar(page);
  await irPara(page, "Produtos");
  const tabela = page.getByRole("region", { name: "Tabela de produtos" });
  const nomes = async () => (await tabela.locator("tbody tr td:first-child button").allInnerTexts()).map((t) => t.replace(/\s*\(\d+ variações\)$/, ""));
  const precos = async () =>
    (await tabela.locator("tbody tr td:nth-child(4)").allInnerTexts())
      .filter((t) => t.includes("R$"))
      .map((t) => Number(t.replace(/[^\d,]/g, "").replace(",", ".")));
  const emOrdem = (v: number[]) => v.every((x, i) => i === 0 || v[i - 1] <= x);
  const porNome = (a: string, b: string) => a.localeCompare(b, "pt-BR");

  const descricao = tabela.getByRole("columnheader", { name: "Descrição" });
  await descricao.getByRole("button").click();
  await expect(descricao).toHaveAttribute("aria-sort", "ascending");
  const az = await nomes();
  expect(az).toEqual([...az].sort(porNome));
  await descricao.getByRole("button").click();
  await expect(descricao).toHaveAttribute("aria-sort", "descending");
  expect(await nomes()).toEqual([...az].sort(porNome).reverse());

  const preco = tabela.getByRole("columnheader", { name: "Preço" });
  await preco.getByRole("button").click();
  await expect(preco).toHaveAttribute("aria-sort", "ascending");
  await expect(descricao).not.toHaveAttribute("aria-sort", /.+/);
  expect(emOrdem(await precos())).toBe(true);
  await preco.getByRole("button").click();
  expect(emOrdem((await precos()).reverse())).toBe(true);
  // Terceiro clique volta à ordem do catálogo
  await preco.getByRole("button").click();
  await expect(preco).not.toHaveAttribute("aria-sort", /.+/);
});

test("SKU no cadastro: produto simples e variações, aparece na tabela e na busca", async ({ page }) => {
  const sufixo = Date.now().toString(36).slice(-5).toUpperCase();
  await entrar(page);
  await irPara(page, "Produtos");

  // Produto simples com SKU
  await page.getByRole("button", { name: "Novo produto" }).first().click();
  // O Next mantém a tela anterior montada (oculta); usa sempre o formulário visível
  const form = page.locator('[data-testid="cadastro-produto"]:visible');
  await form.getByLabel("Nome", { exact: true }).fill(`Tônica ${sufixo}`);
  await form.getByLabel("Preço (R$)").fill("7,00");
  await form.getByLabel("SKU (código)").fill(`TON-${sufixo}`);
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto criado")).toBeVisible();
  const busca = page.getByLabel("Buscar produto");
  await busca.fill(`TON-${sufixo}`);
  const tabela = page.getByRole("region", { name: "Tabela de produtos" });
  await expect(tabela.locator("tbody tr")).toHaveCount(1);
  await expect(tabela.locator("tbody tr").first()).toContainText(`Tônica ${sufixo}`);
  await expect(tabela.locator("tbody tr").first()).toContainText(`TON-${sufixo}`);

  // Reabre: o SKU vem preenchido
  await tabela.getByRole("button", { name: `Tônica ${sufixo}`, exact: true }).click();
  await expect(form.getByLabel("SKU (código)")).toHaveValue(`TON-${sufixo}`);

  // Produto com variações: SKU do produto e de cada variação
  // (página nova carregada do zero: reabrir "Novo produto" pelo menu reaproveita a tela oculta e a recarrega)
  await page.goto("/admin/produtos/novo");
  await form.getByLabel("Nome", { exact: true }).fill(`Suco ${sufixo}`);
  await form.getByLabel("Tipo de produto").selectOption("variacoes");
  await form.getByLabel("SKU do produto").fill(`SUC-${sufixo}`);
  await form.getByRole("tab", { name: "Variações", exact: true }).click();
  await form.getByLabel("Nome da variação 1").fill("Uva");
  await form.getByLabel("Preço da variação 1 (R$)").fill("6,00");
  await form.getByLabel("SKU da variação 1").fill(`SUC-${sufixo}-UVA`);
  await form.getByRole("button", { name: "Adicionar variação" }).click();
  await form.getByLabel("Nome da variação 2").fill("Laranja");
  await form.getByLabel("Preço da variação 2 (R$)").fill("6,00");
  await form.getByLabel("SKU da variação 2").fill(`SUC-${sufixo}-UVA`);
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(form.getByText("Use um SKU diferente em cada variação.")).toBeVisible();
  await form.getByLabel("SKU da variação 2").fill(`SUC-${sufixo}-LAR`);
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto criado")).toBeVisible();

  // Na tabela o produto mostra o SKU geral; a busca acha pelo SKU da variação
  const buscaLista = page.getByLabel("Buscar produto");
  await buscaLista.fill(`SUC-${sufixo}-LAR`);
  await expect(tabela.locator("tbody tr")).toHaveCount(1);
  await expect(tabela.locator("tbody tr").first()).toContainText(`SUC-${sufixo}`);
  await tabela.getByRole("button", { name: new RegExp(`^Suco ${sufixo}`) }).click();
  await form.getByRole("tab", { name: "Variações", exact: true }).click();
  await expect(form.getByLabel("SKU da variação 1")).toHaveValue(`SUC-${sufixo}-UVA`);
  await expect(form.getByLabel("SKU da variação 2")).toHaveValue(`SUC-${sufixo}-LAR`);
  await form.getByRole("tab", { name: "Dados gerais", exact: true }).click();
  await expect(form.getByLabel("SKU do produto")).toHaveValue(`SUC-${sufixo}`);

  // SKU já usado por outro produto é recusado com o nome do dono
  await page.goto("/admin/produtos/novo");
  await form.getByLabel("Nome", { exact: true }).fill(`Repetido ${sufixo}`);
  await form.getByLabel("Preço (R$)").fill("1,00");
  await form.getByLabel("SKU (código)").fill(`ton-${sufixo}`);
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(form.getByRole("alert")).toContainText(`já está em uso por "Tônica ${sufixo}"`);
});

test("subcategorias: criar dentro de outra, usar no produto, filtrar e ver na loja", async ({ page, browser }) => {
  const sufixo = Date.now().toString(36).slice(-4).toUpperCase();
  const principal = `Destilados ${sufixo}`;
  const sub = `Rum ${sufixo}`;
  await entrar(page);
  await irPara(page, "Categorias");
  await page.getByLabel("Nome da nova categoria").fill(principal);
  await page.getByRole("button", { name: "Adicionar categoria" }).click();
  await expect(page.getByText("Categoria criada")).toBeVisible();
  await page.getByLabel("Nome da nova categoria").fill(sub);
  await page.getByLabel("Dentro de (opcional)").selectOption({ label: `Dentro de ${principal}` });
  await page.getByRole("button", { name: "Adicionar categoria" }).click();
  await expect(page.getByLabel(`${sub} fica dentro de`)).toHaveValue(/.+/);
  // A principal agora mostra que tem subcategoria e não pode virar sub
  await expect(page.getByRole("listitem").filter({ hasText: principal }).filter({ hasNotText: sub }).getByText("1 subcategoria")).toBeVisible();
  await expect(page.getByLabel(`${principal} fica dentro de`)).toHaveCount(0);

  // Produto na subcategoria: o select mostra "Principal › Sub"
  await page.goto("/admin/produtos/novo");
  const form = page.locator('[data-testid="cadastro-produto"]:visible');
  await form.getByLabel("Nome", { exact: true }).fill(`Rum Ouro ${sufixo}`);
  await form.getByLabel("Preço (R$)").fill("45,00");
  await form.getByLabel("Categoria").selectOption({ label: `${principal} › ${sub}` });
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto criado")).toBeVisible();

  // Filtrar pela principal mostra o produto da subcategoria
  await page.getByLabel("Filtrar por categoria").selectOption({ label: principal });
  await expect(page.getByRole("region", { name: "Tabela de produtos" }).locator("tbody tr")).toHaveCount(1);

  // Na loja: a principal na barra e a subcategoria dentro dela
  const loja = await (await browser.newContext()).newPage();
  await abrirLoja(loja);
  await loja.getByRole("navigation", { name: "Categorias" }).getByRole("button", { name: principal }).click();
  const secao = loja.getByRole("region", { name: principal });
  await expect(secao.getByRole("navigation", { name: `Tipos de ${principal}` }).getByRole("button", { name: new RegExp(sub) })).toBeVisible();
  await expect(secao.getByRole("article", { name: `Rum Ouro ${sufixo}` })).toBeVisible();
});

test("Pix automático: QR Code no checkout, confirmação sozinha e pedido pago no painel", async ({ page, browser, request }) => {
  await entrar(page);
  await irPara(page, "Configurações");
  // Com MP_FAKE=1 a função "pix" responde como configurada (sem chamar o Mercado Pago)
  const chave = page.getByRole("switch", { name: "Pix automático" });
  await expect(chave).toBeEnabled();
  if ((await chave.getAttribute("aria-checked")) !== "true") await chave.click();
  await expect(chave).toHaveAttribute("aria-checked", "true");

  const loja = await (await browser.newContext()).newPage();
  let whatsapp = "";
  await loja.context().route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (r) => {
    whatsapp = r.request().url();
    return r.fulfill({ status: 200, body: "ok" });
  });
  await abrirLoja(loja);
  await loja.getByRole("button", { name: "Adicionar IPA 473 ml" }).click();
  await loja.getByRole("button", { name: /Ver carrinho/ }).click();
  await loja.getByRole("button", { name: "Finalizar pedido" }).click();
  await loja.getByLabel("Nome").fill("Cliente Pix");
  await loja.getByLabel("WhatsApp / telefone").fill(`119${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`);
  await loja.getByRole("dialog").getByRole("radio", { name: "Retirada" }).check({ force: true });
  await loja.getByRole("dialog").getByRole("radio", { name: /Pix/ }).check({ force: true });
  await expect(loja.getByRole("dialog")).toContainText("QR Code na hora");

  // O pedido é gravado e a tela pede o Pix (o valor vem do banco, não do navegador)
  const chamada = loja.waitForRequest((r) => /\/functions\/v1\/pix$/.test(r.url()) && r.method() === "POST");
  await loja.getByRole("button", { name: "Pagar com Pix" }).click();
  const pedidoId = (await chamada).postDataJSON().pedido_id as string;
  await expect(loja.getByRole("heading", { name: "Pague com Pix" })).toBeVisible();
  await expect(loja.getByRole("img", { name: /QR Code Pix de R\$ 14,90/ })).toBeVisible();
  await expect(loja.getByLabel("Código Pix copia e cola")).toContainText("PIXTESTE");
  await expect(loja.getByRole("status").filter({ hasText: "Aguardando pagamento" })).toContainText(/vence em (29|30):\d\d/);
  expect(whatsapp).toBe(""); // WhatsApp só depois de pagar

  // Mercado Pago confirma (simulado): a tela muda sozinha
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const sim = await request.post(`${url}/functions/v1/pix/simular`, { headers: { apikey: anon }, data: { pedido_id: pedidoId, status: "approved" } });
  expect(await sim.json()).toMatchObject({ resultado: "pago" });
  await expect(loja.getByRole("heading", { name: "Pagamento confirmado!" })).toBeVisible({ timeout: 10_000 });
  const aviso = loja.getByRole("link", { name: "Avisar no WhatsApp" });
  expect(decodeURIComponent((await aviso.getAttribute("href")) ?? "")).toContain("Pix pelo site — PAGO ✅");

  // No painel o pedido aparece como pago
  await irPara(page, "Pedidos");
  const numero = (await loja.getByText(/Pedido #\d+ está pago/).innerText()).match(/#(\d+)/)![1];
  const cartao = page.getByRole("main").getByRole("listitem").filter({ hasText: `#${numero}` });
  await expect(cartao).toContainText("Pix pago ✓", { timeout: 40_000 });

  // Estorno: sem login é recusado; o admin estorna pelo botão
  const semLogin = await request.post(`${url}/functions/v1/pix/estornar`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` }, data: { pedido_id: pedidoId } });
  expect(semLogin.status()).toBe(403);
  await cartao.getByRole("button", { name: "Estornar Pix" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Estornar" }).click();
  await expect(page.getByText(`Pix do pedido #${numero} estornado`)).toBeVisible();
  await expect(cartao).toContainText("Pix estornado", { timeout: 40_000 });
  await expect(cartao.getByRole("button", { name: "Estornar Pix" })).toHaveCount(0);

  // Desliga de novo para não afetar os outros testes
  await irPara(page, "Configurações");
  await page.getByRole("switch", { name: "Pix automático" }).click();
  await expect(page.getByRole("switch", { name: "Pix automático" })).toHaveAttribute("aria-checked", "false");
});

test("contas a pagar e a receber: cadastrar, pagar pela conta escolhida, desfazer e receber", async ({ page }) => {
  const sufixo = Date.now().toString(36).slice(-5).toUpperCase();
  await entrar(page);

  // Menu por seções: Finanças › Contas a pagar
  await irPara(page, "Contas a pagar");
  await expect(page.getByRole("heading", { name: "Contas a pagar" })).toBeVisible();
  await page.getByRole("button", { name: "Nova conta a pagar" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Descrição").fill(`NF ${sufixo} Ambev`);
  await form.getByLabel("Fornecedor / para quem").fill("Ambev");
  await form.getByLabel("Valor (R$)").fill("45,00");
  await form.getByLabel("Categoria").fill("Fornecedores");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Conta criada")).toBeVisible();
  const linha = page.getByRole("list", { name: "Contas a pagar" }).getByRole("listitem").filter({ hasText: `NF ${sufixo} Ambev` });
  await expect(linha).toContainText("Vence hoje");
  await expect(linha).toContainText("R$ 45,00");

  // Pagar: escolhe a conta de saída
  await linha.getByRole("button", { name: "Pagar" }).click();
  const pagar = page.getByRole("dialog");
  await expect(pagar.getByLabel("Pagar com a conta")).toBeVisible();
  await pagar.getByRole("button", { name: "Pagar R$ 45,00" }).click();
  await expect(page.getByText("Paga e lançada no extrato")).toBeVisible();
  await expect(linha).toHaveCount(0); // saiu de "Em aberto"
  await page.getByRole("button", { name: "Pagas", exact: true }).click();
  await expect(linha).toContainText("Paga em");

  // Desfazer: volta para em aberto (com estorno no extrato)
  await linha.getByRole("button", { name: "Desfazer" }).click();
  await page.getByRole("dialog").getByLabel("Motivo").fill("Teste");
  await page.getByRole("dialog").getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByText("Pagamento desfeito")).toBeVisible();
  await page.getByRole("button", { name: "Em aberto", exact: true }).click();
  await expect(linha).toContainText("Vence hoje");
  // Cancela para não somar nos próximos testes
  await linha.getByRole("button", { name: `Cancelar NF ${sufixo} Ambev` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar conta" }).click();
  await expect(page.getByText("Conta cancelada")).toBeVisible();

  // Contas a receber: entrada na conta escolhida
  await irPara(page, "Contas a receber");
  await page.getByRole("button", { name: "Nova conta a receber" }).click();
  await page.getByRole("dialog").getByLabel("Descrição").fill(`Fiado ${sufixo}`);
  await page.getByRole("dialog").getByLabel("Valor (R$)").fill("30,00");
  await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
  const receber = page.getByRole("list", { name: "Contas a receber" }).getByRole("listitem").filter({ hasText: `Fiado ${sufixo}` });
  await receber.getByRole("button", { name: "Receber" }).click();
  await expect(page.getByRole("dialog").getByLabel("Receber na conta")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Receber R$ 30,00" }).click();
  await expect(page.getByText("Recebida e lançada no extrato")).toBeVisible();
});

test("calendário: clicar no dia cria conta com o vencimento, ano todo com repetição e filtro por período", async ({ page }) => {
  const sufixo = Date.now().toString(36).slice(-5).toUpperCase();
  await entrar(page);
  await irPara(page, "Calendário");
  await expect(page.getByRole("heading", { name: "Calendário de contas" })).toBeVisible();

  // Vai dois meses à frente e clica no dia 15
  await page.getByRole("button", { name: "Próximo mês" }).click();
  await page.getByRole("button", { name: "Próximo mês" }).click();
  const dia = page.getByRole("gridcell", { name: /^15\// });
  const data = (await dia.getAttribute("aria-label"))!.slice(0, 10); // dd/mm/aaaa
  const iso = data.split("/").reverse().join("-");
  await dia.click();
  // Dia com contas abre a lista; dia vazio abre direto a nova conta
  const novaNoDia = page.getByRole("dialog").getByRole("button", { name: "Nova conta neste dia" });
  if (await novaNoDia.isVisible()) await novaNoDia.click();
  const form = page.getByRole("dialog");
  await expect(form.getByLabel("Vencimento")).toHaveValue(iso);
  await form.getByLabel("Descrição").fill(`Aluguel ${sufixo}`);
  await form.getByLabel("Valor (R$)").fill("1500,00");
  await form.getByLabel("Repetir").selectOption("12");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("12 contas criadas")).toBeVisible();
  // Se veio da lista do dia, ela volta a aparecer com a conta nova; fecha para ver o calendário
  if (await page.getByRole("dialog").isVisible()) {
    await expect(page.getByRole("dialog")).toContainText(`Aluguel ${sufixo} (1/12)`);
    await page.keyboard.press("Escape");
  }

  // O dia mostra a conta; clicando, aparece na lista do dia com Pagar
  await page.getByRole("gridcell", { name: new RegExp(`^${data.replace(/\//g, "\\/")}: \\d+ conta`) }).click();
  await expect(page.getByRole("dialog")).toContainText(`Aluguel ${sufixo} (1/12)`);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Pagar" }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Contas a pagar com filtro de período só nesse dia: só a parcela 1/12
  await irPara(page, "Contas a pagar");
  await page.getByLabel("Período (vencimento)").selectOption("personalizado");
  await page.getByLabel("De", { exact: true }).fill(iso);
  await page.getByLabel("Até", { exact: true }).fill(iso);
  const lista = page.getByRole("list", { name: "Contas a pagar" });
  await expect(lista.getByRole("listitem").filter({ hasText: `Aluguel ${sufixo}` })).toHaveCount(1);
  await expect(lista).toContainText("(1/12)");
  await expect(page.getByText("Total no filtro:")).toBeVisible();
});

test("frete por km: painel ativa, loja calcula 2,00 + 1,50/km e o pedido grava a taxa", async ({ page, browser, request }) => {
  await entrar(page);
  await irPara(page, "Entrega");
  await page.getByRole("radio", { name: /Por km rodado/ }).click();
  await expect(page.getByText("Frete: por km rodado")).toBeVisible();
  await page.getByLabel("Cidade padrão").fill("Itatiba - SP");
  await page.getByRole("button", { name: "Salvar frete por distância" }).click();
  await expect(page.getByText("Frete por distância salvo")).toBeVisible();

  const loja = await (await browser.newContext()).newPage();
  let url = "";
  await loja.context().route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (r) => {
    if (r.request().url().startsWith("https://wa.me/")) url = r.request().url();
    return r.fulfill({ status: 200, body: "ok" });
  });
  await abrirLoja(loja);
  await loja.getByRole("button", { name: "Adicionar Gin London Dry 750 ml" }).click();
  await loja.getByRole("button", { name: /Ver carrinho/ }).click();
  await loja.getByRole("button", { name: "Finalizar pedido" }).click();
  await loja.getByLabel("Nome").fill("Cliente Km");
  await loja.getByLabel("WhatsApp / telefone").fill(`119${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`);
  // MAPS_FAKE=1 nos testes: "[km=6]" define a distância
  await loja.getByLabel("Rua e número").fill("Rua das Flores, 120 [km=6]");
  await loja.getByLabel("Bairro").fill("Centro");
  await expect(loja.getByLabel("Cidade")).toHaveValue("Itatiba - SP");
  await loja.getByRole("button", { name: /Calcular entrega/ }).click();
  await expect(loja.getByText(/6,0 km/).first()).toBeVisible();
  await expect(loja.getByText(/~15 min de carro/)).toBeVisible();
  // Mapa do trajeto (imagem da função mapa-frete) carregou de verdade
  const mapa = loja.getByRole("img", { name: /Mapa do trajeto da loja até/ });
  await expect(mapa).toBeVisible();
  await expect.poll(() => mapa.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(loja.getByRole("link", { name: "Abrir rota no Google Maps" })).toHaveAttribute("href", /google\.com\/maps\/dir\/.*travelmode=driving/);
  await expect(loja.getByTestId("total")).toHaveText("R$ 130,90"); // 119,90 + 2,00 + 6 × 1,50
  // Mudou o endereço depois do cálculo: precisa calcular de novo
  await loja.getByLabel("Bairro").fill("Outro");
  await expect(loja.getByRole("button", { name: /Calcular entrega/ })).toBeVisible();
  // Voltou ao mesmo endereço: a cotação anterior volta a valer
  await loja.getByLabel("Bairro").fill("Centro");
  await expect(loja.getByTestId("total")).toHaveText("R$ 130,90");
  await loja.getByRole("dialog").getByRole("radio", { name: "Pix" }).check({ force: true });
  await loja.getByRole("button", { name: "Enviar pedido pelo WhatsApp" }).click();
  await expect.poll(() => url, { timeout: 15_000 }).toContain("wa.me");
  const texto = new URL(url).searchParams.get("text") ?? "";
  expect(texto).toContain("Taxa de entrega (6,0 km): R$ 11,00");
  expect(texto).toMatch(/#\d+/);

  // Cotação não pode ser criada nem lida pelo visitante
  const urlSb = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const h = { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json" };
  const forjada = await request.post(`${urlSb}/rest/v1/cotacoes_frete`, { headers: h, data: { endereco: "x", endereco_formatado: "x", km: 0, taxa: 0 } });
  expect([401, 403]).toContain(forjada.status());

  // Volta para regiões (outros testes usam)
  await page.getByRole("radio", { name: /Por região/ }).click();
  await expect(page.getByText("Frete: por região")).toBeVisible();
});

test("relatórios mostram as vendas do período", async ({ page }) => {
  await entrar(page);
  await page.goto("/admin/relatorios");
  await page.getByRole("button", { name: "Hoje" }).click();
  await expect(page.getByText("Faturamento", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mais vendidos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Por origem" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Balcão");
});

test("usuários: admin cadastra operador; operador só usa Pedidos e PDV", async ({ page, browser }) => {
  const emailOperador = `operador.${Date.now()}@adega.local`;
  await entrar(page);
  await irPara(page, "Usuários");
  await expect(page.getByRole("heading", { name: "Usuários" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Usuários do painel" })).toContainText("(você)");

  await page.getByRole("button", { name: "Novo usuário" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Nome").fill("Maria do Caixa");
  await form.getByLabel("E-mail (é o login)").fill(emailOperador);
  await expect(form.getByRole("radio", { name: /Operador/ })).toBeChecked();
  await form.getByLabel("Senha inicial").fill("curta");
  await form.getByRole("button", { name: "Cadastrar" }).click();
  await expect(form.getByRole("alert")).toContainText("pelo menos 8");
  await form.getByLabel("Senha inicial").fill("Operador123");
  await form.getByRole("button", { name: "Cadastrar" }).click();
  await expect(form).toBeHidden();
  const linha = page.getByRole("listitem").filter({ hasText: emailOperador });
  await expect(linha).toContainText("Maria do Caixa");
  await expect(linha).toContainText("Operador");
  await expect(linha).toContainText("Ainda não entrou");

  // O operador entra e só vê Pedidos e PDV
  const op = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  await op.goto("/admin/login");
  await op.getByLabel("E-mail").fill(emailOperador);
  await op.getByLabel("Senha").fill("Operador123");
  await op.getByRole("button", { name: "Entrar" }).click();
  await expect(op.getByRole("heading", { name: "Pedidos" })).toBeVisible();
  const menu = op.getByRole("navigation", { name: "Painel" }).first();
  await expect(menu.getByRole("link", { name: "PDV", exact: true })).toBeVisible();
  for (const tela of ["Produtos", "Relatórios", "Estoque", "Contas a pagar", "Configurações", "Usuários"]) {
    await expect(menu.getByRole("link", { name: tela, exact: true })).toHaveCount(0);
  }
  await expect(op.getByText("Operador", { exact: true })).toBeVisible();
  // Endereço digitado direto: tela bloqueada (e o banco não entrega os dados)
  await op.goto("/admin/financeiro");
  await expect(op.getByRole("heading", { name: "Sem permissão" })).toBeVisible();
  await op.goto("/admin/usuarios");
  await expect(op.getByRole("heading", { name: "Sem permissão" })).toBeVisible();

  // PDV: abre o caixa, vende e fecha
  await op.goto("/admin/pdv");
  await op.getByLabel("Troco inicial (R$)").fill("20");
  await op.getByRole("button", { name: "Abrir caixa" }).click();
  await expect(op.getByText("Caixa aberto. Boas vendas!")).toBeVisible();
  await op.getByRole("button", { name: "Vender IPA 473 ml" }).click();
  const venda = op.getByRole("complementary");
  await venda.getByRole("button", { name: "Ir para pagamento", exact: true }).click();
  await venda.getByRole("button", { name: /^Finalizar/ }).click();
  const cupom = op.getByRole("dialog", { name: /Venda #/ });
  await expect(cupom).toContainText("IPA 473 ml");
  await cupom.getByRole("button", { name: "Nova venda" }).click();
  await op.getByRole("button", { name: "Fechar caixa" }).click();
  const fechar = op.getByRole("dialog", { name: "Fechar caixa" });
  await fechar.getByLabel("Dinheiro contado na gaveta (R$)").fill("20");
  await fechar.getByRole("button", { name: "Fechar caixa" }).click();
  await expect(op.getByText(/Caixa fechado/).first()).toBeVisible();
  await op.context().close();

  // Admin promove, troca a senha e tira o acesso
  await page.reload();
  await linha.getByRole("button", { name: /Trocar a senha/ }).click();
  await page.getByRole("dialog").getByLabel("Nova senha").fill("NovaSenha456");
  await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText(/Senha de Maria do Caixa trocada/)).toBeVisible();
  await expect(linha).not.toContainText("Ainda não entrou");
  await linha.getByRole("button", { name: /Tirar o acesso/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Tirar acesso" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: emailOperador })).toHaveCount(0);
});

test("maquininhas e taxa do Pix: cadastro, PDV mostra quanto a loja recebe e o relatório desconta a tarifa", async ({ browser }) => {
  const sufixo = Date.now().toString(36).slice(-4).toUpperCase();
  const maquininha = `Stone ${sufixo}`;
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  await entrar(page);
  await page.goto("/admin/loja");
  await page.getByRole("button", { name: "Adicionar maquininha" }).click();
  const form = page.getByRole("form", { name: "Maquininha" });
  await form.getByLabel("Nome da maquininha").fill(maquininha);
  await form.getByLabel("Taxa no débito (%)").fill("2");
  await form.getByLabel("Taxa no crédito (%)").fill("10");
  await expect(form.getByText("Venda de R$ 100,00 → loja recebe R$ 98,00")).toBeVisible();
  await expect(form.getByText("Venda de R$ 100,00 → loja recebe R$ 90,00")).toBeVisible();
  const padrao = form.getByRole("switch", { name: "Padrão no PDV" });
  if ((await padrao.getAttribute("aria-checked")) !== "true") await padrao.click();
  await expect(form.getByRole("switch", { name: "Padrão no site" })).toBeVisible();
  await form.getByRole("button", { name: "Salvar maquininha" }).click();
  await expect(page.getByText(`Maquininha ${maquininha} salva`)).toBeVisible();
  const linha = page.getByRole("list", { name: "Maquininhas" }).getByRole("listitem").filter({ hasText: maquininha });
  await expect(linha).toContainText("Padrão PDV");
  await expect(linha).toContainText("Débito 2% · Crédito 10%");
  await expect(linha).toContainText("débito recebe R$ 98,00 · crédito recebe R$ 90,00");
  await page.getByLabel("Taxa do Pix (%)").fill("1");
  await page.getByRole("button", { name: "Salvar taxa do Pix" }).click();
  await expect(page.getByText("Taxa do Pix: 1%")).toBeVisible();

  // PDV: a maquininha padrão já vem escolhida; débito 2% → R$ 14,60, crédito 10% → R$ 13,41
  await page.goto("/admin/pdv");
  await page.getByLabel("Troco inicial (R$)").fill("0");
  await page.getByRole("button", { name: "Abrir caixa" }).click();
  await expect(page.getByText("Caixa aberto. Boas vendas!")).toBeVisible();
  await page.getByRole("button", { name: "Vender IPA 473 ml" }).click();
  const venda = page.getByRole("complementary");
  await venda.getByRole("button", { name: "Ir para pagamento", exact: true }).click();
  await venda.getByRole("radio", { name: "Pix" }).click();
  await expect(venda.getByTestId("pdv-tarifa")).toContainText("Tarifa do Pix (1%): − R$ 0,15");
  await expect(venda.getByTestId("pdv-tarifa")).toContainText("A loja recebe R$ 14,75");
  await venda.getByRole("radio", { name: "Cartão" }).click();
  await expect(venda.getByLabel("Maquininha").locator("option:checked")).toHaveText(maquininha);
  await expect(venda.getByText("Escolha débito ou crédito.")).toBeVisible();
  await expect(venda.getByRole("button", { name: "Finalizar · R$ 14,90" })).toBeDisabled();
  await venda.getByRole("radio", { name: /^Débito/ }).click();
  await expect(venda.getByTestId("pdv-tarifa")).toContainText(`Tarifa ${maquininha} débito (2%): − R$ 0,30`);
  await expect(venda.getByTestId("pdv-tarifa")).toContainText("A loja recebe R$ 14,60");
  await venda.getByRole("radio", { name: /^Crédito/ }).click();
  await expect(venda.getByTestId("pdv-tarifa")).toContainText(`Tarifa ${maquininha} crédito (10%): − R$ 1,49`);
  await expect(venda.getByTestId("pdv-tarifa")).toContainText("A loja recebe R$ 13,41");
  await venda.getByRole("radio", { name: "Dinheiro" }).click();
  await expect(venda.getByTestId("pdv-tarifa")).toHaveCount(0);
  await venda.getByRole("radio", { name: "Cartão" }).click();
  await venda.getByRole("button", { name: "Finalizar · R$ 14,90" }).click();
  const cupom = page.getByRole("dialog", { name: /Venda #/ });
  await expect(cupom).toContainText("IPA 473 ml");
  await expect(cupom).not.toContainText("Tarifa");
  await cupom.getByRole("button", { name: "Nova venda" }).click();
  await page.getByRole("button", { name: "Fechar caixa" }).click();
  const fechar = page.getByRole("dialog", { name: "Fechar caixa" });
  await fechar.getByLabel("Dinheiro contado na gaveta (R$)").fill("0");
  await fechar.getByRole("button", { name: "Fechar caixa" }).click();
  await expect(page.getByText(/Caixa fechado/).first()).toBeVisible();

  // Relatório: a tarifa aparece e sai do lucro
  await page.goto("/admin/relatorios");
  await page.getByRole("button", { name: "Hoje" }).click();
  await expect(page.getByText("Tarifas (maquininhas e Pix)")).toBeVisible();
  await expect(page.getByText(`${maquininha} (crédito) · 1 venda`)).toBeVisible();

  // Limpa: sem taxa do Pix e sem a maquininha (as vendas guardam a tarifa)
  await page.goto("/admin/loja");
  await expect(page.getByLabel("Taxa do Pix (%)")).toHaveValue("1");
  await page.getByLabel("Taxa do Pix (%)").fill("0");
  await page.getByRole("button", { name: "Salvar taxa do Pix" }).click();
  await expect(page.getByText("Pix sem taxa")).toBeVisible();
  await page.getByRole("button", { name: `Excluir ${maquininha}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByRole("list", { name: "Maquininhas" })).not.toContainText(maquininha);
  await page.context().close();
});

test("custo do kit é a soma dos componentes, sem digitar", async ({ page }) => {
  const sufixo = Date.now().toString(36).slice(-4).toUpperCase();
  await entrar(page);
  // Componente com custo R$ 1,50
  await page.goto("/admin/produtos/novo");
  const form = page.locator('[data-testid="cadastro-produto"]:visible');
  await form.getByLabel("Nome", { exact: true }).fill(`Gelo QA ${sufixo}`);
  await form.getByLabel("Preço (R$)").fill("2,00");
  await form.getByLabel("Custo (R$)").fill("1,50");
  await form.getByLabel("Controlar estoque").check();
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto criado")).toBeVisible();

  // Kit com 4 desse componente → custo automático R$ 6,00
  await page.goto("/admin/produtos/novo");
  await form.getByLabel("Nome", { exact: true }).fill(`Kit Gelo ${sufixo}`);
  await form.getByLabel("Tipo de produto").selectOption("kit");
  await form.getByLabel("Preço (R$)").fill("10,00");
  await expect(form.getByLabel("Custo (R$)")).toHaveCount(0);
  await expect(form.getByTestId("custo-kit")).toHaveText("—");
  await form.getByRole("tab", { name: "Composição", exact: true }).click();
  await form.getByLabel("Pesquisar componente 1").fill(`Gelo QA ${sufixo}`);
  await form.locator("#kit-componente-0").selectOption({ label: `Gelo QA ${sufixo} · un` });
  await form.getByLabel("Consumo (un)").fill("4");
  await expect(form.getByText("Custo do kit: R$ 6,00")).toBeVisible();
  await form.getByRole("tab", { name: "Dados gerais", exact: true }).click();
  await expect(form.getByTestId("custo-kit")).toHaveText("6,00");
  await expect(form.getByText(/Soma dos componentes/)).toBeVisible();
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto criado")).toBeVisible();

  await page.goto("/admin/produtos");
  await page.getByLabel("Buscar produto").fill(`Kit Gelo ${sufixo}`);
  const tabela = page.getByRole("region", { name: "Tabela de produtos" });
  await expect(tabela.locator("tbody tr")).toHaveCount(1);
  await expect(tabela.locator("tbody tr").first()).toContainText("R$ 6,00");
});

test("exportar catálogo: folha com os produtos da loja, opções, planilha e impressão", async ({ page }) => {
  await entrar(page);
  await irPara(page, "Exportar catálogo");
  const folha = page.getByTestId("folha-catalogo");
  const ipa = folha.getByRole("article", { name: "IPA 473 ml" });
  await expect(ipa).toContainText("R$ 14,90");

  await page.getByRole("switch", { name: "Mostrar preços" }).click();
  await expect(ipa).not.toContainText("R$ 14,90");
  await page.getByRole("switch", { name: "Mostrar preços" }).click();
  await page.getByRole("checkbox", { name: "Cervejas", exact: true }).uncheck();
  await expect(ipa).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Cervejas", exact: true }).check();
  await expect(ipa).toBeVisible();

  const [arquivo] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar planilha" }).click()]);
  expect(arquivo.suggestedFilename()).toMatch(/^catalogo-adega011-\d{4}-\d{2}-\d{2}\.csv$/);
  const conteudo = (await import("node:fs")).readFileSync(await arquivo.path(), "utf8");
  expect(conteudo.startsWith("﻿Categoria;Subcategoria;Produto;")).toBe(true);
  expect(conteudo).toContain("Cervejas;;IPA 473 ml;;");
  expect(conteudo).toContain(";14,90;Sim;");

  // Imprimir/PDF: espera as fotos e chama a impressão do navegador
  await page.evaluate(() => { (window as unknown as { impresso: boolean }).impresso = false; window.print = () => { (window as unknown as { impresso: boolean }).impresso = true; }; });
  await page.getByRole("button", { name: "Salvar PDF / imprimir" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { impresso: boolean }).impresso)).toBe(true);
});

test("catálogo: descrição opcional, exportar folha para o Figma, reimportar o design e voltar ao padrão", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  await entrar(page);
  await page.goto("/admin/exportar-catalogo");
  const folha = page.getByTestId("folha-catalogo");
  await expect(folha.getByRole("article", { name: "IPA 473 ml" })).toBeVisible();
  const descricoes = folha.getByTestId("descricao-produto");
  expect(await descricoes.count()).toBeGreaterThan(0);
  await page.getByRole("switch", { name: "Mostrar descrição" }).click();
  await expect(descricoes).toHaveCount(0);

  // Exportar: uma folha A4 em SVG com as camadas nomeadas
  const [arquivo] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar para o Figma (1 folha)" }).click()]);
  expect(arquivo.suggestedFilename()).toBe("modelo-catalogo-adega011.svg");
  const svg = (await import("node:fs")).readFileSync(await arquivo.path(), "utf8");
  expect(svg).toContain('width="794" height="1123"');
  for (const camada of ["Fundo da página", "Logo", "Título", "Faixa da categoria", "Fundo do cartão", "Nome do produto", "Preço"]) expect(svg).toContain(`id="${camada}"`);
  expect(svg).not.toContain('id="Descrição"');
  expect(svg).toContain("data:image/png;base64,");

  // Reimportar: a função lê a folha (em teste, o documento vai junto do pedido)
  const documento = { name: "Frame", type: "FRAME", children: [
    { name: "Faixa da categoria", type: "VECTOR", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0.5, a: 1 } }] },
    { name: "Preço", type: "TEXT", fills: [{ type: "SOLID", color: { r: 0, g: 0.5, b: 0, a: 1 } }], style: { fontFamily: "Montserrat", fontWeight: 800, fontSize: 18 } },
  ] };
  await page.route("**/functions/v1/catalogo-figma", async (rota) => {
    if (rota.request().method() !== "POST") return rota.continue();
    await rota.continue({ postData: JSON.stringify({ ...rota.request().postDataJSON(), documento }) });
  });
  await page.getByLabel("Link da folha no Figma").fill("https://www.figma.com/design/eC9GXWBGSP7hMPZGTUxeBV/Catalogo?node-id=1-2");
  await page.getByRole("button", { name: "Importar" }).click();
  await expect(page.getByTestId("design-importado")).toContainText("Li 2 de 19 camadas");
  const faixa = folha.getByRole("region", { name: "Cervejas" }).getByRole("heading", { level: 3 });
  await expect(faixa).toHaveCSS("background-color", "rgb(0, 0, 128)");
  await expect(folha.getByRole("article", { name: "IPA 473 ml" }).getByText("R$ 14,90")).toHaveCSS("color", "rgb(0, 128, 0)");

  await page.getByRole("button", { name: "Salvar e usar este design" }).click();
  await expect(page.getByText("O catálogo agora usa o design do Figma")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: "Design do Figma" })).toHaveAttribute("aria-checked", "true");
  await expect(folha.getByRole("region", { name: "Cervejas" }).getByRole("heading", { level: 3 })).toHaveCSS("background-color", "rgb(0, 0, 128)");

  // Usar padrão
  await page.getByRole("radio", { name: "Design padrão" }).click();
  await expect(page.getByText("O catálogo voltou ao design padrão")).toBeVisible();
  await expect(folha.getByRole("region", { name: "Cervejas" }).getByRole("heading", { level: 3 })).toHaveCSS("background-color", "rgb(23, 23, 23)");
  await page.context().close();
});

test("financeiro: conta padrão do caixa recebe as vendas em dinheiro do PDV", async ({ browser }) => {
  const sufixo = Date.now().toString(36).slice(-4).toUpperCase();
  const gaveta = `Gaveta ${sufixo}`;
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  await entrar(page);
  await page.goto("/admin/financeiro");
  await page.getByRole("button", { name: "Nova conta" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Nome da conta / local").fill(gaveta);
  await form.getByLabel("Tipo").selectOption("caixa");
  await form.getByRole("checkbox", { name: /Padrão do caixa/ }).check();
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Financeiro atualizado")).toBeVisible();
  const linha = page.getByRole("row").filter({ hasText: gaveta });
  await expect(linha).toContainText("Padrão do caixa · dinheiro");
  await expect(linha).toContainText("R$ 0,00");
  await expect(page.getByText(`as pagas em dinheiro, em ${gaveta}`)).toBeVisible();

  // Venda em dinheiro no PDV → entra na conta do caixa
  await page.goto("/admin/pdv");
  await page.getByLabel("Troco inicial (R$)").fill("0");
  await page.getByRole("button", { name: "Abrir caixa" }).click();
  await expect(page.getByText("Caixa aberto. Boas vendas!")).toBeVisible();
  await page.getByRole("button", { name: "Vender IPA 473 ml" }).click();
  const venda = page.getByRole("complementary", { name: "Venda atual" });
  await venda.getByRole("button", { name: "Ir para pagamento", exact: true }).click();
  await venda.getByRole("button", { name: "Finalizar · R$ 14,90" }).click();
  await page.getByRole("dialog", { name: /Venda #/ }).getByRole("button", { name: "Nova venda" }).click();
  await page.getByRole("button", { name: "Fechar caixa" }).click();
  const fechar = page.getByRole("dialog", { name: "Fechar caixa" });
  await fechar.getByLabel("Dinheiro contado na gaveta (R$)").fill("14,90");
  await fechar.getByRole("button", { name: "Fechar caixa" }).click();
  await expect(page.getByText(/Caixa fechado/).first()).toBeVisible();

  await page.goto("/admin/financeiro");
  await expect(page.getByRole("row").filter({ hasText: gaveta })).toContainText("R$ 14,90");

  // Desmarca para não mudar o destino nos outros testes
  await page.getByRole("row").filter({ hasText: gaveta }).getByRole("button", { name: "Editar" }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: /Padrão do caixa/ }).uncheck();
  await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("row").filter({ hasText: gaveta })).not.toContainText("Padrão do caixa");
  await page.context().close();
});

test("caixa: sangria sai da conta do caixa e o reforço vem da conta escolhida", async ({ browser }) => {
  const sufixo = Date.now().toString(36).slice(-4).toUpperCase();
  const gaveta = `Gaveta ${sufixo}`;
  const reserva = `Reserva ${sufixo}`;
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  await entrar(page);
  await page.goto("/admin/financeiro");
  for (const [nome, caixa, saldo] of [[gaveta, true, "100"], [reserva, false, "50"]] as const) {
    await page.getByRole("button", { name: "Nova conta" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Nome da conta / local").fill(nome);
    await form.getByLabel("Tipo").selectOption("caixa");
    await form.getByLabel("Saldo que já existe nesta conta (R$)").fill(saldo);
    if (caixa) await form.getByRole("checkbox", { name: /Padrão do caixa/ }).check();
    await form.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByRole("row").filter({ hasText: nome })).toBeVisible();
  }

  await page.goto("/admin/pdv");
  await page.getByLabel("Troco inicial (R$)").fill("0");
  await page.getByRole("button", { name: "Abrir caixa" }).click();
  await expect(page.getByText("Caixa aberto. Boas vendas!")).toBeVisible();

  // Sangria: sai da gaveta
  await page.getByRole("button", { name: "Movimentar" }).click();
  let mov = page.getByRole("dialog", { name: "Movimentar caixa" });
  await mov.getByLabel("Valor (R$)").fill("30");
  await expect(mov.getByLabel("Para onde vai o dinheiro")).toHaveValue("");
  await expect(mov.getByText(`Sai de ${gaveta}.`)).toBeVisible();
  await mov.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Sangria de R$ 30,00 registrado")).toBeVisible();

  // Reforço: escolhe a reserva
  await page.getByRole("button", { name: "Movimentar" }).click();
  mov = page.getByRole("dialog", { name: "Movimentar caixa" });
  await mov.getByRole("radio", { name: "Reforço" }).click();
  await mov.getByLabel("Valor (R$)").fill("20");
  await mov.getByLabel("De onde vem o dinheiro").selectOption({ label: reserva });
  await expect(mov.getByText(`Entra em ${gaveta}.`)).toBeVisible();
  await mov.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Reforço de R$ 20,00 registrado")).toBeVisible();

  await page.getByRole("button", { name: "Fechar caixa" }).click();
  const fechar = page.getByRole("dialog", { name: "Fechar caixa" });
  await fechar.getByLabel("Dinheiro contado na gaveta (R$)").fill("0");
  await fechar.getByRole("button", { name: "Fechar caixa" }).click();
  await expect(page.getByText(/Caixa fechado/).first()).toBeVisible();

  // Financeiro: gaveta 100 − 30 + 20 = 90; reserva 50 − 20 = 30
  await page.goto("/admin/financeiro");
  await expect(page.getByRole("row").filter({ hasText: gaveta })).toContainText("R$ 90,00");
  await expect(page.getByRole("row").filter({ hasText: reserva })).toContainText("R$ 30,00");
  await page.getByRole("button", { name: "Movimentações" }).click();
  await expect(page.getByText(`Reforço do caixa (de ${reserva})`)).toBeVisible();
  await expect(page.getByText("Sangria do caixa").first()).toBeVisible();
  await page.getByRole("button", { name: "Contas e saldos" }).click();

  // Tira a marcação para não mexer nos outros testes
  await page.getByRole("row").filter({ hasText: gaveta }).getByRole("button", { name: "Editar" }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: /Padrão do caixa/ }).uncheck();
  await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("row").filter({ hasText: gaveta })).not.toContainText("Padrão do caixa");
  await page.context().close();
});
