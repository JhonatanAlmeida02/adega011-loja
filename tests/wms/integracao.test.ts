/**
 * Integração com o ERP via simulador (MockOlistAdapter) e worker real contra o PostgreSQL.
 * Não substitui a homologação com a conta Olist (pendente; ver docs/implementation-status.md).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, describe, test } from "node:test";
import { comoWorker, encerrarPoolWms, json, rpc } from "../../src/lib/wms/db";
import { cifrar } from "../../src/lib/wms/integracoes/cripto";
import { MockOlistAdapter } from "../../src/lib/wms/integracoes/mock-olist";
import type { ErpAdapter } from "../../src/lib/wms/integracoes/tipos";
import { obterToken, processarInbox, processarJob, processarOutbox, type Conexao, type DepsWorker } from "../../src/lib/wms/worker/processador";
import { admin, chamar, chave, criarCenario, darEntrada, falha, saldo, statusPedido, temBanco, uuid, type Cenario } from "./helpers";

after(() => encerrarPoolWms());

const env = { ...process.env, INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"), INTEGRATION_ENCRYPTION_KEY_VERSION: "1" };

async function conectar(s: Cenario, politica?: { saida: string; entrada: string }) {
  const c = await chamar<{ connection_id: string; webhook_ref: string }>(s.u.admin, "create_connection", s.org, "ERP simulado", "mock", chave());
  await chamar(s.u.admin, "update_connection", c.connection_id, ["3", "4"], ["2"], true, null);
  const mock = new MockOlistAdapter();
  const deps: DepsWorker = {
    owner: `teste-${uuid().slice(0, 6)}`,
    adapterPara: () => mock as ErpAdapter,
    limites: { leituraPorJanela: 1000, escritaPorJanela: 1000, janelaS: 60 },
    dormir: async () => undefined,
    env,
    log: () => undefined,
  };
  await chamar(s.u.admin, "request_sync_job", c.connection_id, "import_deposits", json({}));
  while (await processarJob(deps)) { /* processa a fila */ }
  await chamar(s.u.admin, "map_deposit", c.connection_id, "501", s.wh);
  if (politica) await chamar(s.u.admin, "set_stock_posting_policy", c.connection_id, s.wh, politica.saida, politica.entrada, true, "validado em teste");
  await chamar(s.u.admin, "request_sync_job", c.connection_id, "import_products", json({}));
  while (await processarJob(deps)) { /* paginado: 2 por página no simulador */ }
  // Configura controle de estoque dos produtos do ERP no WMS e dá entrada física
  const produtos = (await admin((x) => x.query(
    "select m.external_id, p.sku, p.id from wms.external_mappings m join wms.products p on p.id = m.internal_id where m.connection_id = $1 order by m.external_id",
    [c.connection_id]))).rows;
  return { ...c, mock, deps, produtos };
}

function pedidoMock(mock: MockOlistAdapter, id: string, situacao: string, itens: [string, number][]) {
  mock.estado.pedidos.set(id, {
    external_id: id, number: `V-${id}`, erp_status: situacao, deposit_external_id: "501", customer_name: "[SIMULADO] Cliente",
    fiscal_status: "released", ship_by: null,
    items: itens.map(([p, q], i) => ({ external_item_id: `${id}:${i + 1}`, product_external_id: p, quantity: q })),
  });
}

async function webhook(ref: string, dedup: string, tipo: string, id: string | null) {
  return comoWorker((c) => rpc<{ inbox_id: string | null; duplicate: boolean }>(c, "inbox_receive", [ref, dedup, tipo, id, json({ raw: true })]));
}

