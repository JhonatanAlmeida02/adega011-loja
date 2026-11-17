/**
 * Ponta a ponta no navegador: recebimento → armazenagem → pedido → reserva → separação →
 * conferência → volume → remessa → despacho, com dois operadores e verificação de acesso.
 */
import { expect, test, type Page } from "@playwright/test";
import { admin, conferirInvariantes, criarCenario, type Cenario } from "../wms/helpers";

const AUTH = `http://127.0.0.1:${process.env.PORTA_AUTH_FALSO ?? 54399}`;
let s: Cenario;
const SENHA = "SenhaDeTeste123";

test.beforeAll(async () => {
  s = await criarCenario({ fiscal: false });
  const usuarios = ([[s.u.supervisor, "aal2"], [s.u.separador, "aal1"], [s.u.semArmazem, "aal1"]] as const)
    .map(([u, aal]) => ({ id: u.userId, email: `${u.nome}@e2e.test`, senha: SENHA, aal }));
  const r = await fetch(`${AUTH}/__teste/usuarios`, { method: "POST", body: JSON.stringify(usuarios) });
  expect(r.status).toBe(204);
});

async function entrar(page: Page, nome: string) {
  await page.goto("/wms/login");
  await page.getByLabel("E-mail", { exact: true }).fill(`${nome}@e2e.test`);
  await page.getByLabel("Senha", { exact: true }).fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible({ timeout: 30_000 });
}

async function sair(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await page.waitForURL(/\/wms\/login/);
}

async function ler(page: Page, valor: string, campo = "#leitura") {
  await page.locator(campo).fill(valor);
  await page.locator(campo).press("Enter");
}

