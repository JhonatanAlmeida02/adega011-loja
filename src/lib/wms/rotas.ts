/**
 * Registro das rotas da API interna do WMS (/api/wms/...). Estas rotas são do
 * WMS, não endpoints da Olist. Cada comando vira uma chamada a uma função
 * `wms.*` que revalida identidade, permissão, escopo, estado e versão no banco.
 */
import type { PoolClient } from "pg";
import { z } from "zod";
import { json, rpc } from "./db";
import { WmsErro } from "./erros";

const id = z.string().uuid();
const qtd = z.number().finite().positive().max(1e9);
const codigo = z.string().trim().min(1).max(64);
const texto = (max = 500) => z.string().trim().max(max);
const opc = <T extends z.ZodType>(s: T) => s.nullish().transform((v) => v ?? null);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const versao = opc(z.number().int().nonnegative());
const motivo = z.string().trim().min(3).max(500);
const itens = z.array(z.object({ product_id: id, quantity: qtd })).min(1).max(500);
const leitura = { scan_id: id, code: codigo, quantity: qtd, lot_code: opc(codigo), expiry: opc(data), serial: opc(codigo), product_id: opc(id) };

type Params = Record<string, string>;
export type DefComando = {
  metodo: "POST";
  caminho: string;
  fn: string;
  schema: z.ZodType;
  args: (e: any, p: Params, chave: string) => unknown[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Leituras do coletor usam o scan_id como chave; demais comandos exigem Idempotency-Key. */
  semChave?: boolean;
};
export type DefConsulta = { metodo: "GET"; caminho: string; executar: (c: PoolClient, q: URLSearchParams, p: Params) => Promise<unknown> };

const cmd = (caminho: string, fn: string, schema: z.ZodType, args: DefComando["args"], semChave = false): DefComando =>
  ({ metodo: "POST", caminho, fn, schema, args, semChave });

export const COMANDOS: DefComando[] = [
  // Recebimento e armazenagem
  cmd("receipts", "create_manual_receipt", z.object({ warehouse_id: id, source_ref: codigo, supplier: opc(texto(200)), items: itens, quarantine: z.boolean().default(false) }),
    (e, _p, k) => [e.warehouse_id, e.source_ref, e.supplier ?? "", json(e.items), e.quarantine, k]),
  cmd("receipts/:id/scan", "receipt_scan", z.object({ ...leitura, outcome: z.enum(["accepted", "damaged", "rejected"]).default("accepted") }),
    (e, p) => [p.id, e.scan_id, e.code, e.quantity, e.lot_code, e.expiry, e.serial, e.outcome, e.product_id], true),
  cmd("receipts/:id/confirm", "confirm_receipt", z.object({ expected_version: versao }), (e, p, k) => [p.id, k, e.expected_version]),
  cmd("receipts/:id/close-short", "close_receipt_short", z.object({ reason: motivo }), (e, p, k) => [p.id, e.reason, k]),
  cmd("receipts/:id/cancel", "cancel_receipt", z.object({ reason: motivo }), (e, p, k) => [p.id, e.reason, k]),
  cmd("receipt-items/:id/approve-overage", "review_receipt_overage", z.object({ approved_qty: z.number().finite().nonnegative(), note: texto() }),
    (e, p, k) => [p.id, e.approved_qty, e.note, k]),
  cmd("receipt-checks/:id/void", "void_receipt_check", z.object({ reason: motivo }), (e, p) => [p.id, e.reason], true),
  cmd("putaway-tasks/:id/confirm", "confirm_putaway", z.object({ from_code: codigo, code: codigo, to_code: codigo }),
    (e, p, k) => [p.id, e.from_code, e.code, e.to_code, k]),
  // Estoque
  cmd("stock/transfers", "transfer_stock", z.object({ warehouse_id: id, from_code: codigo, to_code: codigo, code: codigo, quantity: qtd,
    lot_code: opc(codigo), serial: opc(codigo), product_id: opc(id), reason: opc(texto(200)) }),
    (e, _p, k) => [e.warehouse_id, e.from_code, e.to_code, e.code, e.quantity, e.lot_code, e.serial, e.product_id, e.reason, k]),
  cmd("stock/condition", "change_stock_condition", z.object({ warehouse_id: id, location_code: codigo, product_id: id, lot_code: opc(codigo), serial: opc(codigo),
    from: z.enum(["available", "quarantine", "blocked", "damaged"]), to: z.enum(["available", "quarantine", "blocked", "damaged"]), quantity: qtd, reason: motivo }),
    (e, _p, k) => [e.warehouse_id, e.location_code, e.product_id, e.lot_code, e.serial, e.from, e.to, e.quantity, e.reason, k]),
  cmd("stock/movements/:id/reverse", "reverse_movement", z.object({ reason: motivo }), (e, p, k) => [p.id, e.reason, k]),
  cmd("stock/replenishment", "generate_replenishment", z.object({ warehouse_id: id }), (e, _p, k) => [e.warehouse_id, k]),
  // Pedidos e separação
  cmd("orders", "create_manual_order", z.object({ warehouse_id: id, number: codigo, customer: opc(texto(200)), items: itens }),
    (e, _p, k) => [e.warehouse_id, e.number, e.customer ?? "", json(e.items), k]),
  cmd("orders/:id/allocate", "allocate_order", z.object({ expected_version: versao }), (e, p, k) => [p.id, k, e.expected_version]),
  cmd("orders/:id/cancel", "cancel_order", z.object({ reason: motivo }), (e, p, k) => [p.id, e.reason, k]),
  cmd("orders/:id/reconcile", "reconcile_order_revision", z.object({}), (_e, p, k) => [p.id, k]),
  cmd("waves", "create_wave", z.object({ warehouse_id: id, order_ids: z.array(id).min(1).max(200) }), (e, _p, k) => [e.warehouse_id, e.order_ids, k]),
  cmd("picking-tasks/:id/claim", "claim_picking_task", z.object({ expected_version: z.number().int() }), (e, p) => [p.id, e.expected_version], true),
  cmd("picking-tasks/:id/assign", "assign_picking_task", z.object({ user_id: opc(id), expected_version: z.number().int() }), (e, p) => [p.id, e.user_id, e.expected_version], true),
  cmd("picking-tasks/:id/scan", "pick_scan", z.object({ scan_id: id, location_code: codigo, code: codigo, quantity: qtd, lot_code: opc(codigo), serial: opc(codigo), product_id: opc(id) }),
    (e, p) => [p.id, e.scan_id, e.location_code, e.code, e.quantity, e.lot_code, e.serial, e.product_id], true),
  cmd("picking-tasks/:id/short", "pick_short", z.object({ item_id: id, quantity: qtd, reason: motivo }), (e, p, k) => [p.id, e.item_id, e.quantity, e.reason, k]),
  cmd("picking-tasks/:id/complete", "complete_picking_task", z.object({ expected_version: versao }), (e, p, k) => [p.id, k, e.expected_version]),
  cmd("order-items/:id/reallocate", "reallocate_order_item", z.object({}), (_e, p, k) => [p.id, k]),
  // Conferência, embalagem e expedição
  cmd("orders/:id/packing/start", "start_packing", z.object({}), (_e, p, k) => [p.id, k]),
  cmd("orders/:id/packages", "open_package", z.object({}), (_e, p, k) => [p.id, k]),
  cmd("orders/:id/packing/complete", "complete_packing", z.object({}), (_e, p, k) => [p.id, k]),
  cmd("packages/:id/scan", "pack_scan", z.object({ scan_id: id, code: codigo, quantity: qtd, lot_code: opc(codigo), serial: opc(codigo), product_id: opc(id) }),
    (e, p) => [p.id, e.scan_id, e.code, e.quantity, e.lot_code, e.serial, e.product_id], true),
  cmd("packages/:id/close", "close_package", z.object({ weight_kg: opc(z.number().positive().max(10000)), length_cm: opc(z.number().positive()),
    width_cm: opc(z.number().positive()), height_cm: opc(z.number().positive()) }),
    (e, p, k) => [p.id, e.weight_kg, e.length_cm, e.width_cm, e.height_cm, k]),
  cmd("packages/:id/label", "register_label_print", z.object({ reason: opc(texto(200)) }), (e, p) => [p.id, e.reason], true),
  cmd("package-items/:id/remove", "remove_package_item", z.object({ quantity: qtd, reason: motivo }), (e, p) => [p.id, e.quantity, e.reason], true),
  cmd("shipments", "create_shipment", z.object({ warehouse_id: id, carrier: opc(texto(120)), dock_code: opc(codigo) }), (e, _p, k) => [e.warehouse_id, e.carrier ?? "", e.dock_code, k]),
  cmd("shipments/:id/orders", "add_order_to_shipment", z.object({ order_id: id }), (e, p, k) => [p.id, e.order_id, k]),
  cmd("shipments/:id/orders/remove", "remove_order_from_shipment", z.object({ order_id: id }), (e, p) => [p.id, e.order_id], true),
  cmd("shipments/:id/load", "load_scan", z.object({ scan_id: id, label: codigo }), (e, p) => [p.id, e.scan_id, e.label], true),
  cmd("shipments/:id/dispatch", "dispatch_shipment", z.object({ expected_version: versao }), (e, p, k) => [p.id, k, e.expected_version]),
  // Inventário
  cmd("inventory-sessions", "create_inventory_session", z.object({ warehouse_id: id, kind: z.enum(["cycle", "full", "initial_load"]),
    location_codes: z.array(codigo).min(1).max(2000), tolerance_qty: z.number().nonnegative().default(0), tolerance_pct: z.number().min(0).max(100).default(0),
    max_rounds: z.number().int().min(1).max(5).default(2) }),
    (e, _p, k) => [e.warehouse_id, e.kind, e.location_codes, e.tolerance_qty, e.tolerance_pct, e.max_rounds, k]),
  cmd("inventory-sessions/:id/start", "start_inventory_session", z.object({}), (_e, p, k) => [p.id, k]),
  cmd("inventory-sessions/:id/counts", "record_inventory_count", z.object({ count_id: id, location_code: codigo, code: codigo, quantity: z.number().finite().nonnegative(),
    lot_code: opc(codigo), expiry: opc(data), product_id: opc(id) }),
    (e, p) => [p.id, e.count_id, e.location_code, e.code, e.quantity, e.lot_code, e.expiry, e.product_id], true),
  cmd("inventory-sessions/:id/close-round", "close_inventory_round", z.object({}), (_e, p, k) => [p.id, k]),
  cmd("inventory-sessions/:id/cancel", "cancel_inventory_session", z.object({ reason: motivo }), (e, p, k) => [p.id, e.reason, k]),
  cmd("inventory-adjustments/:id/approve", "approve_inventory_adjustment", z.object({}), (_e, p, k) => [p.id, k]),
  cmd("inventory-adjustments/:id/reject", "reject_inventory_adjustment", z.object({ reason: motivo }), (e, p, k) => [p.id, e.reason, k]),
  // Devoluções, qualidade e transferências
  cmd("returns", "create_return", z.object({ warehouse_id: id, order_id: opc(id), reason: opc(texto()), items: itens }),
    (e, _p, k) => [e.warehouse_id, e.order_id, e.reason ?? "", json(e.items), k]),
  cmd("returns/:id/receive", "receive_return_item", z.object(leitura), (e, p) => [p.id, e.scan_id, e.code, e.quantity, e.lot_code, e.expiry, e.serial, e.product_id], true),
  cmd("quality/decisions", "decide_quality", z.object({ warehouse_id: id, from_code: codigo, product_id: id, lot_code: opc(codigo), serial: opc(codigo),
    from_condition: z.enum(["quarantine", "damaged", "blocked"]), quantity: qtd, decision: z.enum(["reintegrate", "repair", "discard", "return_to_supplier"]),
    to_code: opc(codigo), notes: opc(texto()), return_item_id: opc(id) }),
    (e, _p, k) => [e.warehouse_id, e.from_code, e.product_id, e.lot_code, e.serial, e.from_condition, e.quantity, e.decision, e.to_code, e.notes ?? "", e.return_item_id, k]),
  cmd("transfers", "create_transfer_order", z.object({ from_warehouse_id: id, to_warehouse_id: id,
    items: z.array(z.object({ product_id: id, location_code: codigo, lot_code: opc(codigo), quantity: qtd })).min(1).max(500) }),
    (e, _p, k) => [e.from_warehouse_id, e.to_warehouse_id, json(e.items), k]),
  cmd("transfers/:id/ship", "ship_transfer_order", z.object({}), (_e, p, k) => [p.id, k]),
  cmd("transfers/:id/receive", "receive_transfer_item", z.object({ scan_id: id, code: codigo, quantity: qtd, lot_code: opc(codigo), product_id: opc(id) }),
    (e, p) => [p.id, e.scan_id, e.code, e.quantity, e.lot_code, e.product_id], true),
  cmd("transfers/:id/close-discrepancy", "close_transfer_with_discrepancy", z.object({ reason: motivo }), (e, p, k) => [p.id, e.reason, k]),
  cmd("discrepancies/:id/resolve", "resolve_discrepancy", z.object({ status: z.enum(["resolved", "dismissed"]), resolution: motivo }),
    (e, p) => [p.id, e.status, e.resolution], true),
  // Administração
  cmd("admin/organization", "update_organization_settings", z.object({ organization_id: id, name: opc(texto(120)), require_mfa: opc(z.boolean()) }),
    (e) => [e.organization_id, e.name, e.require_mfa], true),
  cmd("admin/warehouses", "create_warehouse", z.object({ organization_id: id, code: codigo, name: texto(120).min(1) }), (e, _p, k) => [e.organization_id, e.code, e.name, k]),
  cmd("admin/warehouses/:id", "update_warehouse", z.object({ name: opc(texto(120)), require_fiscal_release: opc(z.boolean()), status: opc(z.enum(["active", "inactive"])) }),
    (e, p) => [p.id, e.name, e.require_fiscal_release, e.status], true),
  cmd("admin/zones", "upsert_zone", z.object({ warehouse_id: id, code: codigo, name: opc(texto(120)) }), (e) => [e.warehouse_id, e.code, e.name ?? ""], true),
  cmd("admin/locations", "upsert_location", z.object({ warehouse_id: id, code: codigo, type: z.enum(["receiving", "storage", "picking", "staging", "packing", "dock", "quarantine", "returns", "transit"]),
    zone_code: opc(codigo), pickable: z.boolean().default(false), capacity_units: opc(z.number().positive()), sort_order: z.number().int().default(0) }),
    (e) => [e.warehouse_id, e.code, e.type, e.zone_code, e.pickable, e.capacity_units, e.sort_order], true),
  cmd("admin/locations/:id/block", "set_location_block", z.object({ blocked: z.boolean(), reason: opc(texto(200)) }), (e, p) => [p.id, e.blocked, e.reason], true),
  cmd("admin/location-limits", "set_location_product_limits", z.object({ location_id: id, product_id: id, min_qty: z.number().nonnegative(), max_qty: z.number().positive() }),
    (e) => [e.location_id, e.product_id, e.min_qty, e.max_qty], true),
  cmd("admin/products", "upsert_product", z.object({ organization_id: id, sku: codigo, description: texto(200).min(1), gtin: opc(z.string().regex(/^[0-9]{8,14}$/)),
    base_unit: z.string().regex(/^[A-Z0-9]{1,6}$/).default("UN"), lot_control: z.boolean().default(false), expiry_control: z.boolean().default(false),
    serial_control: z.boolean().default(false), min_shelf_days: z.number().int().min(0).max(3650).default(0), kit_policy: z.enum(["none", "components", "assembled"]).default("none") }),
    (e) => [e.organization_id, e.sku, e.description, e.gtin, e.base_unit, e.lot_control, e.expiry_control, e.serial_control, e.min_shelf_days, e.kit_policy], true),
  cmd("admin/products/:id/units", "upsert_product_unit", z.object({ code: z.string().regex(/^[A-Z0-9]{1,10}$/), factor: qtd, barcode: opc(codigo) }),
    (e, p) => [p.id, e.code, e.factor, e.barcode], true),
  cmd("admin/products/:id/barcodes", "add_barcode", z.object({ barcode: codigo }), (e, p) => [p.id, e.barcode], true),
  cmd("admin/products/:id/kit", "set_kit_components", z.object({ components: z.array(z.object({ product_id: id, quantity: qtd })).max(100) }),
    (e, p) => [p.id, json(e.components)], true),
  cmd("admin/members", "save_member", z.object({ organization_id: id, user_id: id, full_name: opc(texto(120)), roles: z.array(z.string().regex(/^[a-z_]{2,40}$/)).min(1),
    all_warehouses: z.boolean().default(false), warehouse_ids: z.array(id).default([]) }),
    (e) => [e.organization_id, e.user_id, e.full_name ?? "", e.roles, e.all_warehouses, e.warehouse_ids], true),
  cmd("admin/members/:id/active", "set_member_active", z.object({ active: z.boolean() }), (e, p) => [p.id, e.active], true),
  // Integração
  cmd("integrations/connections", "create_connection", z.object({ organization_id: id, name: opc(texto(80)), adapter: z.enum(["mock", "olist_v3"]) }),
    (e, _p, k) => [e.organization_id, e.name, e.adapter, k]),
  cmd("integrations/connections/:id", "update_connection", z.object({ eligible_statuses: opc(z.array(z.string().max(10)).max(20)),
    cancelled_statuses: opc(z.array(z.string().max(10)).max(20)), write_enabled: opc(z.boolean()), paused: opc(z.boolean()) }),
    (e, p) => [p.id, e.eligible_statuses, e.cancelled_statuses, e.write_enabled, e.paused], true),
  cmd("integrations/connections/:id/deposits/map", "map_deposit", z.object({ external_id: codigo, warehouse_id: id }), (e, p) => [p.id, e.external_id, e.warehouse_id], true),
  cmd("integrations/connections/:id/policy", "set_stock_posting_policy", z.object({ warehouse_id: id,
    outbound: z.enum(["undefined", "erp_on_invoice", "wms_on_dispatch"]), inbound: z.enum(["undefined", "erp_on_document", "wms_on_receipt"]),
    validated: z.boolean(), notes: opc(texto(1000)) }),
    (e, p) => [p.id, e.warehouse_id, e.outbound, e.inbound, e.validated, e.notes ?? ""], true),
  cmd("integrations/connections/:id/sync", "request_sync_job", z.object({ kind: z.enum(["import_products", "import_deposits", "import_orders", "import_purchase_orders", "reconcile_stock", "refresh_token"]),
    params: z.record(z.string(), z.unknown()).default({}) }),
    (e, p) => [p.id, e.kind, json(e.params)], true),
  cmd("integration-events/:id/resolve", "resolve_outbox_event", z.object({ action: z.enum(["retry", "mark_applied", "cancel"]), note: opc(texto(1000)) }),
    (e, p, k) => [p.id, e.action, e.note ?? "", k]),
  cmd("integration-inbox/:id/retry", "retry_inbox_event", z.object({}), (_e, p) => [p.id], true),
];

// ---------------------------------------------------------------------
// Consultas (RLS aplicado: só o que o usuário pode ver)
// ---------------------------------------------------------------------
const lim = (q: URLSearchParams) => Math.min(Math.max(Number(q.get("limite") ?? 50) || 50, 1), 200);
const off = (q: URLSearchParams) => (Math.max(Number(q.get("pagina") ?? 1) || 1, 1) - 1) * lim(q);
const uuidOuNulo = (v: string | null) => (v && id.safeParse(v).success ? v : null);
const exigirWh = (q: URLSearchParams) => {
  const w = uuidOuNulo(q.get("warehouse_id"));
  if (!w) throw new WmsErro(422, "parametro_invalido", "Informe warehouse_id.");
  return w;
};
const linhas = async (c: PoolClient, sql: string, p: unknown[]) => (await c.query(sql, p)).rows;
const uma = async (c: PoolClient, sql: string, p: unknown[]) => {
  const r = (await c.query(sql, p)).rows[0];
  if (!r) throw new WmsErro(404, "nao_encontrado", "Registro não encontrado.");
  return r;
};
const busca = (q: URLSearchParams) => {
  const t = (q.get("q") ?? "").trim().slice(0, 64);
  return t ? `%${t.replace(/[%_\\]/g, "\\$&")}%` : null;
};
const get = (caminho: string, executar: DefConsulta["executar"]): DefConsulta => ({ metodo: "GET", caminho, executar });

export const CONSULTAS: DefConsulta[] = [
  get("me", (c) => rpc(c, "me", [])),
  get("orders", (c, q) => linhas(c, `
    select o.id, o.number, o.customer_name, o.status, o.hold_reason, o.erp_status, o.fiscal_status, o.integration_status,
           o.revision, o.version, o.ship_by, o.created_at, o.external_id,
           (select count(*) from wms.order_items i where i.order_id = o.id and not i.superseded and i.kind <> 'kit_parent') as lines
      from wms.orders o
     where o.warehouse_id = $1 and ($2::text is null or o.status = $2) and ($3::text is null or o.number ilike $3 or o.customer_name ilike $3 or o.external_id ilike $3)
     order by o.created_at desc limit $4 offset $5`, [exigirWh(q), q.get("status"), busca(q), lim(q), off(q)])),
  get("orders/:id", async (c, _q, p) => ({
    order: await uma(c, "select * from wms.orders where id = $1", [p.id]),
    items: await linhas(c, `select i.*, pr.sku, pr.description, pr.image_url from wms.order_items i join wms.products pr on pr.id = i.product_id
                             where i.order_id = $1 and not i.superseded order by i.line_no`, [p.id]),
    reservations: await linhas(c, `select r.id, r.order_item_id, r.status, r.quantity, l.code as location, lt.code as lot from wms.stock_reservations r
                                    join wms.locations l on l.id = r.location_id left join wms.lots lt on lt.id = r.lot_id
                                   where r.order_id = $1 and r.status in ('active','staged') order by l.code`, [p.id]),
    tasks: await linhas(c, "select id, status, assigned_to, version, zone_id from wms.picking_tasks where order_id = $1 order by created_at", [p.id]),
    packages: await linhas(c, `select pk.id, pk.label_code, pk.status, pk.weight_kg, pk.label_print_count,
                                      (select coalesce(jsonb_agg(jsonb_build_object('id', pi.id, 'sku', pr.sku, 'quantity', pi.quantity)), '[]') from wms.package_items pi
                                         join wms.products pr on pr.id = pi.product_id where pi.package_id = pk.id) as items
                                 from wms.packages pk where pk.order_id = $1 order by pk.created_at`, [p.id]),
    revisions: await linhas(c, "select revision, received_at, external_version from wms.order_revisions where order_id = $1 order by revision", [p.id]),
  })),
  get("receipts", (c, q) => linhas(c, `
    select r.id, r.source_type, r.source_ref, r.supplier_name, r.status, r.version, r.created_at, r.closed_at,
           (select coalesce(sum(expected_qty),0) from wms.receipt_items i where i.receipt_id = r.id) as expected,
           (select coalesce(sum(received_qty),0) from wms.receipt_items i where i.receipt_id = r.id) as received
      from wms.receipts r where r.warehouse_id = $1 and ($2::text is null or r.status = $2) and ($3::text is null or r.source_ref ilike $3 or r.supplier_name ilike $3)
     order by r.created_at desc limit $4 offset $5`, [exigirWh(q), q.get("status"), busca(q), lim(q), off(q)])),
  get("receipts/:id", async (c, _q, p) => ({
    receipt: await uma(c, "select * from wms.receipts where id = $1", [p.id]),
    items: await linhas(c, `select i.*, pr.sku, pr.description, pr.lot_control, pr.expiry_control, pr.serial_control,
                                   (select coalesce(sum(quantity),0) from wms.receipt_checks ch where ch.receipt_item_id = i.id and ch.movement_id is null and ch.outcome <> 'rejected') as pending_checked
                              from wms.receipt_items i join wms.products pr on pr.id = i.product_id where i.receipt_id = $1 order by i.line_no`, [p.id]),
    checks: await linhas(c, `select ch.id, ch.quantity, ch.unit_code, ch.lot_code, ch.expiry_date, ch.serial, ch.outcome, ch.movement_id, ch.created_at, pr.sku
                               from wms.receipt_checks ch join wms.products pr on pr.id = ch.product_id where ch.receipt_id = $1 order by ch.created_at desc limit 200`, [p.id]),
  })),
  get("putaway-tasks", (c, q) => linhas(c, `
    select t.id, t.kind, t.quantity, t.status, t.version, t.created_at, pr.sku, pr.description, lt.code as lot, sn.serial,
           f.code as from_code, s.code as suggested_code
      from wms.putaway_tasks t join wms.products pr on pr.id = t.product_id join wms.locations f on f.id = t.from_location_id
      left join wms.locations s on s.id = t.suggested_location_id left join wms.lots lt on lt.id = t.lot_id left join wms.serial_numbers sn on sn.id = t.serial_id
     where t.warehouse_id = $1 and t.status = coalesce($2, 'open') order by t.created_at limit $3 offset $4`, [exigirWh(q), q.get("status"), lim(q), off(q)])),
  get("picking-tasks", (c, q) => linhas(c, `
    select t.id, t.status, t.assigned_to, t.version, t.created_at, o.number, o.id as order_id, z.code as zone, w.code as wave,
           (select coalesce(sum(quantity - picked_qty - short_qty),0) from wms.picking_items pi where pi.task_id = t.id and pi.status = 'open') as remaining
      from wms.picking_tasks t join wms.orders o on o.id = t.order_id
      left join wms.warehouse_zones z on z.id = t.zone_id left join wms.waves w on w.id = t.wave_id
     where t.warehouse_id = $1 and t.status in ('open','in_progress') and ($2::boolean is not true or t.assigned_to = auth.uid() or t.assigned_to is null)
     order by t.created_at limit $3 offset $4`, [exigirWh(q), q.get("mine") === "1", lim(q), off(q)])),
  get("picking-tasks/:id", async (c, _q, p) => ({
    task: await uma(c, "select t.*, o.number, o.status as order_status, o.hold_reason from wms.picking_tasks t join wms.orders o on o.id = t.order_id where t.id = $1", [p.id]),
    items: await linhas(c, `select pi.id, pi.quantity, pi.picked_qty, pi.short_qty, pi.status, l.code as location, pr.sku, pr.description, pr.image_url,
                                   pr.lot_control, pr.serial_control, pr.base_unit, lt.code as lot, lt.expiry_date
                              from wms.picking_items pi join wms.locations l on l.id = pi.location_id join wms.products pr on pr.id = pi.product_id
                              left join wms.lots lt on lt.id = pi.lot_id where pi.task_id = $1 order by l.sort_order, l.code`, [p.id]),
  })),
  get("stock/balances", (c, q) => linhas(c, `
    select a.location_code, a.location_type, a.condition, a.quantity, a.reserved, a.available, a.eligible, a.lot_code, a.expiry_date,
           pr.id as product_id, pr.sku, pr.description, pr.base_unit
      from wms.v_stock_availability a join wms.products pr on pr.id = a.product_id
     where a.warehouse_id = $1 and a.quantity > 0 and ($2::text is null or pr.sku ilike $2 or pr.description ilike $2 or a.location_code ilike $2 or pr.gtin ilike $2)
     order by pr.sku, a.location_code limit $3 offset $4`, [exigirWh(q), busca(q), lim(q), off(q)])),
  get("stock/movements", (c, q) => linhas(c, `
    select m.id, m.movement_type, m.reason, m.reference_type, m.reference_id, m.erp_posting, m.created_at, m.created_by, m.reverses_movement_id,
           (select jsonb_agg(jsonb_build_object('location', l.code, 'sku', pr.sku, 'lot', lt.code, 'condition', e.condition, 'quantity', e.quantity) order by e.id)
              from wms.stock_entries e join wms.locations l on l.id = e.location_id join wms.products pr on pr.id = e.product_id
              left join wms.lots lt on lt.id = e.lot_id where e.movement_id = m.id) as entries
      from wms.stock_movements m where m.warehouse_id = $1 and ($2::text is null or m.movement_type = $2)
     order by m.created_at desc limit $3 offset $4`, [exigirWh(q), q.get("tipo"), lim(q), off(q)])),
  get("shipments", (c, q) => linhas(c, `
    select s.id, s.code, s.carrier, s.status, s.version, s.created_at, s.dispatched_at,
           (select count(*) from wms.shipment_packages sp where sp.shipment_id = s.id) as packages,
           (select count(*) from wms.shipment_packages sp where sp.shipment_id = s.id and sp.loaded_at is not null) as loaded
      from wms.shipments s where s.warehouse_id = $1 order by s.created_at desc limit $2 offset $3`, [exigirWh(q), lim(q), off(q)])),
  get("shipments/:id", async (c, _q, p) => ({
    shipment: await uma(c, "select * from wms.shipments where id = $1", [p.id]),
    packages: await linhas(c, `select sp.package_id, sp.loaded_at, pk.label_code, o.number, o.id as order_id, o.status as order_status, o.fiscal_status
                                 from wms.shipment_packages sp join wms.packages pk on pk.id = sp.package_id join wms.orders o on o.id = sp.order_id
                                where sp.shipment_id = $1 order by o.number, pk.label_code`, [p.id]),
  })),
  get("inventory-sessions", (c, q) => linhas(c, `
    select s.id, s.code, s.kind, s.status, s.current_round, s.max_rounds, s.created_at, s.closed_at,
           (select count(*) from wms.inventory_session_locations l where l.session_id = s.id) as locations
      from wms.inventory_sessions s where s.warehouse_id = $1 order by s.created_at desc limit $2 offset $3`, [exigirWh(q), lim(q), off(q)])),
  get("inventory-sessions/:id", async (c, _q, p) => {
    const s = await uma(c, "select * from wms.inventory_sessions where id = $1", [p.id]);
    const gerencia = (await c.query("select wms.has_permission($1, 'inventory.manage', $2) or wms.has_permission($1, 'inventory.approve', $2) as ok",
      [s.organization_id, s.warehouse_id])).rows[0].ok as boolean;
    return {
      session: s,
      // Contagem cega: o contador recebe só os endereços (e quais estão em recontagem)
      locations: await linhas(c, `select l.code, sl.recount_round from wms.inventory_session_locations sl join wms.locations l on l.id = sl.location_id
                                   where sl.session_id = $1 order by l.code`, [p.id]),
      my_counts: await linhas(c, `select c.id, l.code as location, pr.sku, c.counted_qty, c.round, c.counted_at from wms.inventory_counts c
                                    join wms.locations l on l.id = c.location_id join wms.products pr on pr.id = c.product_id
                                   where c.session_id = $1 and c.counted_by = auth.uid() order by c.counted_at desc`, [p.id]),
      adjustments: gerencia ? await linhas(c, `select a.id, a.status, a.expected_qty, a.counted_qty, a.difference, a.requested_by, a.decided_by, l.code as location, pr.sku, lt.code as lot
                                                 from wms.inventory_adjustments a join wms.locations l on l.id = a.location_id join wms.products pr on pr.id = a.product_id
                                                 left join wms.lots lt on lt.id = a.lot_id where a.session_id = $1 order by l.code, pr.sku`, [p.id]) : null,
    };
  }),
  get("returns", (c, q) => linhas(c, `
    select r.id, r.code, r.status, r.reason, r.created_at, o.number as order_number,
           (select jsonb_agg(jsonb_build_object('id', ri.id, 'product_id', ri.product_id, 'sku', pr.sku, 'expected', ri.expected_qty, 'received', ri.received_qty, 'decided', ri.decided_qty))
              from wms.return_items ri join wms.products pr on pr.id = ri.product_id where ri.return_id = r.id) as items
      from wms.returns r left join wms.orders o on o.id = r.order_id where r.warehouse_id = $1 order by r.created_at desc limit $2 offset $3`, [exigirWh(q), lim(q), off(q)])),
  get("transfers", (c, q) => linhas(c, `
    select t.id, t.code, t.status, t.created_at, f.code as from_wh, d.code as to_wh,
           (select jsonb_agg(jsonb_build_object('sku', pr.sku, 'quantity', ti.quantity, 'shipped', ti.shipped_qty, 'received', ti.received_qty))
              from wms.transfer_items ti join wms.products pr on pr.id = ti.product_id where ti.transfer_id = t.id) as items
      from wms.transfer_orders t join wms.warehouses f on f.id = t.from_warehouse_id join wms.warehouses d on d.id = t.to_warehouse_id
     where t.from_warehouse_id = $1 or t.to_warehouse_id = $1 order by t.created_at desc limit $2 offset $3`, [exigirWh(q), lim(q), off(q)])),
  get("discrepancies", (c, q) => linhas(c, `
    select d.id, d.kind, d.entity_type, d.entity_id, d.quantity, d.details, d.status, d.created_at, d.resolution, pr.sku, l.code as location
      from wms.discrepancies d left join wms.products pr on pr.id = d.product_id left join wms.locations l on l.id = d.location_id
     where (d.warehouse_id = $1 or d.warehouse_id is null) and d.status = coalesce($2, 'open') order by d.created_at desc limit $3 offset $4`,
    [exigirWh(q), q.get("status"), lim(q), off(q)])),
  get("kpis", (c, q) => {
    const de = q.get("de") ? new Date(q.get("de")!) : new Date(Date.now() - 7 * 86_400_000);
    const ate = q.get("ate") ? new Date(q.get("ate")!) : new Date();
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) throw new WmsErro(422, "periodo_invalido", "Período inválido.");
    return rpc(c, "kpis", [exigirWh(q), de.toISOString(), ate.toISOString()]);
  }),
  get("products", (c, q) => linhas(c, `
    select p.id, p.sku, p.description, p.gtin, p.base_unit, p.lot_control, p.expiry_control, p.serial_control, p.kit_policy, p.status, p.min_shelf_days,
           (select jsonb_agg(jsonb_build_object('code', u.code, 'factor', u.factor)) from wms.product_units u where u.product_id = p.id) as units,
           (select jsonb_agg(b.barcode) from wms.product_barcodes b where b.product_id = p.id) as barcodes
      from wms.products p where ($1::text is null or p.sku ilike $1 or p.description ilike $1 or p.gtin ilike $1)
     order by p.sku limit $2 offset $3`, [busca(q), lim(q), off(q)])),
  get("locations", (c, q) => linhas(c, `
    select l.id, l.code, l.type, l.pickable, l.capacity_units, l.blocked, l.block_reason, l.counting_session_id is not null as counting, z.code as zone,
           (select coalesce(sum(b.quantity),0) from wms.stock_balances b where b.location_id = l.id) as quantity
      from wms.locations l left join wms.warehouse_zones z on z.id = l.zone_id where l.warehouse_id = $1 order by l.sort_order, l.code limit $2 offset $3`,
    [exigirWh(q), lim(q), off(q)])),
  get("admin/members", (c, q) => linhas(c, `
    select m.id, m.user_id, m.active, m.all_warehouses, pf.full_name,
           (select jsonb_agg(role_code) from wms.membership_roles r where r.membership_id = m.id) as roles,
           (select jsonb_agg(warehouse_id) from wms.warehouse_access a where a.membership_id = m.id) as warehouses
      from wms.memberships m left join wms.profiles pf on pf.user_id = m.user_id where m.organization_id = $1 order by pf.full_name`,
    [uuidOuNulo(q.get("organization_id"))])),
  get("integrations", async (c, q) => {
    const org = uuidOuNulo(q.get("organization_id"));
    return {
      connections: await linhas(c, `select id, name, adapter, status, status_reason, write_enabled, eligible_order_statuses, settings, access_token_expires_at, updated_at
                                       from wms.integration_connections where organization_id = $1 order by created_at`, [org]),
      deposits: await linhas(c, "select connection_id, external_id, name, warehouse_id from wms.erp_deposits where organization_id = $1 order by external_id", [org]),
      policies: await linhas(c, "select * from wms.stock_posting_policies where organization_id = $1", [org]),
      outbox: await linhas(c, `select status, count(*)::int n, min(created_at) as oldest from wms.outbox_events where organization_id = $1 group by status`, [org]),
      inbox: await linhas(c, `select status, count(*)::int n, min(received_at) as oldest from wms.inbox_events where organization_id = $1 group by status`, [org]),
      jobs: await linhas(c, `select id, kind, status, progress, last_error, attempts, created_at, finished_at from wms.integration_jobs
                              where organization_id = $1 order by created_at desc limit 20`, [org]),
    };
  }),
  get("integration-events", (c, q) => linhas(c, `
    select e.id, e.event_type, e.aggregate_type, e.aggregate_id, e.status, e.blocked_reason, e.attempts, e.last_error, e.external_ref,
           e.needs_verification, e.created_at, e.next_attempt_at, e.sent_at, e.correlation_id
      from wms.outbox_events e where e.organization_id = $1 and ($2::text is null or e.status = $2) order by e.created_at desc limit $3 offset $4`,
    [uuidOuNulo(q.get("organization_id")), q.get("status"), lim(q), off(q)])),
  get("integration-inbox", (c, q) => linhas(c, `
    select e.id, e.source, e.event_type, e.entity_external_id, e.status, e.attempts, e.last_error, e.received_at, e.processed_at
      from wms.inbox_events e where e.organization_id = $1 and ($2::text is null or e.status = $2) order by e.received_at desc limit $3 offset $4`,
    [uuidOuNulo(q.get("organization_id")), q.get("status"), lim(q), off(q)])),
  get("audit", (c, q) => linhas(c, `
    select a.id, a.action, a.entity_type, a.entity_id, a.data, a.actor_id, pf.full_name as actor, a.created_at, a.correlation_id, w.code as warehouse
      from wms.audit_events a left join wms.profiles pf on pf.user_id = a.actor_id left join wms.warehouses w on w.id = a.warehouse_id
     where a.organization_id = $1 and ($2::text is null or a.action ilike $2 or a.entity_id ilike $2)
     order by a.id desc limit $3 offset $4`, [uuidOuNulo(q.get("organization_id")), busca(q), lim(q), off(q)])),
];

// ---------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------
export function casarRota<T extends { caminho: string }>(defs: T[], segmentos: string[]): { def: T; params: Params } | null {
  for (const def of defs) {
    const partes = def.caminho.split("/");
    if (partes.length !== segmentos.length) continue;
    const params: Params = {};
    let ok = true;
    for (let i = 0; i < partes.length; i++) {
      if (partes[i].startsWith(":")) {
        if (!id.safeParse(segmentos[i]).success) { ok = false; break; }
        params[partes[i].slice(1)] = segmentos[i];
      } else if (partes[i] !== segmentos[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { def, params };
  }
  return null;
}
