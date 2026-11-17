/**
 * Coerência entre código e banco: transições espelhadas e grants (negação por padrão).
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { encerrarPoolWms } from "../../src/lib/wms/db";
import { TRANSICOES } from "../../src/lib/wms/estados";
import { COMANDOS } from "../../src/lib/wms/rotas";
import { admin, temBanco } from "./helpers";

after(() => encerrarPoolWms());

describe("WMS · contratos internos", { skip: !temBanco && "WMS_TEST_DATABASE_URL não definido" }, () => {
  test("transições do TypeScript = tabela wms.state_transitions", async () => {
    const r = (await admin((c) => c.query("select domain, from_state, to_state from wms.state_transitions order by 1, 2, 3"))).rows;
    const banco = r.map((x) => `${x.domain}:${x.from_state}>${x.to_state}`).sort();
    const codigo = Object.entries(TRANSICOES).flatMap(([d, m]) => Object.entries(m).flatMap(([de, paras]) => paras.map((p) => `${d}:${de}>${p}`))).sort();
    assert.deepEqual(codigo, banco);
  });

  test("toda função de comando da API existe e é executável por authenticated; internas não", async () => {
    const r = (await admin((c) => c.query(`
      select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('wms_worker', p.oid, 'execute') as worker
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'wms'`))).rows;
    const mapa = new Map(r.map((x) => [x.proname, x]));
    for (const c of COMANDOS) {
      assert.ok(mapa.get(c.fn)?.auth, `${c.fn} deveria ser executável por authenticated`);
    }
    for (const x of r) {
      if (x.proname.startsWith("_") && x.proname !== "_try_uuid") assert.equal(x.auth, false, `${x.proname} não pode ser exposta`);
      if (x.proname.startsWith("worker_")) assert.equal(x.auth, false, `${x.proname} é só do worker`);
      if (["bootstrap_organization", "rebuild_balances"].includes(x.proname)) assert.equal(x.auth || x.worker, false);
    }
  });

  test("authenticated não tem INSERT/UPDATE/DELETE em nenhuma tabela do WMS", async () => {
    const r = (await admin((c) => c.query(`
      select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'wms' and grantee in ('authenticated', 'anon', 'PUBLIC') and privilege_type <> 'SELECT'`))).rows;
    assert.deepEqual(r, []);
    const semRls = (await admin((c) => c.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'wms' and c.relkind = 'r' and not c.relrowsecurity`))).rows;
    assert.deepEqual(semRls, [], "RLS habilitado em todas as tabelas");
  });
});
