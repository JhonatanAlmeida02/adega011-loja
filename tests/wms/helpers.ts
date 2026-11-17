/**
 * Auxiliares dos testes do WMS contra um PostgreSQL REAL local (nunca produção).
 * Prepare o banco com `bash scripts/wms-db-local.sh` e defina WMS_TEST_DATABASE_URL.
 * Cada cenário cria uma empresa própria (códigos aleatórios), então os testes não se misturam.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const URL_TESTE = process.env.WMS_TEST_DATABASE_URL ?? "";
if (URL_TESTE) {
  if (!/test|dev/.test(new URL(URL_TESTE).pathname)) {
    throw new Error("WMS_TEST_DATABASE_URL precisa apontar para um banco de teste (nome com 'test' ou 'dev').");
  }
  process.env.WMS_DATABASE_URL = URL_TESTE;
}
export const temBanco = Boolean(URL_TESTE);

import { comoUsuario, comoWorker, json, rpc, type Identidade } from "../../src/lib/wms/db";
import { WmsErro } from "../../src/lib/wms/erros";

export { json, comoWorker, rpc };
export const chave = () => `k-${randomUUID()}`;
export const uuid = () => randomUUID();

/** Conexão administrativa (dono do banco), só para preparar dados e conferir invariantes. */
export async function admin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: URL_TESTE });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export type Usuario = Identidade & { nome: string };

export function usuario(nome: string, aal: "aal1" | "aal2" = "aal2", extras: Record<string, unknown> = {}): Usuario {
  const userId = randomUUID();
  return { nome, userId, claims: { aal, ...extras } };
}

/** Chama wms.<fn>(...) como o usuário. */
export function chamar<T = Record<string, unknown>>(u: Identidade, fn: string, ...args: unknown[]): Promise<T> {
  return comoUsuario(u, (c) => rpc<T>(c, fn, args));
}

/** Consulta como o usuário (RLS aplicado). */
export function consultar<T = Record<string, unknown>>(u: Identidade, sql: string, params: unknown[] = []): Promise<T[]> {
  return comoUsuario(u, async (c) => (await c.query(sql, params)).rows as T[]);
}

/** Espera que a promessa falhe com o status HTTP (e opcionalmente o código) indicado. */
export async function falha(p: Promise<unknown>, status: number, codigo?: string): Promise<WmsErro> {
  try {
    await p;
  } catch (e) {
    if (!(e instanceof WmsErro)) throw e;
    if (e.status !== status || (codigo && e.codigo !== codigo)) {
      throw new Error(`Esperava ${status}${codigo ? "/" + codigo : ""}, veio ${e.status}/${e.codigo}: ${e.message}`);
    }
    return e;
  }
  throw new Error(`Esperava falha ${status}${codigo ? "/" + codigo : ""}, mas a operação passou.`);
}

export type Cenario = Awaited<ReturnType<typeof criarCenario>>;

export async function criarCenario(opcoes: { fiscal?: boolean } = {}) {
  const codigo = "T" + randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const u = {
    admin: usuario("admin"),
    supervisor: usuario("supervisor"),
    supervisor2: usuario("supervisor2"),
    recebimento: usuario("recebimento", "aal1"),
    estoquista: usuario("estoquista", "aal1"),
    separador: usuario("separador", "aal1"),
    separador2: usuario("separador2", "aal1"),
    conferente: usuario("conferente", "aal1"),
    expedicao: usuario("expedicao", "aal1"),
    auditor: usuario("auditor", "aal1"),
    semArmazem: usuario("sem-armazem", "aal1"),
  };
  await admin(async (c) => {
    for (const x of Object.values(u)) {
      await c.query("insert into auth.users (id, email) values ($1, $2)", [x.userId, `${x.nome}.${codigo}@wms.test`]);
    }
    await c.query("select wms.bootstrap_organization($1, $2, $3, 'Admin')", [u.admin.userId, codigo, `Empresa ${codigo}`]);
  });
  const org = (await admin((c) => c.query("select id from wms.organizations where code = $1", [codigo]))).rows[0].id as string;
  const wh = (await chamar<{ warehouse_id: string }>(u.admin, "create_warehouse", org, "CD1", "Centro 1", chave())).warehouse_id;
  const wh2 = (await chamar<{ warehouse_id: string }>(u.admin, "create_warehouse", org, "CD2", "Centro 2", chave())).warehouse_id;
  const papeis: [Usuario, string[], boolean, string[]][] = [
    [u.supervisor, ["supervisor"], true, []],
    [u.supervisor2, ["supervisor"], true, []],
    [u.recebimento, ["receiving"], false, [wh]],
    [u.estoquista, ["stocker"], false, [wh]],
    [u.separador, ["picker"], false, [wh]],
    [u.separador2, ["picker"], false, [wh]],
    [u.conferente, ["checker"], false, [wh]],
    [u.expedicao, ["shipping"], false, [wh]],
    [u.auditor, ["auditor"], false, [wh]],
    [u.semArmazem, ["stocker"], false, []],
  ];
  for (const [x, roles, todos, whs] of papeis) {
    await chamar(u.admin, "save_member", org, x.userId, x.nome, roles, todos, whs);
  }
  if (opcoes.fiscal === false) {
    await chamar(u.admin, "update_warehouse", wh, null, false, null);
  }

  await chamar(u.admin, "upsert_zone", wh, "A", "Picking");
  await chamar(u.admin, "upsert_zone", wh, "B", "Pulmão");
  for (const [code, type, zone, pickable, cap] of [
    ["A-01", "picking", "A", true, null],
    ["A-02", "picking", "A", true, null],
    ["B-01", "storage", "B", false, null],
    ["B-02", "storage", "B", true, 1000],
  ] as const) {
    await chamar(u.admin, "upsert_location", wh, code, type, zone, pickable, cap, 0);
  }
  await chamar(u.admin, "upsert_location", wh2, "A-01", "picking", null, true, null, 0);

  const sufixo = codigo.slice(1, 6);
  const prod = async (sku: string, gtin: string | null, flags: Partial<{ lot: boolean; exp: boolean; serial: boolean; kit: string; minShelf: number }> = {}) =>
    (await chamar<{ product_id: string }>(u.admin, "upsert_product", org, sku, `Produto ${sku}`, gtin, "UN",
      flags.lot ?? false, flags.exp ?? false, flags.serial ?? false, flags.minShelf ?? 0, flags.kit ?? "none")).product_id;
  const p = {
    simples: await prod(`SKU-${sufixo}-1`, "07890000000" + "12"),
    lote: await prod(`SKU-${sufixo}-2`, null, { lot: true, exp: true, minShelf: 5 }),
    serie: await prod(`SKU-${sufixo}-3`, null, { serial: true }),
    outro: await prod(`SKU-${sufixo}-4`, null),
    kit: await prod(`KIT-${sufixo}`, null, { kit: "components" }),
  };
  await chamar(u.admin, "upsert_product_unit", p.simples, "CX12", 12, `CX-${sufixo}-012`);
  await chamar(u.admin, "set_kit_components", p.kit, json([{ product_id: p.simples, quantity: 2 }, { product_id: p.outro, quantity: 1 }]));
  const skus = {
    simples: `SKU-${sufixo}-1`, lote: `SKU-${sufixo}-2`, serie: `SKU-${sufixo}-3`, outro: `SKU-${sufixo}-4`, kit: `KIT-${sufixo}`,
    caixa: `CX-${sufixo}-012`, gtin: "0789000000012",
  };
  return { codigo, org, wh, wh2, u, p, skus };
}

