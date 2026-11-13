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
  await page.getByRole("button", { name: "Mais" }).click();
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

  await irPara(page, "Loja");
  await page.getByRole("radio", { name: /Forçar fechada/ }).click();
  await expect(page.getByText("Modo: Forçar fechada")).toBeVisible();
  await loja.reload();
  await expect(loja.getByText("Fechado agora")).toBeVisible();

  // Restaura
  await page.getByRole("radio", { name: /Automático/ }).click();
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

  // Esgotou: a loja mostra esgotado
  const outra = await (await browser.newContext()).newPage();
  await abrirLoja(outra);
  await expect(outra.getByRole("article", { name: "Whisky 12 anos 1 L" })).toContainText("Esgotado");

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
  await expect(page.getByText("Faturamento", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mais vendidos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Por origem" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Balcão");
});