async function entradaProdutoErp(s: Cenario, produtoId: string, sku: string, qtd: number, local: string) {
  const r = await chamar<{ receipt_id: string }>(s.u.admin, "create_manual_receipt", s.wh, `NF-${uuid().slice(0, 8)}`, "F",
    json([{ product_id: produtoId, quantity: qtd }]), false, chave());
  await chamar(s.u.recebimento, "receipt_scan", r.receipt_id, uuid(), sku, qtd, null, null, null, "accepted", null);
  await chamar(s.u.recebimento, "confirm_receipt", r.receipt_id, chave(), null);
  const t = (await admin((c) => c.query("select id from wms.putaway_tasks where source_id = $1", [r.receipt_id]))).rows[0].id;
  await chamar(s.u.estoquista, "confirm_putaway", t, "RECEB", sku, local, chave());
}

async function separarEmbalarDespachar(s: Cenario, pedido: string) {
  await chamar(s.u.supervisor, "allocate_order", pedido, chave(), null);
  const tarefas = (await admin((c) => c.query(
    `select t.id, pi.quantity::float q, l.code, p.sku from wms.picking_tasks t join wms.picking_items pi on pi.task_id = t.id
       join wms.locations l on l.id = pi.location_id join wms.products p on p.id = pi.product_id where t.order_id = $1`, [pedido]))).rows;
  for (const t of tarefas) await chamar(s.u.separador, "pick_scan", t.id, uuid(), t.code, t.sku, t.q, null, null, null);
  for (const id of new Set(tarefas.map((t) => t.id))) await chamar(s.u.separador, "complete_picking_task", id, chave(), null);
  await chamar(s.u.conferente, "start_packing", pedido, chave());
  const v = await chamar<{ package_id: string; label_code: string }>(s.u.conferente, "open_package", pedido, chave());
  for (const t of tarefas) await chamar(s.u.conferente, "pack_scan", v.package_id, uuid(), t.sku, t.q, null, null, null);
  await chamar(s.u.conferente, "close_package", v.package_id, null, null, null, null, chave());
  await chamar(s.u.conferente, "complete_packing", pedido, chave());
  const rem = await chamar<{ shipment_id: string }>(s.u.expedicao, "create_shipment", s.wh, "", null, chave());
  await chamar(s.u.expedicao, "add_order_to_shipment", rem.shipment_id, pedido, chave());
  await chamar(s.u.expedicao, "load_scan", rem.shipment_id, uuid(), v.label_code);
  return chamar<{ erp_posting: string }>(s.u.expedicao, "dispatch_shipment", rem.shipment_id, chave(), null);
}

const pedidoDoErp = async (conn: string, ext: string) =>
  (await admin((c) => c.query("select internal_id from wms.external_mappings where connection_id = $1 and entity_type = 'order' and external_id = $2", [conn, ext]))).rows[0]?.internal_id as string | undefined;

