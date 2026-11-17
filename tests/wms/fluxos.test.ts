/**
 * Fluxos ponta a ponta no banco real: recebimento → armazenagem → reserva → separação →
 * conferência → volume → remessa → despacho, e os cenários da seção 16 do guia.
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { encerrarPoolWms } from "../../src/lib/wms/db";
import {
  admin, chamar, chave, conferirInvariantes, criarCenario, criarPedido, darEntrada, falha, json, saldo,
  statusPedido, temBanco, uuid, versaoPedido, type Cenario,
} from "./helpers";

after(() => encerrarPoolWms());

async function separarTudo(s: Cenario, pedido: string, quem = s.u.separador) {
  const tarefas = (await admin((c) => c.query("select id from wms.picking_tasks where order_id = $1 and status in ('open','in_progress')", [pedido]))).rows;
  for (const t of tarefas) {
    const itens = (await admin((c) => c.query(
      `select pi.quantity - pi.picked_qty - pi.short_qty as falta, l.code as local, p.sku, lt.code as lote
         from wms.picking_items pi join wms.locations l on l.id = pi.location_id join wms.products p on p.id = pi.product_id
         left join wms.lots lt on lt.id = pi.lot_id where pi.task_id = $1 and pi.status = 'open'`, [t.id]))).rows;
    for (const i of itens) {
      await chamar(quem, "pick_scan", t.id, uuid(), i.local, i.sku, Number(i.falta), i.lote, null, null);
    }
    await chamar(quem, "complete_picking_task", t.id, chave(), null);
  }
}

async function embalarTudo(s: Cenario, pedido: string) {
  await chamar(s.u.conferente, "start_packing", pedido, chave());
  const vol = await chamar<{ package_id: string; label_code: string }>(s.u.conferente, "open_package", pedido, chave());
  const linhas = (await admin((c) => c.query(
    `select p.sku, lt.code as lote, sum(r.quantity)::float as q from wms.stock_reservations r join wms.products p on p.id = r.product_id
       left join wms.lots lt on lt.id = r.lot_id where r.order_id = $1 and r.status = 'staged' group by p.sku, lt.code`, [pedido]))).rows;
  for (const l of linhas) {
    await chamar(s.u.conferente, "pack_scan", vol.package_id, uuid(), l.sku, l.q, l.lote, null, null);
  }
  await chamar(s.u.conferente, "close_package", vol.package_id, 1.5, 30, 20, 10, chave());
  await chamar(s.u.conferente, "complete_packing", pedido, chave());
  return vol;
}

describe("WMS · fluxos", { skip: !temBanco && "WMS_TEST_DATABASE_URL não definido" }, () => {
  test("fluxo completo: recebimento parcial até despacho, com invariantes", async () => {
    const s = await criarCenario({ fiscal: false });
    // Recebimento parcial: previsto 10, conferido 6 (5 bons + 1 avariado)
    const rec = await chamar<{ receipt_id: string }>(s.u.admin, "create_manual_receipt", s.wh, "NF-1001", "Distribuidora",
      json([{ product_id: s.p.simples, quantity: 10 }]), false, chave());
    const previsto = await saldo(s, s.p.simples);
    assert.equal(previsto.quantity, 0, "previsão não cria estoque");
    await chamar(s.u.recebimento, "receipt_scan", rec.receipt_id, uuid(), s.skus.gtin, 5, null, null, null, "accepted", null);
    await chamar(s.u.recebimento, "receipt_scan", rec.receipt_id, uuid(), s.skus.gtin, 1, null, null, null, "damaged", null);
    const conf = await chamar<{ status: string; putaway_tasks: number }>(s.u.recebimento, "confirm_receipt", rec.receipt_id, chave(), null);
    assert.equal(conf.status, "partially_received");
    assert.equal((await saldo(s, s.p.simples, "RECEB")).quantity, 5, "só o aceito entra no saldo disponível");
    assert.equal((await saldo(s, s.p.simples, "QUAR", "damaged")).quantity, 1, "avaria em quarentena");
    const item = (await admin((c) => c.query("select status, received_qty::float from wms.receipt_items where receipt_id = $1", [rec.receipt_id]))).rows[0];
    assert.deepEqual(item, { status: "open", received_qty: 5 }, "pendência mantida");

    // Armazenagem: origem, produto e destino confirmados por leitura
    const tarefa = (await admin((c) => c.query("select id, suggested_location_id from wms.putaway_tasks where source_id = $1", [rec.receipt_id]))).rows[0];
    assert.ok(tarefa.suggested_location_id, "sugere endereço");
    await falha(chamar(s.u.estoquista, "confirm_putaway", tarefa.id, "A-01", s.skus.simples, "A-01", chave()), 409, "wrong_location");
    await chamar(s.u.estoquista, "confirm_putaway", tarefa.id, "RECEB", s.skus.simples, "A-01", chave());
    assert.equal((await saldo(s, s.p.simples, "A-01")).quantity, 5);

    // Pedido → reserva → separação → staging
    const ped = await criarPedido(s, [{ produto: "simples", quantidade: 3 }]);
    const aloc = await chamar<{ allocated: boolean }>(s.u.supervisor, "allocate_order", ped, chave(), await versaoPedido(ped));
    assert.equal(aloc.allocated, true);
    assert.deepEqual(await saldo(s, s.p.simples, "A-01"), { quantity: 5, reserved: 3 });
    await separarTudo(s, ped);
    assert.equal(await statusPedido(ped), "picked");
    assert.deepEqual(await saldo(s, s.p.simples, "STAGE"), { quantity: 3, reserved: 3 }, "staging mantém a reserva");
    assert.deepEqual(await saldo(s, s.p.simples, "A-01"), { quantity: 2, reserved: 0 });

    // Conferência e volume
    const vol = await embalarTudo(s, ped);
    assert.equal(await statusPedido(ped), "packed");

    // Etiqueta: primeira impressão e reimpressão auditada sem nova remessa/baixa
    await chamar(s.u.conferente, "register_label_print", vol.package_id, null);
    await falha(chamar(s.u.conferente, "register_label_print", vol.package_id, ""), 422);
    const movAntes = (await admin((c) => c.query("select count(*)::int n from wms.stock_movements where warehouse_id = $1", [s.wh]))).rows[0].n;
    await chamar(s.u.conferente, "register_label_print", vol.package_id, "Etiqueta rasgou");
    const movDepois = (await admin((c) => c.query("select count(*)::int n from wms.stock_movements where warehouse_id = $1", [s.wh]))).rows[0].n;
    assert.equal(movDepois, movAntes, "reimpressão não gera movimento");
    const aud = (await admin((c) => c.query("select count(*)::int n from wms.audit_events where entity_id = $1 and action = 'label_reprinted'", [vol.package_id]))).rows[0].n;
    assert.equal(aud, 1);

    // Remessa: carregamento por leitura e despacho explícito
    const rem = await chamar<{ shipment_id: string }>(s.u.expedicao, "create_shipment", s.wh, "Transportadora X", "DOCA-1", chave());
    await chamar(s.u.expedicao, "add_order_to_shipment", rem.shipment_id, ped, chave());
    await falha(chamar(s.u.expedicao, "dispatch_shipment", rem.shipment_id, chave(), null), 409, "packages_not_loaded");
    await chamar(s.u.expedicao, "load_scan", rem.shipment_id, uuid(), vol.label_code);
    const k = chave();
    const desp = await chamar<{ status: string }>(s.u.expedicao, "dispatch_shipment", rem.shipment_id, k, null);
    assert.equal(desp.status, "dispatched");
    assert.equal(await statusPedido(ped), "dispatched");
    assert.deepEqual(await saldo(s, s.p.simples, "STAGE"), { quantity: 0, reserved: 0 }, "despacho consome staging e reserva uma vez");
    const repetido = await chamar<{ replayed: boolean }>(s.u.expedicao, "dispatch_shipment", rem.shipment_id, k, null);
    assert.equal(repetido.replayed, true);
    await falha(chamar(s.u.expedicao, "dispatch_shipment", rem.shipment_id, chave(), null), 409, "already_dispatched");
    const consumidas = (await admin((c) => c.query("select count(*)::int n from wms.stock_reservations where order_id = $1 and status = 'consumed'", [ped]))).rows[0].n;
    assert.ok(consumidas >= 1);
    await conferirInvariantes(s.wh);
  });

  test("idempotência: mesma chave repete o resultado; payload diferente é conflito", async () => {
    const s = await criarCenario();
    await darEntrada(s, "simples", 10, "A-01");
    const k = chave();
    const r1 = await chamar<{ movement_id: string }>(s.u.estoquista, "transfer_stock", s.wh, "A-01", "A-02", s.skus.simples, 4, null, null, null, "teste", k);
    const r2 = await chamar<{ movement_id: string; replayed: boolean }>(s.u.estoquista, "transfer_stock", s.wh, "A-01", "A-02", s.skus.simples, 4, null, null, null, "teste", k);
    assert.equal(r2.movement_id, r1.movement_id);
    assert.equal(r2.replayed, true);
    assert.equal((await saldo(s, s.p.simples, "A-02")).quantity, 4, "sem novo movimento");
    await falha(chamar(s.u.estoquista, "transfer_stock", s.wh, "A-01", "A-02", s.skus.simples, 5, null, null, null, "teste", k), 409, "idempotency_conflict");
    // Mesma chave por outro usuário também não reaproveita resultado
    await falha(chamar(s.u.supervisor, "transfer_stock", s.wh, "A-01", "A-02", s.skus.simples, 4, null, null, null, "teste", k), 409, "idempotency_conflict");
  });

  test("transferência interna preserva o total e gera duas partidas vinculadas", async () => {
    const s = await criarCenario();
    await darEntrada(s, "simples", 10, "A-01");
    const antes = (await saldo(s, s.p.simples)).quantity;
    const r = await chamar<{ movement_id: string }>(s.u.estoquista, "transfer_stock", s.wh, "A-01", "B-01", s.skus.simples, 6, null, null, null, null, chave());
    const partidas = (await admin((c) => c.query("select quantity::float q from wms.stock_entries where movement_id = $1 order by q", [r.movement_id]))).rows;
    assert.deepEqual(partidas.map((p) => p.q), [-6, 6]);
    assert.equal((await saldo(s, s.p.simples)).quantity, antes);
    // Saldo insuficiente não deixa negativo
    await falha(chamar(s.u.estoquista, "transfer_stock", s.wh, "A-01", "B-01", s.skus.simples, 5, null, null, null, null, chave()), 409, "insufficient_stock");
    // Movimento confirmado é imutável; correção por movimento inverso vinculado
    await assert.rejects(admin((c) => c.query("update wms.stock_movements set reason = 'x' where id = $1", [r.movement_id])));
    await assert.rejects(admin((c) => c.query("delete from wms.stock_entries where movement_id = $1", [r.movement_id])));
    const rev = await chamar<{ movement_id: string }>(s.u.supervisor, "reverse_movement", r.movement_id, "Endereço errado", chave());
    assert.ok(rev.movement_id);
    assert.equal((await saldo(s, s.p.simples, "A-01")).quantity, 10);
    await falha(chamar(s.u.supervisor, "reverse_movement", r.movement_id, "de novo", chave()), 409);
    await conferirInvariantes(s.wh);
  });

  test("caixa com fator 12 movimenta 12 unidades base; zeros à esquerda preservados", async () => {
    const s = await criarCenario();
    await darEntrada(s, "simples", 24, "A-01");
    const r = await chamar<{ quantity_base: number; factor: number }>(s.u.estoquista, "transfer_stock", s.wh, "A-01", "A-02", s.skus.caixa, 1, null, null, null, null, chave());
    assert.equal(r.quantity_base, 12);
    assert.equal((await saldo(s, s.p.simples, "A-02")).quantity, 12);
    // GTIN com zero à esquerda resolve; sem o zero não
    await chamar(s.u.estoquista, "transfer_stock", s.wh, "A-01", "A-02", s.skus.gtin, 1, null, null, null, null, chave());
    await falha(chamar(s.u.estoquista, "transfer_stock", s.wh, "A-01", "A-02", s.skus.gtin.replace(/^0/, ""), 1, null, null, null, null, chave()), 404, "unknown_code");
  });

  test("série duplicada é rejeitada; série não fica em duas posições", async () => {
    const s = await criarCenario();
    await darEntrada(s, "serie", 2, "A-01", { series: ["SN-001", "SN-002"] });
    const rec = await chamar<{ receipt_id: string }>(s.u.admin, "create_manual_receipt", s.wh, "NF-SERIE-2", "F", json([{ product_id: s.p.serie, quantity: 1 }]), false, chave());
    await falha(chamar(s.u.recebimento, "receipt_scan", rec.receipt_id, uuid(), s.skus.serie, 1, null, null, "SN-001", "accepted", null), 409, "serial_duplicate");
    await falha(chamar(s.u.recebimento, "receipt_scan", rec.receipt_id, uuid(), s.skus.serie, 2, null, null, "SN-009", "accepted", null), 422, "serial_qty");
    await chamar(s.u.estoquista, "transfer_stock", s.wh, "A-01", "A-02", s.skus.serie, 1, null, "SN-001", null, null, chave());
    await falha(chamar(s.u.estoquista, "transfer_stock", s.wh, "A-01", "A-02", s.skus.serie, 1, null, "SN-001", null, null, chave()), 409, "serial_location");
    const loc = (await admin((c) => c.query("select l.code from wms.serial_numbers sn join wms.locations l on l.id = sn.location_id where sn.product_id = $1 and sn.serial = 'SN-001'", [s.p.serie]))).rows;
    assert.deepEqual(loc, [{ code: "A-02" }]);
  });

  test("lote vencido ou com validade abaixo do mínimo não é reservado (FEFO)", async () => {
    const s = await criarCenario();
    const hoje = new Date();
    const dias = (n: number) => new Date(hoje.getTime() + n * 86400000).toISOString().slice(0, 10);
    await darEntrada(s, "lote", 5, "A-01", { lote: "L-VENCE", validade: dias(2) });   // abaixo de 5 dias mínimos
    await darEntrada(s, "lote", 5, "A-02", { lote: "L-LONGE", validade: dias(200) });
    await darEntrada(s, "lote", 5, "B-02", { lote: "L-PERTO", validade: dias(30) });
    const ped = await criarPedido(s, [{ produto: "lote", quantidade: 7 }]);
    await chamar(s.u.supervisor, "allocate_order", ped, chave(), null);
    const res = (await admin((c) => c.query(
      "select lt.code, sum(r.quantity)::float q from wms.stock_reservations r join wms.lots lt on lt.id = r.lot_id where r.order_id = $1 group by lt.code order by lt.code", [ped]))).rows;
    assert.deepEqual(res, [{ code: "L-LONGE", q: 2 }, { code: "L-PERTO", q: 5 }], "FEFO, sem o lote quase vencido");
    const ped2 = await criarPedido(s, [{ produto: "lote", quantidade: 4 }]);
    const r2 = await chamar<{ allocated: boolean; shortages: unknown[] }>(s.u.supervisor, "allocate_order", ped2, chave(), null);
    assert.equal(r2.allocated, false, "restante é só o lote quase vencido: não reserva");
    // Validade divergente para o mesmo lote é conflito
    const rec = await chamar<{ receipt_id: string }>(s.u.admin, "create_manual_receipt", s.wh, "NF-LOTE-X", "F", json([{ product_id: s.p.lote, quantity: 1 }]), false, chave());
    await falha(chamar(s.u.recebimento, "receipt_scan", rec.receipt_id, uuid(), s.skus.lote, 1, "L-LONGE", dias(10), null, "accepted", null), 409, "lot_expiry_conflict");
    await conferirInvariantes(s.wh);
  });

  test("quarentena e bloqueio não são reservados nem separados", async () => {
    const s = await criarCenario();
    await darEntrada(s, "outro", 4, "A-01");
    await chamar(s.u.supervisor, "change_stock_condition", s.wh, "A-01", s.p.outro, null, null, "available", "blocked", 4, "Embalagem suspeita", chave());
    const ped = await criarPedido(s, [{ produto: "outro", quantidade: 1 }]);
    const r = await chamar<{ allocated: boolean }>(s.u.supervisor, "allocate_order", ped, chave(), null);
    assert.equal(r.allocated, false);
    await chamar(s.u.supervisor, "change_stock_condition", s.wh, "A-01", s.p.outro, null, null, "blocked", "available", 4, "Liberado", chave());
    await chamar(s.u.admin, "set_location_block", (await admin((c) => c.query("select id from wms.locations where warehouse_id = $1 and code = 'A-01'", [s.wh]))).rows[0].id, true, "Avaria na prateleira");
    const r2 = await chamar<{ allocated: boolean }>(s.u.supervisor, "allocate_order", ped, chave(), null);
    assert.equal(r2.allocated, false, "endereço bloqueado fora do elegível");
  });

  test("kit por componentes reserva os componentes (sem descontar o kit)", async () => {
    const s = await criarCenario();
    await darEntrada(s, "simples", 10, "A-01");
    await darEntrada(s, "outro", 10, "A-02");
    const ped = await criarPedido(s, [{ produto: "kit", quantidade: 3 }]);
    await chamar(s.u.supervisor, "allocate_order", ped, chave(), null);
    assert.equal((await saldo(s, s.p.simples)).reserved, 6);
    assert.equal((await saldo(s, s.p.outro)).reserved, 3);
    const kitRes = (await admin((c) => c.query("select count(*)::int n from wms.stock_reservations where product_id = $1", [s.p.kit]))).rows[0].n;
    assert.equal(kitRes, 0);
  });

  test("cancelamento antes, durante e depois da separação", async () => {
    const s = await criarCenario({ fiscal: false });
    await darEntrada(s, "simples", 10, "A-01");
    // antes do picking: libera reserva
    const p1 = await criarPedido(s, [{ produto: "simples", quantidade: 2 }]);
    await chamar(s.u.supervisor, "allocate_order", p1, chave(), null);
    await chamar(s.u.supervisor, "cancel_order", p1, "Cliente desistiu", chave());
    assert.equal((await saldo(s, s.p.simples)).reserved, 0);
    // durante: bloqueia avanço e cria retorno físico do que já foi para staging
    const p2 = await criarPedido(s, [{ produto: "simples", quantidade: 4 }]);
    await chamar(s.u.supervisor, "allocate_order", p2, chave(), null);
    const t = (await admin((c) => c.query("select id from wms.picking_tasks where order_id = $1", [p2]))).rows[0].id;
    await chamar(s.u.separador, "pick_scan", t, uuid(), "A-01", s.skus.simples, 1, null, null, null);
    const c = await chamar<{ return_tasks: number; previous_status: string }>(s.u.supervisor, "cancel_order", p2, "ERP cancelou", chave());
    assert.equal(c.previous_status, "picking");
    assert.equal(c.return_tasks, 1);
    await falha(chamar(s.u.separador, "pick_scan", t, uuid(), "A-01", s.skus.simples, 1, null, null, null), 409, "order_cancelled");
    assert.deepEqual(await saldo(s, s.p.simples, "STAGE"), { quantity: 1, reserved: 0 }, "item segue fisicamente em staging, sem reserva");
    const ret = (await admin((c2) => c2.query("select id from wms.putaway_tasks where source_id = $1 and kind = 'return_to_stock'", [p2]))).rows[0].id;
    await chamar(s.u.estoquista, "confirm_putaway", ret, "STAGE", s.skus.simples, "A-01", chave());
    assert.equal((await saldo(s, s.p.simples, "A-01")).quantity, 10);
    // depois do despacho: exige devolução
    const p3 = await criarPedido(s, [{ produto: "simples", quantidade: 1 }]);
    await chamar(s.u.supervisor, "allocate_order", p3, chave(), null);
    await separarTudo(s, p3);
    const vol = await embalarTudo(s, p3);
    const rem = await chamar<{ shipment_id: string }>(s.u.expedicao, "create_shipment", s.wh, "", null, chave());
    await chamar(s.u.expedicao, "add_order_to_shipment", rem.shipment_id, p3, chave());
    await chamar(s.u.expedicao, "load_scan", rem.shipment_id, uuid(), vol.label_code);
    await chamar(s.u.expedicao, "dispatch_shipment", rem.shipment_id, chave(), null);
    await falha(chamar(s.u.supervisor, "cancel_order", p3, "tarde", chave()), 409, "already_dispatched");
    const dev = await chamar<{ return_id: string }>(s.u.supervisor, "create_return", s.wh, p3, "Cliente devolveu", json([{ product_id: s.p.simples, quantity: 1 }]), chave());
    await chamar(s.u.recebimento, "receive_return_item", dev.return_id, uuid(), s.skus.simples, 1, null, null, null, null);
    assert.equal((await saldo(s, s.p.simples, "DEVOL", "quarantine")).quantity, 1, "devolução entra em quarentena");
    const ri = (await admin((c2) => c2.query("select id from wms.return_items where return_id = $1", [dev.return_id]))).rows[0].id;
    await chamar(s.u.supervisor, "decide_quality", s.wh, "DEVOL", s.p.simples, null, null, "quarantine", 1, "reintegrate", "A-02", "ok", ri, chave());
    assert.equal((await saldo(s, s.p.simples, "A-02")).quantity, 1);
    await falha(chamar(s.u.supervisor, "create_return", s.wh, p3, "de novo", json([{ product_id: s.p.simples, quantity: 1 }]), chave()), 409);
    await conferirInvariantes(s.wh);
  });

  test("falta na separação gera ocorrência e realocação autorizada", async () => {
    const s = await criarCenario();
    await darEntrada(s, "simples", 3, "A-01");
    await darEntrada(s, "simples", 5, "B-02");
    const ped = await criarPedido(s, [{ produto: "simples", quantidade: 3 }]);
    await chamar(s.u.supervisor, "allocate_order", ped, chave(), null);
    const t = (await admin((c) => c.query("select t.id, pi.id as item, l.code from wms.picking_tasks t join wms.picking_items pi on pi.task_id = t.id join wms.locations l on l.id = pi.location_id where t.order_id = $1", [ped]))).rows[0];
    await chamar(s.u.separador, "pick_scan", t.id, uuid(), t.code, s.skus.simples, 1, null, null, null);
    await chamar(s.u.separador, "pick_short", t.id, t.item, 2, "Posição vazia", chave());
    const oc = (await admin((c) => c.query("select count(*)::int n from wms.discrepancies where kind = 'pick_shortage' and status = 'open' and warehouse_id = $1", [s.wh]))).rows[0].n;
    assert.equal(oc, 1);
    await chamar(s.u.separador, "complete_picking_task", t.id, chave(), null);
    assert.equal(await statusPedido(ped), "picking", "não confirma separação fictícia");
    const oi = (await admin((c) => c.query("select id from wms.order_items where order_id = $1", [ped]))).rows[0].id;
    await falha(chamar(s.u.separador, "reallocate_order_item", oi, chave()), 403);
    const r = await chamar<{ reallocated: boolean }>(s.u.supervisor, "reallocate_order_item", oi, chave());
    assert.equal(r.reallocated, true);
    await separarTudo(s, ped);
    assert.equal(await statusPedido(ped), "picked");
    await conferirInvariantes(s.wh);
  });

  test("conferência: produto errado e divergência bloqueiam o fechamento", async () => {
    const s = await criarCenario();
    await darEntrada(s, "simples", 5, "A-01");
    await darEntrada(s, "outro", 5, "A-02");
    const ped = await criarPedido(s, [{ produto: "simples", quantidade: 2 }]);
    await chamar(s.u.supervisor, "allocate_order", ped, chave(), null);
    await separarTudo(s, ped);
    await chamar(s.u.conferente, "start_packing", ped, chave());
    const vol = await chamar<{ package_id: string }>(s.u.conferente, "open_package", ped, chave());
    await falha(chamar(s.u.conferente, "pack_scan", vol.package_id, uuid(), s.skus.outro, 1, null, null, null), 409, "wrong_product");
    await chamar(s.u.conferente, "pack_scan", vol.package_id, uuid(), s.skus.simples, 1, null, null, null);
    await falha(chamar(s.u.conferente, "pack_scan", vol.package_id, uuid(), s.skus.simples, 2, null, null, null), 409, "over_pack");
    await chamar(s.u.conferente, "close_package", vol.package_id, null, null, null, null, chave());
    await falha(chamar(s.u.conferente, "complete_packing", ped, chave()), 409, "packing_divergence");
  });

  test("despacho exige liberação fiscal quando a política do armazém pede", async () => {
    const s = await criarCenario({ fiscal: true });
    await darEntrada(s, "simples", 2, "A-01");
    const ped = await criarPedido(s, [{ produto: "simples", quantidade: 1 }]);
    await chamar(s.u.supervisor, "allocate_order", ped, chave(), null);
    await separarTudo(s, ped);
    const vol = await embalarTudo(s, ped);
    const rem = await chamar<{ shipment_id: string }>(s.u.expedicao, "create_shipment", s.wh, "", null, chave());
    await chamar(s.u.expedicao, "add_order_to_shipment", rem.shipment_id, ped, chave());
    await chamar(s.u.expedicao, "load_scan", rem.shipment_id, uuid(), vol.label_code);
    const e = await falha(chamar(s.u.expedicao, "dispatch_shipment", rem.shipment_id, chave(), null), 409, "dispatch_blocked");
    assert.ok(Array.isArray(e.dados));
    await admin((c) => c.query("update wms.orders set fiscal_status = 'released' where id = $1", [ped]));
    await chamar(s.u.expedicao, "dispatch_shipment", rem.shipment_id, chave(), null);
    assert.equal(await statusPedido(ped), "dispatched");
  });

  test("transferência entre armazéns passa por trânsito", async () => {
    const s = await criarCenario();
    await darEntrada(s, "simples", 10, "A-01");
    const t = await chamar<{ transfer_id: string }>(s.u.supervisor, "create_transfer_order", s.wh, s.wh2,
      json([{ product_id: s.p.simples, location_code: "A-01", quantity: 4 }]), chave());
    await chamar(s.u.supervisor, "ship_transfer_order", t.transfer_id, chave());
    const transito = (await admin((c) => c.query(
      "select sum(b.quantity)::float q from wms.stock_balances b join wms.locations l on l.id = b.location_id where l.warehouse_id = $1 and l.code = 'TRANSITO' and b.condition = 'in_transit'", [s.wh2]))).rows[0].q;
    assert.equal(transito, 4);
    await chamar(s.u.supervisor, "receive_transfer_item", t.transfer_id, uuid(), s.skus.simples, 3, null, null);
    await chamar(s.u.supervisor, "close_transfer_with_discrepancy", t.transfer_id, "Faltou 1 na chegada", chave());
    const st = (await admin((c) => c.query("select status from wms.transfer_orders where id = $1", [t.transfer_id]))).rows[0].status;
    assert.equal(st, "closed_with_discrepancy");
    await conferirInvariantes(s.wh);
    await conferirInvariantes(s.wh2);
  });

  test("reabastecimento cria tarefa a partir do pulmão sem saldo artificial", async () => {
    const s = await criarCenario();
    await darEntrada(s, "outro", 20, "B-01");
    const loc = (await admin((c) => c.query("select id from wms.locations where warehouse_id = $1 and code = 'A-01'", [s.wh]))).rows[0].id;
    await chamar(s.u.admin, "set_location_product_limits", loc, s.p.outro, 2, 8);
    const g = await chamar<{ tasks_created: number }>(s.u.estoquista, "generate_replenishment", s.wh, chave());
    assert.equal(g.tasks_created, 1);
    const g2 = await chamar<{ tasks_created: number }>(s.u.estoquista, "generate_replenishment", s.wh, chave());
    assert.equal(g2.tasks_created, 0, "não duplica tarefa aberta");
    const t = (await admin((c) => c.query("select id, quantity::float q from wms.putaway_tasks where kind = 'replenishment' and warehouse_id = $1", [s.wh]))).rows[0];
    assert.equal(t.q, 8);
    assert.equal((await saldo(s, s.p.outro)).quantity, 20);
    await chamar(s.u.estoquista, "confirm_putaway", t.id, "B-01", s.skus.outro, "A-01", chave());
    assert.equal((await saldo(s, s.p.outro, "A-01")).quantity, 8);
  });

  test("capacidade do endereço é respeitada", async () => {
    const s = await criarCenario();
    await darEntrada(s, "outro", 1000, "B-02");
    await darEntrada(s, "simples", 1, "A-01");
    await falha(chamar(s.u.estoquista, "transfer_stock", s.wh, "A-01", "B-02", s.skus.simples, 1, null, null, null, null, chave()), 409, "location_capacity");
  });
});
