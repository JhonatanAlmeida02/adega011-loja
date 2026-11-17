/**
 * Concorrência real: várias conexões simultâneas ao PostgreSQL disputando o mesmo saldo/tarefa.
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { encerrarPoolWms } from "../../src/lib/wms/db";
import { WmsErro } from "../../src/lib/wms/erros";
import {
  admin, chamar, chave, conferirInvariantes, criarCenario, criarPedido, darEntrada, falha, saldo, temBanco, uuid,
} from "./helpers";

after(() => encerrarPoolWms());

describe("WMS · concorrência", { skip: !temBanco && "WMS_TEST_DATABASE_URL não definido" }, () => {
  test("duas (e vinte) reservas disputam a última unidade: só uma confirma", async () => {
    const s = await criarCenario();
    await darEntrada(s, "outro", 1, "A-01");
    const pedidos = await Promise.all(Array.from({ length: 20 }, () => criarPedido(s, [{ produto: "outro", quantidade: 1 }])));
    const r = await Promise.allSettled(pedidos.map((p) => chamar<{ allocated: boolean }>(s.u.supervisor, "allocate_order", p, chave(), null)));
    const ok = r.filter((x) => x.status === "fulfilled" && x.value.allocated).length;
    const erros = r.filter((x) => x.status === "rejected").map((x) => (x as PromiseRejectedResult).reason);
    assert.equal(ok, 1, `exatamente uma reserva (erros: ${erros.map((e) => e.message).join("; ")})`);
    for (const e of erros) assert.ok(e instanceof WmsErro && e.status === 409);
    assert.deepEqual(await saldo(s, s.p.outro), { quantity: 1, reserved: 1 });
    await conferirInvariantes(s.wh);
  });

  test("mesma chave em paralelo: um único movimento", async () => {
    const s = await criarCenario();
    await darEntrada(s, "simples", 10, "A-01");
    const k = chave();
    const r = await Promise.allSettled(Array.from({ length: 8 }, () =>
      chamar<{ movement_id: string }>(s.u.estoquista, "transfer_stock", s.wh, "A-01", "A-02", s.skus.simples, 3, null, null, null, null, k)));
    const ids = new Set(r.filter((x) => x.status === "fulfilled").map((x) => (x as PromiseFulfilledResult<{ movement_id: string }>).value.movement_id));
    assert.equal(ids.size, 1);
    assert.equal((await saldo(s, s.p.simples, "A-02")).quantity, 3);
  });

  test("transferências cruzadas simultâneas não deixam saldo negativo nem divergente", async () => {
    const s = await criarCenario();
    await darEntrada(s, "simples", 50, "A-01");
    await darEntrada(s, "simples", 50, "A-02");
    const ops = Array.from({ length: 40 }, (_, i) =>
      chamar(s.u.estoquista, "transfer_stock", s.wh, i % 2 ? "A-01" : "A-02", i % 2 ? "A-02" : "A-01", s.skus.simples, 3, null, null, null, null, chave()));
    const r = await Promise.allSettled(ops);
    const inesperados = r.filter((x) => x.status === "rejected" && !((x.reason as WmsErro).status === 409));
    assert.equal(inesperados.length, 0, JSON.stringify(inesperados));
    assert.equal((await saldo(s, s.p.simples)).quantity, 100, "total preservado");
    await conferirInvariantes(s.wh);
  });

  test("atribuição concorrente da mesma tarefa: um vence, o outro recebe conflito", async () => {
    const s = await criarCenario();
    await darEntrada(s, "simples", 5, "A-01");
    const ped = await criarPedido(s, [{ produto: "simples", quantidade: 1 }]);
    await chamar(s.u.supervisor, "allocate_order", ped, chave(), null);
    const t = (await admin((c) => c.query("select id, version from wms.picking_tasks where order_id = $1", [ped]))).rows[0];
    const r = await Promise.allSettled([
      chamar(s.u.separador, "claim_picking_task", t.id, t.version),
      chamar(s.u.separador2, "claim_picking_task", t.id, t.version),
    ]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    const perdedor = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    assert.equal((perdedor.reason as WmsErro).status, 409);
    // quem não é responsável não separa
    const dono = (await admin((c) => c.query("select assigned_to from wms.picking_tasks where id = $1", [t.id]))).rows[0].assigned_to;
    const outro = dono === s.u.separador.userId ? s.u.separador2 : s.u.separador;
    await falha(chamar(outro, "pick_scan", t.id, uuid(), "A-01", s.skus.simples, 1, null, null, null), 409, "task_assigned_elsewhere");
  });

  test("inventário ativo bloqueia movimento e reserva concorrentes no endereço", async () => {
    const s = await criarCenario();
    await darEntrada(s, "simples", 5, "A-01");
    const inv = await chamar<{ session_id: string }>(s.u.supervisor, "create_inventory_session", s.wh, "cycle", ["A-01"], 0, 0, 2, chave());
    await chamar(s.u.supervisor, "start_inventory_session", inv.session_id, chave());
    await falha(chamar(s.u.estoquista, "transfer_stock", s.wh, "A-01", "A-02", s.skus.simples, 1, null, null, null, null, chave()), 409, "location_counting");
    const ped = await criarPedido(s, [{ produto: "simples", quantidade: 1 }]);
    const r = await chamar<{ allocated: boolean }>(s.u.supervisor, "allocate_order", ped, chave(), null);
    assert.equal(r.allocated, false, "endereço em contagem fora da reserva");
    // Iniciar inventário com reserva ativa no endereço é recusado
    await chamar(s.u.supervisor, "cancel_inventory_session", inv.session_id, "teste", chave());
    await chamar(s.u.supervisor, "allocate_order", ped, chave(), null);
    const inv2 = await chamar<{ session_id: string }>(s.u.supervisor, "create_inventory_session", s.wh, "cycle", ["A-01"], 0, 0, 2, chave());
    await falha(chamar(s.u.supervisor, "start_inventory_session", inv2.session_id, chave()), 409, "locations_unavailable");
  });
});