/** Entrada real: previsão manual → leitura → confirmação → armazenagem no endereço indicado. */
export async function darEntrada(
  s: Cenario,
  produto: keyof Cenario["p"],
  quantidade: number,
  destino: string,
  extra: { lote?: string; validade?: string; series?: string[] } = {},
) {
  const r = await chamar<{ receipt_id: string }>(s.u.admin, "create_manual_receipt", s.wh, `NF-${uuid().slice(0, 8)}`, "Fornecedor teste",
    json([{ product_id: s.p[produto], quantity: quantidade }]), false, chave());
  if (extra.series) {
    for (const serie of extra.series) {
      await chamar(s.u.recebimento, "receipt_scan", r.receipt_id, uuid(), s.skus[produto], 1, null, null, serie, "accepted", null);
    }
  } else {
    await chamar(s.u.recebimento, "receipt_scan", r.receipt_id, uuid(), s.skus[produto], quantidade, extra.lote ?? null, extra.validade ?? null, null, "accepted", null);
  }
  const versao = (await admin((c) => c.query("select version from wms.receipts where id = $1", [r.receipt_id]))).rows[0].version;
  await chamar(s.u.recebimento, "confirm_receipt", r.receipt_id, chave(), versao);
  const tarefas = (await admin((c) => c.query("select id from wms.putaway_tasks where source_id = $1 and status = 'open'", [r.receipt_id]))).rows;
  for (const t of tarefas) {
    await chamar(s.u.estoquista, "confirm_putaway", t.id, "RECEB", s.skus[produto], destino, chave());
  }
  return r.receipt_id;
}

export async function saldo(s: Cenario, produto: string, local?: string, condicao = "available"): Promise<{ quantity: number; reserved: number }> {
  const r = await admin((c) =>
    c.query(
      `select coalesce(sum(b.quantity),0)::float as quantity, coalesce(sum(b.reserved),0)::float as reserved
         from wms.stock_balances b join wms.locations l on l.id = b.location_id
        where b.warehouse_id = $1 and b.product_id = $2 and ($3::text is null or l.code = $3) and b.condition = $4`,
      [s.wh, produto, local ?? null, condicao],
    ),
  );
  return r.rows[0];
}

/** Invariantes: projeção = ledger e reservado = soma das reservas abertas. */
export async function conferirInvariantes(wh: string) {
  const r = await admin(async (c) => ({
    ledger: (await c.query("select * from wms.check_balances_against_ledger($1)", [wh])).rows,
    reservas: (await c.query("select * from wms.check_reservations_against_balances($1)", [wh])).rows,
  }));
  if (r.ledger.length || r.reservas.length) {
    throw new Error("Invariantes violadas: " + JSON.stringify(r));
  }
}

export async function criarPedido(s: Cenario, itens: { produto: keyof Cenario["p"]; quantidade: number }[], numero = `PED-${uuid().slice(0, 6)}`) {
  const r = await chamar<{ order_id: string }>(s.u.supervisor, "create_manual_order", s.wh, numero, "Cliente teste",
    json(itens.map((i) => ({ product_id: s.p[i.produto], quantity: i.quantidade }))), chave());
  return r.order_id;
}

export async function versaoPedido(id: string): Promise<number> {
  return (await admin((c) => c.query("select version from wms.orders where id = $1", [id]))).rows[0].version;
}

export async function statusPedido(id: string): Promise<string> {
  return (await admin((c) => c.query("select status from wms.orders where id = $1", [id]))).rows[0].status;
}
