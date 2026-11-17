/**
 * Autorização, RLS, MFA, autoaprovação, contagem cega e arquivos privados — com usuários distintos.
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { comoUsuario, encerrarPoolWms } from "../../src/lib/wms/db";
import {
  admin, chamar, chave, consultar, criarCenario, criarPedido, darEntrada, falha, saldo, temBanco, usuario, uuid,
} from "./helpers";

after(() => encerrarPoolWms());

describe("WMS · segurança", { skip: !temBanco && "WMS_TEST_DATABASE_URL não definido" }, () => {
  test("sem armazém ou de outra empresa: consulta e mutação negadas, inclusive por ID direto", async () => {
    const s = await criarCenario();
    const outra = await criarCenario();
    await darEntrada(s, "simples", 5, "A-01");
    const ped = await criarPedido(s, [{ produto: "simples", quantidade: 1 }]);

    // vínculo na empresa, mas sem acesso ao armazém
    assert.equal((await consultar(s.u.semArmazem, "select id from wms.orders where id = $1", [ped])).length, 0);
    assert.equal((await consultar(s.u.semArmazem, "select * from wms.stock_balances")).length, 0);
    await falha(chamar(s.u.semArmazem, "transfer_stock", s.wh, "A-01", "A-02", s.skus.simples, 1, null, null, null, null, chave()), 403);

    // outra empresa: nada visível, nenhum comando aceito
    assert.equal((await consultar(outra.u.admin, "select id from wms.orders where id = $1", [ped])).length, 0);
    assert.equal((await consultar(outra.u.admin, "select id from wms.products where organization_id = $1", [s.org])).length, 0);
    await falha(chamar(outra.u.admin, "allocate_order", ped, chave(), null), 403);
    await falha(chamar(outra.u.admin, "cancel_order", ped, "x", chave()), 403);
    await falha(chamar(outra.u.admin, "create_manual_receipt", s.wh, "NF-X", "", '[{"product_id":"' + s.p.simples + '","quantity":1}]', false, chave()), 403);
    // referência cruzada barrada por chave composta mesmo para quem tem permissão na própria empresa
    await falha(chamar(outra.u.admin, "set_kit_components", outra.p.kit, '[{"product_id":"' + s.p.simples + '","quantity":1}]'), 422);
  });

  test("sem autenticação: 401; escrita direta em tabela: negada", async () => {
    const s = await criarCenario();
    await falha(comoUsuario({ userId: "", claims: {} }, async () => undefined), 401);
    const anonimo = usuario("fantasma");
    await falha(chamar(anonimo, "allocate_order", uuid(), chave(), null), 404);
    await falha(chamar(anonimo, "create_warehouse", s.org, "CDX", "x", chave()), 403);
    await falha(consultar(s.u.admin, "insert into wms.stock_balances (organization_id, warehouse_id, location_id, product_id, condition, quantity) select organization_id, warehouse_id, id, $1, 'available', 999 from wms.locations limit 1", [s.p.simples]), 403);
    await falha(consultar(s.u.admin, "update wms.stock_balances set quantity = 999"), 403);
  });

  test("usuário desativado com JWT ainda válido: nova operação negada", async () => {
    const s = await criarCenario();
    await darEntrada(s, "simples", 5, "A-01");
    const m = (await admin((c) => c.query("select id from wms.memberships where user_id = $1", [s.u.estoquista.userId]))).rows[0].id;
    await chamar(s.u.admin, "set_member_active", m, false);
    await falha(chamar(s.u.estoquista, "transfer_stock", s.wh, "A-01", "A-02", s.skus.simples, 1, null, null, null, null, chave()), 403);
    assert.equal((await consultar(s.u.estoquista, "select * from wms.stock_balances")).length, 0);
    await falha(chamar(s.u.admin, "set_member_active", (await admin((c) => c.query("select id from wms.memberships where user_id = $1", [s.u.admin.userId]))).rows[0].id, false), 409);
  });

  test("papel/empresa enviados pelo cliente não concedem privilégio", async () => {
    const s = await criarCenario();
    const forjado = { ...s.u.estoquista, claims: { aal: "aal2", role: "service_role", user_metadata: { role: "admin" }, app_metadata: { wms_role: "admin", organization_id: s.org } } };
    await falha(chamar(forjado, "create_warehouse", s.org, "CD9", "Forjado", chave()), 403);
    await falha(chamar(forjado, "save_member", s.org, forjado.userId, "x", ["admin"], true, []), 403);
  });

  test("MFA obrigatório para administração e aprovação de ajustes", async () => {
    const s = await criarCenario();
    const semMfa = { ...s.u.admin, claims: { aal: "aal1" } };
    const e = await falha(chamar(semMfa, "create_warehouse", s.org, "CD8", "Sem MFA", chave()), 403);
    assert.equal(e.detalhe, "mfa_required");
  });

  test("inventário: contagem cega, recontagem, autoaprovação negada e aprovação sem reaplicar", async () => {
    const s = await criarCenario();
    await darEntrada(s, "simples", 10, "A-01");
    const inv = await chamar<{ session_id: string }>(s.u.supervisor, "create_inventory_session", s.wh, "cycle", ["A-01"], 0, 0, 2, chave());
    await chamar(s.u.supervisor, "start_inventory_session", inv.session_id, chave());
    const contagem = await chamar<Record<string, unknown>>(s.u.estoquista, "record_inventory_count", inv.session_id, uuid(), "A-01", s.skus.simples, 7, null, null, null);
    assert.deepEqual(Object.keys(contagem).sort(), ["count_id", "location", "quantity_base", "round", "sku", "unit"], "resposta não revela o saldo esperado");
    // o contador não vê contagens de outros nem saldo esperado pela tabela de contagens
    const r1 = await chamar<{ status: string; recount_locations: string[] }>(s.u.supervisor, "close_inventory_round", inv.session_id, chave());
    assert.equal(r1.status, "counting");
    assert.deepEqual(r1.recount_locations, ["A-01"], "divergência fora da tolerância exige recontagem");
    await chamar(s.u.separador, "record_inventory_count", inv.session_id, uuid(), "A-01", s.skus.simples, 8, null, null, null).catch(() => undefined);
    await chamar(s.u.estoquista, "record_inventory_count", inv.session_id, uuid(), "A-01", s.skus.simples, 8, null, null, null);
    assert.equal((await consultar(s.u.separador, "select * from wms.inventory_counts where session_id = $1", [inv.session_id])).length, 0);
    const r2 = await chamar<{ status: string; adjustments: number }>(s.u.supervisor, "close_inventory_round", inv.session_id, chave());
    assert.deepEqual(r2, { session_id: inv.session_id, status: "review", adjustments: 1 });
    const adj = (await admin((c) => c.query("select id from wms.inventory_adjustments where session_id = $1", [inv.session_id]))).rows[0].id;
    // quem solicitou não aprova
    await falha(chamar(s.u.supervisor, "approve_inventory_adjustment", adj, chave()), 403, "self_approval");
    // aprovação exige MFA
    await falha(chamar({ ...s.u.supervisor2, claims: { aal: "aal1" } }, "approve_inventory_adjustment", adj, chave()), 403, "mfa_required");
    const k = chave();
    await chamar(s.u.supervisor2, "approve_inventory_adjustment", adj, k);
    assert.equal((await saldo(s, s.p.simples, "A-01")).quantity, 8);
    await chamar(s.u.supervisor2, "approve_inventory_adjustment", adj, k); // replay
    await falha(chamar(s.u.supervisor2, "approve_inventory_adjustment", adj, chave()), 409, "already_decided");
    assert.equal((await saldo(s, s.p.simples, "A-01")).quantity, 8, "aprovação repetida não reaplica diferença");
    const loc = (await admin((c) => c.query("select counting_session_id from wms.locations where warehouse_id = $1 and code = 'A-01'", [s.wh]))).rows[0];
    assert.equal(loc.counting_session_id, null, "inventário encerrado libera o endereço");
  });

  test("carga inicial por endereço exige contagem e aprovação", async () => {
    const s = await criarCenario();
    const inv = await chamar<{ session_id: string }>(s.u.supervisor, "create_inventory_session", s.wh, "initial_load", ["A-01", "B-01"], 0, 0, 1, chave());
    await chamar(s.u.supervisor, "start_inventory_session", inv.session_id, chave());
    await chamar(s.u.estoquista, "record_inventory_count", inv.session_id, uuid(), "A-01", s.skus.simples, 12, null, null, null);
    await chamar(s.u.estoquista, "record_inventory_count", inv.session_id, uuid(), "B-01", s.skus.caixa, 2, null, null, null);
    await chamar(s.u.supervisor, "close_inventory_round", inv.session_id, chave());
    assert.equal((await saldo(s, s.p.simples)).quantity, 0, "nada entra sem aprovação");
    const adjs = (await admin((c) => c.query("select id from wms.inventory_adjustments where session_id = $1", [inv.session_id]))).rows;
    for (const a of adjs) await chamar(s.u.supervisor2, "approve_inventory_adjustment", a.id, chave());
    assert.equal((await saldo(s, s.p.simples, "A-01")).quantity, 12);
    assert.equal((await saldo(s, s.p.simples, "B-01")).quantity, 24, "2 caixas × 12");
  });

  test("auditoria só para quem tem audit.read; arquivo de outra empresa negado", async () => {
    const s = await criarCenario();
    const outra = await criarCenario();
    assert.ok((await consultar(s.u.auditor, "select id from wms.audit_events")).length > 0);
    assert.equal((await consultar(s.u.separador, "select id from wms.audit_events")).length, 0);
    const pode = async (u: typeof s.u.admin, caminho: string) =>
      (await consultar<{ ok: boolean }>(u, "select wms.can_access_object($1, 'evidence.upload') as ok", [caminho]))[0].ok;
    assert.equal(await pode(s.u.recebimento, `${s.org}/${s.wh}/recebimento/foto.jpg`), true);
    assert.equal(await pode(s.u.recebimento, `${outra.org}/${outra.wh}/recebimento/foto.jpg`), false);
    assert.equal(await pode(s.u.recebimento, `${s.org}/${s.wh2}/foto.jpg`), false, "outro armazém da mesma empresa sem acesso");
    assert.equal(await pode(s.u.recebimento, `../${s.org}/x`), false);
    assert.equal(await pode(s.u.separador, `${s.org}/${s.wh}/x.jpg`), false, "sem permissão de evidência");
  });

  test("recebimento: sobra exige aprovação do supervisor; documento repetido não duplica", async () => {
    const s = await criarCenario();
    const ref = `NF-${uuid().slice(0, 6)}`;
    const itens = `[{"product_id":"${s.p.simples}","quantity":2}]`;
    const rec = await chamar<{ receipt_id: string }>(s.u.admin, "create_manual_receipt", s.wh, ref, "F", itens, false, chave());
    await falha(chamar(s.u.admin, "create_manual_receipt", s.wh, ref, "F", itens, false, chave()), 409, "duplicate_source");
    await chamar(s.u.recebimento, "receipt_scan", rec.receipt_id, uuid(), s.skus.simples, 3, null, null, null, "accepted", null);
    const r = await chamar<{ status: string; posted: boolean }>(s.u.recebimento, "confirm_receipt", rec.receipt_id, chave(), null);
    assert.deepEqual([r.status, r.posted], ["awaiting_review", false]);
    assert.equal((await saldo(s, s.p.simples)).quantity, 0);
    const item = (await admin((c) => c.query("select id from wms.receipt_items where receipt_id = $1", [rec.receipt_id]))).rows[0].id;
    await falha(chamar(s.u.recebimento, "review_receipt_overage", item, 1, "ok", chave()), 403);
    await chamar(s.u.supervisor, "review_receipt_overage", item, 1, "Fornecedor mandou a mais, aceito", chave());
    const r2 = await chamar<{ status: string }>(s.u.recebimento, "confirm_receipt", rec.receipt_id, chave(), null);
    assert.equal(r2.status, "received");
    assert.equal((await saldo(s, s.p.simples, "RECEB")).quantity, 3);
  });
});
