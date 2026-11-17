/**
 * Testes unitários do WMS (sem banco): scanner, cifragem, roteamento, adaptador V3 com
 * respostas simuladas no formato documentado, OAuth e backoff.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { cifrar, decifrar } from "../../src/lib/wms/integracoes/cripto";
import { OLIST_AUTH_URL, urlAutorizacao } from "../../src/lib/wms/integracoes/oauth-olist";
import { OlistV3Adapter } from "../../src/lib/wms/integracoes/olist-v3";
import { ErroCapacidade, ErroErp } from "../../src/lib/wms/integracoes/tipos";
import { casarRota, COMANDOS, CONSULTAS } from "../../src/lib/wms/rotas";
import { gtinValido, interpretarGs1, interpretarLeitura, limparLeitura } from "../../src/lib/wms/scanner";
import { podeTransitar } from "../../src/lib/wms/estados";
import { atrasoBackoff } from "../../src/lib/wms/worker/processador";

test("scanner preserva zeros à esquerda e remove só o terminador", () => {
  assert.equal(limparLeitura("0789000000012\r\n"), "0789000000012");
  assert.equal(limparLeitura("00012\t", "tab"), "00012");
  assert.equal(interpretarLeitura("0789000000012\n").codigo, "0789000000012");
});

test("dígito verificador GTIN", () => {
  assert.equal(gtinValido("7891000315507"), true);
  assert.equal(gtinValido("7891000315508"), false);
  assert.equal(gtinValido("ABC"), false);
});

test("GS1 com e sem parênteses: GTIN, lote, validade e série", () => {
  assert.deepEqual(interpretarGs1("(01)07891000315507(10)L123(17)271231(21)SN9"),
    { gtin: "7891000315507", lote: "L123", validade: "2027-12-31", serie: "SN9" });
  assert.deepEqual(interpretarGs1("01078910003155071727020010ABC\u001d21S1"),
    { gtin: "7891000315507", validade: "2027-02-28", lote: "ABC", serie: "S1" }, "dia 00 = último dia do mês");
  assert.equal(interpretarGs1("0789000000012"), null);
});

test("cifragem AES-GCM vinculada à conexão e com rotação de chave", () => {
  const k1 = randomBytes(32).toString("base64");
  const k2 = randomBytes(32).toString("base64");
  const env1 = { INTEGRATION_ENCRYPTION_KEY: k1, INTEGRATION_ENCRYPTION_KEY_VERSION: "1" } as unknown as NodeJS.ProcessEnv;
  const c = cifrar("segredo", "conn-a", env1);
  assert.equal(decifrar(c.ciphertext, "conn-a", env1), "segredo");
  assert.throws(() => decifrar(c.ciphertext, "conn-b", env1), "outro contexto não decifra");
  const env2 = { INTEGRATION_ENCRYPTION_KEY: k2, INTEGRATION_ENCRYPTION_KEY_VERSION: "2", INTEGRATION_ENCRYPTION_KEY_PREVIOUS: `1:${k1}` } as unknown as NodeJS.ProcessEnv;
  assert.equal(decifrar(c.ciphertext, "conn-a", env2), "segredo", "chave anterior ainda lê");
  assert.ok(cifrar("x", "conn-a", env2).ciphertext.startsWith("v2."));
  assert.ok(!c.ciphertext.includes("segredo"));
});

test("roteamento da API: caminhos e IDs validados", () => {
  const u = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";
  assert.equal(casarRota(COMANDOS, ["receipts", u, "confirm"])?.def.fn, "confirm_receipt");
  assert.equal(casarRota(COMANDOS, ["receipts", "1 or 1=1", "confirm"]), null);
  assert.equal(casarRota(CONSULTAS, ["orders", u])?.params.id, u);
  const nomes = new Set(COMANDOS.map((c) => c.fn));
  for (const n of nomes) assert.match(n, /^[a-z_]+$/);
});

test("estados: transições permitidas e proibidas", () => {
  assert.equal(podeTransitar("order", "picking", "picked"), true);
  assert.equal(podeTransitar("order", "dispatched", "cancelled"), false);
  assert.equal(podeTransitar("order", "awaiting_allocation", "dispatched"), false);
});

type Resp = { status: number; body?: unknown; headers?: Record<string, string> };
function fetchFalso(respostas: Record<string, Resp | (() => never)>, chamadas: { url: string; init?: RequestInit }[]): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    chamadas.push({ url: u, init });
    const chave = Object.keys(respostas).find((k) => u.includes(k));
    const r = chave ? respostas[chave] : { status: 404 };
    if (typeof r === "function") r();
    const rr = r as Resp;
    return new Response(rr.body === undefined ? "" : JSON.stringify(rr.body), { status: rr.status, headers: rr.headers });
  }) as typeof fetch;
}
const ctx = { connectionId: "c", accessToken: "tok" };

test("V3: produtos e pedido mapeados a partir do formato documentado", async () => {
  const chamadas: { url: string; init?: RequestInit }[] = [];
  const a = new OlistV3Adapter({ fetchImpl: fetchFalso({
    "/produtos?": { status: 200, body: { itens: [{ id: 10, sku: "0012", descricao: "Prod", situacao: "A", gtin: "07891000315507", unidade: "UN", dataAlteracao: "2026-11-10 10:00:00" }], paginacao: { limit: 100, offset: 0, total: 1 } },
      headers: { "X-RateLimit-Limit": "120", "X-RateLimit-Remaining": "100", "X-RateLimit-Reset": "5" } },
    "/pedidos/55": { status: 200, body: { id: 55, numeroPedido: 900, situacao: 3, deposito: { id: 501 }, cliente: { nome: "Fulano" },
      itens: [{ produto: { id: 10, sku: "0012" }, quantidade: 2 }], notaFiscal: { situacao: "6" }, dataLimiteDespacho: "2026-11-20" } },
  }, chamadas), situacoesNotaAutorizada: ["6"] });
  const p = await a.listarProdutos(ctx, 0);
  assert.deepEqual(p.itens[0], { external_id: "10", sku: "0012", description: "Prod", gtin: "07891000315507", unit: "UN", status: "active", external_version: "2026-11-10 10:00:00" });
  assert.equal(p.proximoOffset, null);
  assert.deepEqual(a.ultimoLimite(), { limite: 120, restante: 100, resetS: 5 });
  assert.equal((chamadas[0].init?.headers as Record<string, string>).Authorization, "Bearer tok");
  assert.match(chamadas[0].url, /^https:\/\/api\.tiny\.com\.br\/public-api\/v3\/produtos\?limit=100&offset=0$/);
  const ped = await a.obterPedido(ctx, "55");
  assert.equal(ped.erp_status, "3");
  assert.equal(ped.deposit_external_id, "501");
  assert.equal(ped.fiscal_status, "released");
  assert.deepEqual(ped.items, [{ external_item_id: "55:1", product_external_id: "10", quantity: 2 }]);
});

test("V3: resposta fora do contrato falha em vez de inventar", async () => {
  const a = new OlistV3Adapter({ fetchImpl: fetchFalso({ "/pedidos/1": { status: 200, body: { id: 1 } } }, []) });
  await assert.rejects(a.obterPedido(ctx, "1"), (e: unknown) => e instanceof ErroErp && e.codigo === "contract_mismatch");
});

test("V3: 429 respeita Retry-After; 401 pede reautorização; falha de rede em escrita é desconhecida", async () => {
  const a = new OlistV3Adapter({ escritaHabilitada: true, fetchImpl: fetchFalso({
    "/depositos": { status: 429, headers: { "Retry-After": "7" } },
    "/pedidos/2": { status: 401 },
    "/estoque/9": () => { throw new TypeError("fetch failed"); },
  }, []) });
  await assert.rejects(a.listarDepositos(ctx), (e: unknown) => e instanceof ErroErp && e.tipo === "limite" && e.retryAfterS === 7);
  await assert.rejects(a.obterPedido(ctx, "2"), (e: unknown) => e instanceof ErroErp && e.tipo === "autorizacao");
  await assert.rejects(a.lancarEstoque(ctx, { product_external_id: "9", deposit_external_id: "1", tipo: "S", quantidade: 1, observacoes: "x", precoUnitario: 1 }),
    (e: unknown) => e instanceof ErroErp && e.tipo === "desconhecido");
});

test("V3: sem escrita habilitada ou sem custo definido não envia; verificação indisponível", async () => {
  const chamadas: { url: string }[] = [];
  const l = { product_external_id: "9", deposit_external_id: "1", tipo: "S" as const, quantidade: 1, observacoes: "x", precoUnitario: null };
  const semEscrita = new OlistV3Adapter({ fetchImpl: fetchFalso({}, chamadas) });
  assert.equal(semEscrita.capacidades().has("lancar_estoque"), false);
  await assert.rejects(semEscrita.lancarEstoque(ctx, l), ErroCapacidade);
  const comEscrita = new OlistV3Adapter({ escritaHabilitada: true, fetchImpl: fetchFalso({}, chamadas) });
  await assert.rejects(comEscrita.lancarEstoque(ctx, l), ErroCapacidade);
  await assert.rejects(comEscrita.verificarLancamento(), ErroCapacidade);
  assert.equal(chamadas.length, 0, "nenhuma chamada HTTP");
  assert.throws(() => new OlistV3Adapter({ baseUrl: "http://inseguro" }));
});

test("OAuth: URL de autorização documentada, sem PKCE por padrão", () => {
  const u = new URL(urlAutorizacao({ clientId: "cid", clientSecret: "s", redirectUri: "https://wms.exemplo/api/integrations/olist/callback", pkce: false }, "st", "ver"));
  assert.equal(`${u.origin}${u.pathname}`, OLIST_AUTH_URL);
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("state"), "st");
  assert.equal(u.searchParams.get("code_challenge"), null);
});

test("backoff com jitter e Retry-After", () => {
  for (let i = 1; i < 6; i++) {
    const a = atrasoBackoff(i);
    assert.ok(a >= 15 * 2 ** (i - 1) * 0.5 && a <= 15 * 2 ** (i - 1));
  }
  assert.equal(atrasoBackoff(1, 600) >= 600, true);
  assert.ok(atrasoBackoff(30) <= 3600);
});