describe("WMS · integração (simulador)", { skip: !temBanco && "WMS_TEST_DATABASE_URL não definido" }, () => {
  test("importação paginada de produtos é idempotente e mapeia pelo ID externo", async () => {
    const s = await criarCenario();
    const c = await conectar(s);
    assert.equal(c.produtos.length, 3);
    await chamar(s.u.admin, "request_sync_job", c.connection_id, "import_products", json({}));
    while (await processarJob(c.deps)) { /* reimporta */ }
    const n = (await admin((x) => x.query("select count(*)::int n from wms.products where organization_id = $1 and sku like 'SIM-%'", [s.org]))).rows[0].n;
    assert.equal(n, 3, "sem duplicar");
  });

  test("webhook repetido e fora de ordem: sem duplicação nem regressão de versão", async () => {
    const s = await criarCenario();
    const c = await conectar(s);
    pedidoMock(c.mock, "7001", "3", [["9001", 2]]);
    const a = await webhook(c.webhook_ref, "h1", "vendas", "7001");
    const b = await webhook(c.webhook_ref, "h1", "vendas", "7001");
    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, true, "mesmo aviso não entra duas vezes");
    await processarInbox(c.deps);
    const ped = await pedidoDoErp(c.connection_id, "7001");
    assert.ok(ped);
    // versão mais nova aplicada; snapshot antigo chegando depois é ignorado
    const recente = await comoWorker((x) => rpc<{ status: string }>(x, "worker_apply_order_snapshot", [c.connection_id, json({
      external_id: "7001", number: "V-7001", external_version: "2099-01-01T00:00:00Z", erp_status: "3", deposit_external_id: "501",
      customer_name: "X", fiscal_status: "released", items: [{ external_item_id: "7001:1", product_external_id: "9001", quantity: 2 }] })]));
    assert.equal(recente.status, "unchanged");
    const antigo = await comoWorker((x) => rpc<{ status: string }>(x, "worker_apply_order_snapshot", [c.connection_id, json({
      external_id: "7001", number: "V-7001", external_version: "2020-01-01T00:00:00Z", erp_status: "2", deposit_external_id: "501",
      customer_name: "X", items: [{ external_item_id: "7001:1", product_external_id: "9001", quantity: 9 }] })]));
    assert.equal(antigo.status, "stale");
    assert.equal(await statusPedido(ped!), "awaiting_allocation", "sem regressão para cancelado nem itens antigos");
    // webhook de outra conexão/referência inválida não entra
    await falha(webhook("ref-invalida", "h2", "vendas", "7001"), 404);
  });

  test("pedido não elegível não é importado; alterado após reserva entra em espera e é reconciliado", async () => {
    const s = await criarCenario();
    const c = await conectar(s);
    const [p1] = c.produtos;
    await entradaProdutoErp(s, p1.id, p1.sku, 10, "A-01");
    pedidoMock(c.mock, "7101", "0", [["9001", 1]]); // 0 = Aberta: fora dos elegíveis configurados
    await webhook(c.webhook_ref, "x1", "vendas", "7101");
    await processarInbox(c.deps);
    assert.equal(await pedidoDoErp(c.connection_id, "7101"), undefined);
    pedidoMock(c.mock, "7101", "3", [["9001", 2]]);
    await webhook(c.webhook_ref, "x2", "vendas", "7101");
    await processarInbox(c.deps);
    const ped = (await pedidoDoErp(c.connection_id, "7101"))!;
    await chamar(s.u.supervisor, "allocate_order", ped, chave(), null);
    pedidoMock(c.mock, "7101", "3", [["9001", 3]]);
    await webhook(c.webhook_ref, "x3", "vendas", "7101");
    await processarInbox(c.deps);
    assert.equal(await statusPedido(ped), "on_hold");
    const t = (await admin((x) => x.query("select id, status from wms.picking_tasks where order_id = $1", [ped]))).rows[0];
    assert.equal(t.status, "invalidated");
    await falha(chamar(s.u.separador, "pick_scan", t.id, uuid(), "A-01", p1.sku, 1, null, null, null), 409);
    await chamar(s.u.supervisor, "reconcile_order_revision", ped, chave());
    assert.equal(await statusPedido(ped), "awaiting_allocation");
    assert.equal((await saldo(s, p1.id)).reserved, 0);
    const r = await chamar<{ allocated: boolean }>(s.u.supervisor, "allocate_order", ped, chave(), null);
    assert.equal(r.allocated, true);
    assert.equal((await saldo(s, p1.id)).reserved, 3, "nova revisão reservada");
  });

  test("ERP baixou no faturamento: despacho não envia segunda baixa", async () => {
    const s = await criarCenario();
    const c = await conectar(s, { saida: "erp_on_invoice", entrada: "erp_on_document" });
    const [p1] = c.produtos;
    await entradaProdutoErp(s, p1.id, p1.sku, 5, "A-01");
    pedidoMock(c.mock, "7201", "3", [["9001", 2]]);
    await webhook(c.webhook_ref, "f1", "vendas", "7201");
    await processarInbox(c.deps);
    const d = await separarEmbalarDespachar(s, (await pedidoDoErp(c.connection_id, "7201"))!);
    assert.equal(d.erp_posting, "erp_side");
    const eventos = (await admin((x) => x.query("select count(*)::int n from wms.outbox_events where connection_id = $1 and event_type like 'stock.%'", [c.connection_id]))).rows[0].n;
    assert.equal(eventos, 0, "nenhum lançamento de estoque enviado pelo WMS");
    await processarOutbox(c.deps);
    assert.equal(c.mock.estado.lancamentos.length, 0);
  });

  test("WMS lança no despacho; timeout após escrita vira 'desconhecido' e não é reenviado às cegas", async () => {
    const s = await criarCenario();
    const c = await conectar(s, { saida: "wms_on_dispatch", entrada: "erp_on_document" });
    const [p1] = c.produtos;
    await entradaProdutoErp(s, p1.id, p1.sku, 5, "A-01");
    pedidoMock(c.mock, "7301", "3", [["9001", 2]]);
    await webhook(c.webhook_ref, "g1", "vendas", "7301");
    await processarInbox(c.deps);
    const d = await separarEmbalarDespachar(s, (await pedidoDoErp(c.connection_id, "7301"))!);
    assert.equal(d.erp_posting, "outbox");
    c.mock.falhar("lancar_estoque", "timeout_apos_aplicar");
    await processarOutbox(c.deps);
    const ev = (await admin((x) => x.query("select id, status from wms.outbox_events where connection_id = $1", [c.connection_id]))).rows[0];
    assert.equal(ev.status, "unknown");
    await processarOutbox(c.deps);
    assert.equal(c.mock.estado.lancamentos.length, 1, "não reenvia automaticamente");
    await falha(chamar(s.u.admin, "resolve_outbox_event", ev.id, "retry", "", chave()), 422);
    await chamar(s.u.admin, "resolve_outbox_event", ev.id, "mark_applied", "Lançamento SIM-LANC-1 conferido no ERP", chave());
    const st = (await admin((x) => x.query("select status from wms.outbox_events where id = $1", [ev.id]))).rows[0].status;
    assert.equal(st, "sent");
    assert.deepEqual(c.mock.estado.lancamentos.map((l) => [l.tipo, l.quantidade, l.product_external_id]), [["S", 2, "9001"]]);
  });

  test("worker cai depois de enviar: retomada verifica o efeito externo antes de repetir", async () => {
    const s = await criarCenario();
    const c = await conectar(s, { saida: "wms_on_dispatch", entrada: "erp_on_document" });
    const [p1] = c.produtos;
    await entradaProdutoErp(s, p1.id, p1.sku, 5, "A-01");
    pedidoMock(c.mock, "7401", "3", [["9001", 1]]);
    await webhook(c.webhook_ref, "k1", "vendas", "7401");
    await processarInbox(c.deps);
    await separarEmbalarDespachar(s, (await pedidoDoErp(c.connection_id, "7401"))!);
    // simula: reivindicou, marcou envio, o ERP aplicou, e o processo morreu antes de registrar
    const [ev] = await comoWorker(async (x) => (await x.query("select * from wms.worker_claim_outbox('morto', 1, 30)")).rows);
    await comoWorker((x) => rpc(x, "worker_mark_sending", [ev.id, "morto"]));
    const ctx = await comoWorker((x) => rpc<{ payload: { movement_id: string } }>(x, "worker_outbox_context", [ev.id]));
    await c.mock.lancarEstoque({ connectionId: c.connection_id, accessToken: "x" },
      { product_external_id: "9001", deposit_external_id: "501", tipo: "S", quantidade: 1, observacoes: `WMS ${ctx.payload.movement_id}`, precoUnitario: null });
    await admin((x) => x.query("update wms.outbox_events set lease_until = now() - interval '1 minute' where id = $1", [ev.id]));
    await processarOutbox(c.deps);
    const depois = (await admin((x) => x.query("select status, needs_verification from wms.outbox_events where id = $1", [ev.id]))).rows[0];
    assert.equal(depois.status, "sent");
    assert.equal(c.mock.estado.lancamentos.length, 1, "nenhum segundo lançamento");
    assert.ok(c.mock.estado.chamadas.includes("verificar_lancamento"));
  });

  test("API indisponível/429: fila preservada com backoff e estado visível; 400 vai para falha", async () => {
    const s = await criarCenario();
    const c = await conectar(s, { saida: "wms_on_dispatch", entrada: "wms_on_receipt" });
    const [p1, p2] = c.produtos;
    c.mock.falhar("lancar_estoque", "429");
    await entradaProdutoErp(s, p1.id, p1.sku, 5, "A-01");
    await processarOutbox(c.deps);
    const ev = (await admin((x) => x.query("select id, status, attempts, next_attempt_at > now() as futuro, last_error from wms.outbox_events where connection_id = $1", [c.connection_id]))).rows[0];
    assert.equal(ev.status, "pending");
    assert.equal(ev.futuro, true, "backoff agenda nova tentativa");
    const lim = (await admin((x) => x.query("select blocked_until > now() as bloqueado from wms.rate_limit_windows where connection_id = $1 and bucket = 'write'", [c.connection_id]))).rows[0];
    assert.equal(lim.bloqueado, true, "limite compartilhado registra o bloqueio");
    await admin((x) => x.query("update wms.outbox_events set next_attempt_at = now() where id = $1; ", [ev.id]));
    await admin((x) => x.query("update wms.rate_limit_windows set blocked_until = null where connection_id = $1", [c.connection_id]));
    await processarOutbox(c.deps);
    assert.equal((await admin((x) => x.query("select status from wms.outbox_events where id = $1", [ev.id]))).rows[0].status, "sent");
    c.mock.falhar("lancar_estoque", "400");
    await entradaProdutoErp(s, p2.id, p2.sku, 1, "A-02");
    await processarOutbox(c.deps);
    const falhou = (await admin((x) => x.query("select status from wms.outbox_events where connection_id = $1 and status <> 'sent'", [c.connection_id]))).rows[0];
    assert.equal(falhou.status, "failed");
  });

  test("escrita desabilitada na conexão: nada é enviado", async () => {
    const s = await criarCenario();
    const c = await conectar(s, { saida: "wms_on_dispatch", entrada: "wms_on_receipt" });
    await chamar(s.u.admin, "update_connection", c.connection_id, null, null, false, null);
    const [p1] = c.produtos;
    await entradaProdutoErp(s, p1.id, p1.sku, 2, "A-01");
    await processarOutbox(c.deps);
    assert.equal(c.mock.estado.lancamentos.length, 0);
    assert.equal((await admin((x) => x.query("select status from wms.outbox_events where connection_id = $1", [c.connection_id]))).rows[0].status, "pending");
  });

  test("política não validada: fato registrado como bloqueado, sem envio", async () => {
    const s = await criarCenario();
    const c = await conectar(s);
    const [p1] = c.produtos;
    await entradaProdutoErp(s, p1.id, p1.sku, 2, "A-01");
    const ev = (await admin((x) => x.query("select status, blocked_reason from wms.outbox_events where connection_id = $1", [c.connection_id]))).rows[0];
    assert.deepEqual(ev, { status: "blocked", blocked_reason: "posting_policy_undefined" });
  });

  test("conciliação: divergência ERP x WMS vira ocorrência sem sobrescrever o ledger", async () => {
    const s = await criarCenario();
    const c = await conectar(s, { saida: "erp_on_invoice", entrada: "erp_on_document" });
    const [p1] = c.produtos;
    await entradaProdutoErp(s, p1.id, p1.sku, 5, "A-01");
    c.mock.estado.saldos.set("9001|501", 7);
    await chamar(s.u.admin, "request_sync_job", c.connection_id, "reconcile_stock", json({}));
    while (await processarJob(c.deps)) { /* processa */ }
    const d = (await admin((x) => x.query("select quantity::float q from wms.discrepancies where kind = 'erp_stock_mismatch' and product_id = $1", [p1.id]))).rows[0];
    assert.equal(d.q, 2);
    assert.equal((await saldo(s, p1.id)).quantity, 5, "ledger físico intacto");
  });

  test("refresh simultâneo: uma única renovação e tokens consistentes", async () => {
    const s = await criarCenario();
    const c = await chamar<{ connection_id: string }>(s.u.admin, "create_connection", s.org, "Olist real (teste)", "olist_v3", chave());
    const cred = cifrar(JSON.stringify({ access_token: "velho", refresh_token: "r1" }), c.connection_id, env);
    await comoWorker((x) => rpc(x, "worker_save_authorized_credentials", [c.connection_id, cred.ciphertext, cred.versao, new Date(Date.now() - 1000).toISOString(), null]));
    let chamadas = 0;
    const mk = (owner: string): DepsWorker => ({
      owner, env, adapterPara: () => { throw new Error("não usado"); }, dormir: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))),
      renovarToken: async (refresh) => {
        chamadas++;
        assert.equal(refresh, "r1");
        await new Promise((r) => setTimeout(r, 150));
        return { access_token: "novo", refresh_token: "r2", expires_in: 14400 };
      },
    });
    const tokens = await Promise.all(Array.from({ length: 5 }, (_, i) => obterToken(mk(`p${i}`), c.connection_id)));
    assert.equal(chamadas, 1);
    assert.deepEqual(new Set(tokens), new Set(["novo"]));
    // refresh recusado: reautorização exigida e jobs pausados
    await admin((x) => x.query("update wms.integration_connections set access_token_expires_at = now() - interval '1 hour' where id = $1", [c.connection_id]));
    const { ErroErp } = await import("../../src/lib/wms/integracoes/tipos");
    await assert.rejects(obterToken({ ...mk("p9"), renovarToken: async () => { throw new ErroErp("autorizacao", "invalid_grant", 400); } }, c.connection_id));
    const st = (await admin((x) => x.query("select status from wms.integration_connections where id = $1", [c.connection_id]))).rows[0].status;
    assert.equal(st, "reauthorization_required");
    const conn = (await comoWorker(async (x) => (await x.query("select * from wms.worker_get_connection($1)", [c.connection_id])).rows[0])) as Conexao;
    assert.equal(conn.status, "reauthorization_required");
  });

  test("ERP cancela durante a separação: avanço bloqueado e retorno físico criado", async () => {
    const s = await criarCenario();
    const c = await conectar(s);
    const [p1] = c.produtos;
    await entradaProdutoErp(s, p1.id, p1.sku, 5, "A-01");
    pedidoMock(c.mock, "7501", "3", [["9001", 2]]);
    await webhook(c.webhook_ref, "z1", "vendas", "7501");
    await processarInbox(c.deps);
    const ped = (await pedidoDoErp(c.connection_id, "7501"))!;
    await chamar(s.u.supervisor, "allocate_order", ped, chave(), null);
    const t = (await admin((x) => x.query("select id from wms.picking_tasks where order_id = $1", [ped]))).rows[0].id;
    await chamar(s.u.separador, "pick_scan", t, uuid(), "A-01", p1.sku, 1, null, null, null);
    pedidoMock(c.mock, "7501", "2", [["9001", 2]]);
    await webhook(c.webhook_ref, "z2", "vendas", "7501");
    await processarInbox(c.deps);
    assert.equal(await statusPedido(ped), "cancelled");
    const ret = (await admin((x) => x.query("select count(*)::int n from wms.putaway_tasks where source_id = $1 and kind = 'return_to_stock'", [ped]))).rows[0].n;
    assert.equal(ret, 1);
    assert.equal((await saldo(s, p1.id)).reserved, 0);
  });
});