test("fluxo completo do armazém pela interface", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await entrar(page, "supervisor");

  // Recebimento: previsão manual + conferência por leitura + confirmação
  await page.getByRole("link", { name: "Recebimento", exact: true }).click();
  await page.getByLabel("Documento (NF, romaneio)", { exact: true }).fill("NF-E2E-1");
  await page.getByLabel("Fornecedor", { exact: true }).fill("Distribuidora E2E");
  await page.getByLabel("SKU, GTIN ou descrição", { exact: true }).fill(s.skus.simples);
  await page.getByLabel("Qtd (base)", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await page.getByRole("button", { name: "Criar previsão" }).click();
  await expect(page.getByRole("heading", { name: "Recebimento NF-E2E-1" })).toBeVisible();
  await page.getByLabel("Quantidade (na unidade lida)", { exact: true }).fill("1");
  await ler(page, s.skus.caixa); // caixa com fator 12
  await expect(page.getByText("12 un base conferidas")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar recebimento conferido" }).click();
  await expect(page.getByText("Confirmado: received.")).toBeVisible();

  // Armazenagem: origem → produto → destino
  await page.getByRole("link", { name: "Armazenagem", exact: true }).click();
  await page.getByRole("button", { name: "Executar" }).first().click();
  await ler(page, "RECEB");
  await ler(page, s.skus.simples);
  await ler(page, "A-01");
  await expect(page.getByText("Armazenado em A-01.")).toBeVisible();

  // Pedido manual + reserva
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByLabel("Número", { exact: true }).fill("PED-E2E-1");
  await page.getByLabel("Cliente", { exact: true }).fill("Cliente E2E");
  await page.getByLabel("SKU, GTIN ou descrição", { exact: true }).fill(s.skus.simples);
  await page.getByLabel("Qtd (base)", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await page.getByRole("button", { name: "Criar pedido" }).click();
  await expect(page.getByRole("heading", { name: "Pedido PED-E2E-1" })).toBeVisible();
  await page.getByRole("button", { name: "Reservar e criar tarefas" }).click();
  await expect(page.getByText("Reservado e tarefas criadas.")).toBeVisible();
  await sair(page);

  // Separador: só vê o que pode; pega a tarefa e separa por leitura
  await entrar(page, "separador");
  await expect(page.getByRole("link", { name: "Conferência", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Administração", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Separação", exact: true }).click();
  await page.getByRole("button", { name: "Pegar" }).first().click();
  await expect(page.getByText("A-01", { exact: true })).toBeVisible();
  await ler(page, "B-01");
  await expect(page.getByText("diferente do indicado")).toBeVisible();
  await ler(page, "A-01");
  await page.getByLabel("Quantidade (na unidade do código lido)", { exact: true }).fill("3");
  await ler(page, s.skus.gtin);
  await expect(page.getByText("3 separado(s)")).toBeVisible();
  await page.getByRole("button", { name: "Encerrar tarefa" }).click();
  await page.waitForURL(/\/wms\/separacao$/);
  // Autorização no servidor: separador não confere nem despacha, mesmo chamando a API direto
  const negado = await page.evaluate(async (wh) => {
    const r = await fetch("/api/wms/shipments", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ warehouse_id: wh, carrier: "x" }) });
    return r.status;
  }, s.wh);
  expect(negado).toBe(403);
  await sair(page);

  // Supervisor: conferência, volume, remessa e despacho
  await entrar(page, "supervisor");
  await page.getByRole("link", { name: "Conferência", exact: true }).click();
  await page.getByRole("cell", { name: "PED-E2E-1" }).click();
  await page.getByRole("button", { name: "Iniciar conferência" }).click();
  await page.getByRole("button", { name: "Abrir volume" }).click();
  await page.getByLabel("Quantidade (unidade lida)", { exact: true }).fill("3");
  await ler(page, s.skus.simples);
  await expect(page.getByText("Faltam 0 desta linha.")).toBeVisible();
  await page.getByRole("button", { name: "Fechar volume" }).click();
  await page.getByRole("button", { name: "Concluir conferência" }).click();
  await expect(page.getByText("pedido embalado")).toBeVisible();
  const etiqueta = (await admin((c) => c.query("select p.label_code from wms.packages p join wms.orders o on o.id = p.order_id where o.number = 'PED-E2E-1' and o.warehouse_id = $1", [s.wh]))).rows[0].label_code;

  await page.getByRole("link", { name: "Expedição", exact: true }).click();
  await page.getByLabel("Transportadora", { exact: true }).fill("Transportadora E2E");
  await page.getByRole("button", { name: "Criar remessa" }).click();
  await expect(page.getByRole("heading", { name: /Remessa ROM-/ })).toBeVisible();
  await page.getByRole("button", { name: "Incluir" }).click();
  await expect(page.getByText("Pedido incluído.")).toBeVisible();
  await ler(page, etiqueta, "#vol");
  await expect(page.getByText("Faltam 0.")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar despacho (saída física)" }).click();
  await expect(page.getByText("Saída confirmada no WMS.")).toBeVisible();

  const pedido = (await admin((c) => c.query("select status from wms.orders where number = 'PED-E2E-1' and warehouse_id = $1", [s.wh]))).rows[0];
  expect(pedido.status).toBe("dispatched");
  const saldo = (await admin((c) => c.query("select coalesce(sum(quantity),0)::float q from wms.stock_balances where warehouse_id = $1 and product_id = $2", [s.wh, s.p.simples]))).rows[0].q;
  expect(saldo).toBe(9);
  await conferirInvariantes(s.wh);
});

test("usuário sem armazém não vê dados nem por ID direto", async ({ page }) => {
  await page.goto("/wms/login");
  await page.getByLabel("E-mail", { exact: true }).fill("sem-armazem@e2e.test");
  await page.getByLabel("Senha", { exact: true }).fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("não tem acesso a nenhum armazém")).toBeVisible({ timeout: 30_000 });
  const r = await page.evaluate(async (wh) => (await fetch(`/api/wms/orders?warehouse_id=${wh}`)).json(), s.wh);
  expect(r).toEqual([]);
  const sem = await page.evaluate(async () => (await fetch("/api/wms/me", { headers: { Authorization: "" }, credentials: "omit" })).status);
  expect(sem).toBe(401);
});
