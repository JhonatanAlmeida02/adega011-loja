/**
 * Acesso transacional ao banco do WMS (somente servidor: rotas /api/wms e worker).
 *
 * Cada operação do usuário roda numa transação com `role = authenticated` e os
 * claims do JWT JÁ VERIFICADO no servidor, igual ao PostgREST: o RLS e as
 * funções de comando enxergam o mesmo `auth.uid()`/`aal`. Nunca se usa
 * empresa/armazém/papel enviados pelo cliente para autorizar.
 * O worker usa o papel técnico `wms_worker`.
 *
 * Não há transação aberta durante chamadas ao ERP: o worker grava a intenção,
 * confirma, chama a API e registra o resultado em outra transação.
 */
import { Pool, type PoolClient } from "pg";
import { ehErroRetentavel, traduzirErroPg, WmsErro } from "./erros";

export type Identidade = {
  userId: string;
  /** Claims do JWT verificado (sub, aal, role, exp...). */
  claims: Record<string, unknown>;
};

let pool: Pool | null = null;

export function urlBancoWms(): string {
  return process.env.WMS_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
}

export function bancoWmsConfigurado(): boolean {
  return Boolean(urlBancoWms());
}

export function poolWms(): Pool {
  if (!pool) {
    const url = urlBancoWms();
    if (!url) throw new WmsErro(503, "banco_nao_configurado", "Banco do WMS não configurado (DATABASE_URL).");
    pool = new Pool({
      connectionString: url,
      max: Number(process.env.WMS_DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      // Nada de transação longa: um comando que passa disso é cancelado pelo banco.
      statement_timeout: Number(process.env.WMS_DB_STATEMENT_TIMEOUT_MS ?? 15_000),
      application_name: "wms",
    });
  }
  return pool;
}

export async function encerrarPoolWms(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function emTransacao<T>(
  preparar: (c: PoolClient) => Promise<void>,
  fn: (c: PoolClient) => Promise<T>,
  tentativas = 3,
): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    const c = await poolWms().connect();
    try {
      await c.query("begin");
      await preparar(c);
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback").catch(() => undefined);
      // Deadlock/serialização: retentativa limitada com jitter (a idempotência evita efeito duplo).
      if (ehErroRetentavel(e) && tentativa < tentativas) {
        await esperar(20 * tentativa + Math.random() * 50);
        continue;
      }
      throw traduzirErroPg(e);
    } finally {
      c.release();
    }
  }
}

/** Executa no contexto do usuário autenticado (RLS + comandos com auth.uid()). */
export function comoUsuario<T>(id: Identidade, fn: (c: PoolClient) => Promise<T>, correlationId = ""): Promise<T> {
  if (!id.userId) return Promise.reject(new WmsErro(401, "nao_autenticado", "Autenticação necessária."));
  const claims = JSON.stringify({ ...id.claims, sub: id.userId, role: "authenticated" });
  return emTransacao(async (c) => {
    await c.query(
      `select set_config('role', 'authenticated', true),
              set_config('request.jwt.claims', $1, true),
              set_config('request.jwt.claim.sub', $2, true),
              set_config('wms.correlation_id', $3, true)`,
      [claims, id.userId, correlationId],
    );
  }, fn);
}

/** Executa com o papel técnico do worker/receptor de webhook. */
export function comoWorker<T>(fn: (c: PoolClient) => Promise<T>, correlationId = ""): Promise<T> {
  return emTransacao(async (c) => {
    await c.query(
      `select set_config('role', 'wms_worker', true),
              set_config('request.jwt.claims', '', true),
              set_config('request.jwt.claim.sub', '', true),
              set_config('wms.correlation_id', $1, true)`,
      [correlationId],
    );
  }, fn);
}

const NOME_FUNCAO = /^[a-z_][a-z0-9_]{1,62}$/;

/** Chama uma função `wms.<nome>` com parâmetros posicionais e devolve o resultado (jsonb). */
export async function rpc<T = Record<string, unknown>>(c: PoolClient, nome: string, args: unknown[]): Promise<T> {
  if (!NOME_FUNCAO.test(nome)) throw new WmsErro(500, "funcao_invalida", "Função inválida.");
  const marcadores = args.map((_, i) => `$${i + 1}`).join(", ");
  const r = await c.query(`select wms.${nome}(${marcadores}) as r`, args.map(valorPg));
  return r.rows[0]?.r as T;
}

/** Objetos/arrays de objetos viram JSON (jsonb); arrays de escalares viram arrays do Postgres. */
function valorPg(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Json) return JSON.stringify(v.valor);
  return v;
}

export class Json {
  constructor(public valor: unknown) {}
}
/** Marca um valor para ser enviado como jsonb. */
export const json = (valor: unknown) => new Json(valor);
