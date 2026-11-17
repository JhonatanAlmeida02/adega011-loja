/**
 * Processamento do worker de integração (outbox, inbox e jobs).
 * Regras:
 *  - nenhuma transação fica aberta durante chamada ao ERP;
 *  - lease com expiração; evento retomado após crash é VERIFICADO antes de reenviar;
 *  - timeout de escrita => resultado desconhecido (análise antes de reenviar);
 *  - limite por conta compartilhado no banco; backoff com jitter e Retry-After;
 *  - erro permanente vai para a fila de falhas (sem retentativa infinita);
 *  - renovação de token serializada por conexão.
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { comoWorker, json, rpc } from "../db";
import { WmsErro } from "../erros";
import { cifrar, decifrar } from "../integracoes/cripto";
import type { Tokens } from "../integracoes/oauth-olist";
import { ErroCapacidade, ErroErp, type ContextoErp, type ErpAdapter, type LancamentoEstoque } from "../integracoes/tipos";

export type Conexao = {
  id: string;
  organization_id: string;
  adapter: "mock" | "olist_v3";
  status: string;
  write_enabled: boolean;
  credentials_ciphertext: string | null;
  credentials_version: number;
  access_token_expires_at: string | null;
  settings: Record<string, unknown>;
};

export type DepsWorker = {
  owner: string;
  adapterPara: (c: Conexao) => ErpAdapter;
  renovarToken?: (refreshToken: string) => Promise<Tokens>;
  limites?: { leituraPorJanela: number; escritaPorJanela: number; janelaS: number };
  dormir?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  log?: (evento: Record<string, unknown>) => void;
};

type Credenciais = { access_token: string; refresh_token: string };

const MARGEM_RENOVACAO_MS = 5 * 60_000;
const dormirPadrao = (ms: number) => new Promise((r) => setTimeout(r, ms));

function logar(deps: DepsWorker, e: Record<string, unknown>) {
  (deps.log ?? ((x) => console.log(JSON.stringify(x))))({ nivel: "info", origem: "wms.worker", ...e });
}

/** Backoff exponencial com jitter, respeitando Retry-After quando maior. */
export function atrasoBackoff(tentativa: number, retryAfterS?: number, baseS = 15, maxS = 3600): number {
  const exp = Math.min(maxS, baseS * 2 ** Math.max(0, tentativa - 1));
  const comJitter = Math.round(exp * (0.5 + Math.random() * 0.5));
  return Math.max(comJitter, retryAfterS ?? 0, 1);
}

async function conexao(id: string): Promise<Conexao> {
  return comoWorker(async (c) => (await c.query("select * from wms.worker_get_connection($1)", [id])).rows[0] as Conexao);
}

// ---------------------------------------------------------------------
// Token (renovação serializada)
// ---------------------------------------------------------------------
export async function obterToken(deps: DepsWorker, connId: string, forcar = false): Promise<string> {
  const env = deps.env ?? process.env;
  const dormir = deps.dormir ?? dormirPadrao;
  for (let espera = 0; espera < 20; espera++) {
    const conn = await conexao(connId);
    if (conn.adapter === "mock") return "token-simulado";
    if (conn.status !== "active") throw new ErroErp("autorizacao", `Conexão em estado ${conn.status}.`, undefined, undefined, conn.status);
    if (!conn.credentials_ciphertext) throw new ErroErp("autorizacao", "Conexão sem credenciais.", undefined, undefined, "no_credentials");
    const cred = JSON.parse(decifrar(conn.credentials_ciphertext, conn.id, env)) as Credenciais;
    const expira = conn.access_token_expires_at ? new Date(conn.access_token_expires_at).getTime() : 0;
    if (!forcar && expira - Date.now() > MARGEM_RENOVACAO_MS) return cred.access_token;
    if (!deps.renovarToken) throw new ErroErp("autorizacao", "Renovação de token indisponível.");

    const ganhou = await comoWorker((c) => rpc<boolean>(c, "worker_claim_token_refresh", [connId, deps.owner, 60]));
    if (!ganhou) {
      // outro processo está renovando: espera e relê (sem chamada própria ao ERP)
      await dormir(250);
      const depois = await conexao(connId);
      if (depois.credentials_version !== conn.credentials_version) forcar = false;
      continue;
    }
    try {
      const t = await deps.renovarToken(cred.refresh_token);
      const novo = cifrar(JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token }), conn.id, env);
      await comoWorker((c) => rpc(c, "worker_store_credentials", [
        connId, deps.owner, novo.ciphertext, novo.versao,
        new Date(Date.now() + t.expires_in * 1000).toISOString(),
        t.refresh_expires_in ? new Date(Date.now() + t.refresh_expires_in * 1000).toISOString() : null,
        conn.credentials_version,
      ]));
      logar(deps, { evento: "token_renovado", conexao: connId });
      return t.access_token;
    } catch (e) {
      if (e instanceof ErroErp && e.tipo === "autorizacao") {
        await comoWorker((c) => rpc(c, "worker_mark_reauthorization", [connId, `Renovação recusada: ${e.codigo ?? e.message}`]));
      } else {
        await comoWorker((c) => rpc(c, "worker_release_refresh_lease", [connId, deps.owner])).catch(() => undefined);
      }
      throw e;
    }
  }
  throw new ErroErp("transitorio", "Renovação de token em andamento por outro processo.");
}

// ---------------------------------------------------------------------
// Chamada ao ERP com limite compartilhado
// ---------------------------------------------------------------------
async function chamarErp<T>(deps: DepsWorker, conn: Conexao, adapter: ErpAdapter, balde: "read" | "write", fn: (ctx: ContextoErp) => Promise<T>): Promise<T> {
  const lim = deps.limites ?? limitesDoAmbiente(deps.env ?? process.env);
  const dormir = deps.dormir ?? dormirPadrao;
  for (let i = 0; ; i++) {
    const espera = await comoWorker((c) => rpc<number>(c, "worker_take_rate_token",
      [conn.id, balde, balde === "read" ? lim.leituraPorJanela : lim.escritaPorJanela, lim.janelaS]));
    if (espera <= 0) break;
    if (espera > 10_000 || i > 20) throw new ErroErp("limite", "Limite de requisições da conta atingido.", 429, Math.ceil(espera / 1000), "rate_limited_local");
    await dormir(espera);
  }
  let token = await obterToken(deps, conn.id);
  try {
    return await fn({ connectionId: conn.id, accessToken: token });
  } catch (e) {
    if (e instanceof ErroErp && e.tipo === "autorizacao" && conn.adapter !== "mock") {
      // token rejeitado: uma renovação forçada e uma nova tentativa
      token = await obterToken(deps, conn.id, true);
      return await fn({ connectionId: conn.id, accessToken: token });
    }
    if (e instanceof ErroErp && e.tipo === "limite") {
      await comoWorker((c) => rpc(c, "worker_rate_feedback", [conn.id, balde, 0, e.retryAfterS ?? 60, null]));
    }
    throw e;
  } finally {
    const info = adapter.ultimoLimite?.();
    if (info && (info.restante !== undefined || info.limite !== undefined)) {
      await comoWorker((c) => rpc(c, "worker_rate_feedback", [conn.id, balde, info.restante ?? null, info.resetS ?? null, info.limite ?? null])).catch(() => undefined);
    }
  }
}

export function limitesDoAmbiente(env: NodeJS.ProcessEnv) {
  // Valores conservadores e configuráveis; o cabeçalho X-RateLimit-Limit da conta ajusta o limite real.
  return {
    leituraPorJanela: Number(env.OLIST_RATE_READ_PER_MIN ?? 30),
    escritaPorJanela: Number(env.OLIST_RATE_WRITE_PER_MIN ?? 10),
    janelaS: 60,
  };
}

// ---------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------
type EventoOutbox = { id: string; event_type: string; attempts: number; needs_verification: boolean; connection_id: string; correlation_id: string | null };

export async function processarOutbox(deps: DepsWorker, limite = 10): Promise<Record<string, number>> {
  const eventos = await comoWorker(async (c) =>
    (await c.query("select * from wms.worker_claim_outbox($1, $2, $3)", [deps.owner, limite, 120])).rows as EventoOutbox[]);
  const resumo: Record<string, number> = {};
  for (const e of eventos) {
    const r = await processarEventoOutbox(deps, e).catch((err) => {
      logar(deps, { nivel: "erro", evento: "outbox_excecao", id: e.id, erro: err instanceof Error ? err.message : String(err) });
      return "erro";
    });
    resumo[r] = (resumo[r] ?? 0) + 1;
  }
  return resumo;
}

async function falhar(deps: DepsWorker, e: EventoOutbox, desfecho: string, err: unknown, corr: string): Promise<string> {
  const ee = err instanceof ErroErp ? err : undefined;
  const cap = err instanceof ErroCapacidade ? err : undefined;
  const retry = desfecho === "transient_error" ? atrasoBackoff(e.attempts, ee?.retryAfterS) : null;
  return comoWorker((c) => rpc<string>(c, "worker_fail_outbox", [
    e.id, deps.owner, desfecho, ee?.http ?? null, cap ? `capability:${cap.capacidade}` : (ee?.codigo ?? null),
    (err instanceof Error ? err.message : String(err)).slice(0, 500), retry, corr,
  ]));
}

async function processarEventoOutbox(deps: DepsWorker, e: EventoOutbox): Promise<string> {
  const corr = e.correlation_id ?? randomUUID();
  const ctx = await comoWorker((c) => rpc<{
    payload: { movement_id: string; direction?: string; deposit_external_id: string | null; lines: { product_id: string; quantity: number }[] };
    products: Record<string, string>;
    posted_lines: Record<string, string>;
  }>(c, "worker_outbox_context", [e.id]));
  if (!["stock.post_outbound", "stock.post_inbound"].includes(e.event_type)) {
    return falhar(deps, e, "capability_unavailable", new ErroCapacidade("lancar_estoque", `evento ${e.event_type} sem fluxo validado`), corr);
  }
  const conn = await conexao(e.connection_id);
  const adapter = deps.adapterPara(conn);
  if (!adapter.capacidades().has("lancar_estoque")) {
    return falhar(deps, e, "capability_unavailable", new ErroCapacidade("lancar_estoque", "adaptador sem escrita habilitada"), corr);
  }
  const deposito = ctx.payload.deposit_external_id;
  if (!deposito) return falhar(deps, e, "permanent_error", new ErroErp("permanente", "Depósito do armazém não mapeado.", undefined, undefined, "deposit_not_mapped"), corr);
  const lancamentos: LancamentoEstoque[] = [];
  for (const l of ctx.payload.lines) {
    const ext = ctx.products[l.product_id];
    if (!ext) return falhar(deps, e, "permanent_error", new ErroErp("permanente", `Produto ${l.product_id} sem ID externo.`, undefined, undefined, "product_not_mapped"), corr);
    lancamentos.push({
      product_external_id: ext, deposit_external_id: deposito, tipo: e.event_type === "stock.post_outbound" ? "S" : "E",
      quantidade: Number(l.quantity), observacoes: `WMS ${ctx.payload.movement_id}`,
      precoUnitario: null,
    });
  }

  await comoWorker((c) => rpc(c, "worker_mark_sending", [e.id, deps.owner]));
  const refs: string[] = Object.values(ctx.posted_lines);
  for (const l of lancamentos) {
    if (ctx.posted_lines[l.product_external_id]) continue;
    if (e.needs_verification) {
      try {
        const v = await chamarErp(deps, conn, adapter, "read", (x) => adapter.verificarLancamento(x, l));
        if (v.aplicado) {
          await comoWorker((c) => rpc(c, "worker_record_outbox_line", [e.id, deps.owner, l.product_external_id, v.external_ref ?? null, "verified_applied", corr]));
          refs.push(v.external_ref ?? "verificado");
          continue;
        }
      } catch (err) {
        // Sem como confirmar o efeito externo: exige análise operacional, nunca reenvio às cegas.
        return falhar(deps, e, "unknown", err, corr);
      }
    }
    try {
      const r = await chamarErp(deps, conn, adapter, "write", (x) => adapter.lancarEstoque(x, l));
      await comoWorker((c) => rpc(c, "worker_record_outbox_line", [e.id, deps.owner, l.product_external_id, r.external_ref, "success", corr]));
      refs.push(r.external_ref);
    } catch (err) {
      if (err instanceof ErroCapacidade) return falhar(deps, e, "capability_unavailable", err, corr);
      if (err instanceof ErroErp) {
        if (err.tipo === "desconhecido") return falhar(deps, e, "unknown", err, corr);
        if (err.tipo === "permanente") return falhar(deps, e, "permanent_error", err, corr);
        return falhar(deps, e, "transient_error", err, corr);
      }
      throw err;
    }
  }
  await comoWorker((c) => rpc(c, "worker_complete_outbox", [e.id, deps.owner, refs.join(","), 200, json({ lines: refs.length }), corr, "success"]));
  logar(deps, { evento: "outbox_enviado", id: e.id, linhas: refs.length, correlation_id: corr });
  return "sent";
}

// ---------------------------------------------------------------------
// Inbox (webhook/poll): sempre consulta o registro autenticado antes de mutar
// ---------------------------------------------------------------------
type EventoInbox = { id: string; connection_id: string; event_type: string; entity_external_id: string | null; attempts: number };

export async function processarInbox(deps: DepsWorker, limite = 20): Promise<Record<string, number>> {
  const eventos = await comoWorker(async (c) =>
    (await c.query("select * from wms.worker_claim_inbox($1, $2, $3)", [deps.owner, limite, 120])).rows as EventoInbox[]);
  const resumo: Record<string, number> = {};
  for (const ev of eventos) {
    let status = "processed";
    let erro: string | null = null;
    let retry: number | null = null;
    try {
      status = await processarEventoInbox(deps, ev);
    } catch (err) {
      erro = err instanceof Error ? err.message : String(err);
      const codigo = err instanceof WmsErro ? err.codigo : err instanceof ErroErp ? err.codigo : undefined;
      if (err instanceof WmsErro && codigo === "product_not_mapped") {
        await comoWorker((c) => rpc(c, "worker_request_job", [ev.connection_id, "import_products", json({})]));
        status = "retry";
        retry = 120;
      } else if (err instanceof ErroErp && err.tipo === "permanente") {
        status = "failed";
      } else if (err instanceof WmsErro && err.status < 500 && codigo !== "deposit_not_mapped") {
        status = "failed";
      } else {
        status = "retry";
        retry = atrasoBackoff(ev.attempts, err instanceof ErroErp ? err.retryAfterS : undefined, 30);
      }
    }
    await comoWorker((c) => rpc(c, "worker_finish_inbox", [ev.id, deps.owner, status, erro, retry]));
    resumo[status] = (resumo[status] ?? 0) + 1;
  }
  return resumo;
}

async function aplicarPedido(deps: DepsWorker, conn: Conexao, adapter: ErpAdapter, id: string) {
  const pedido = await chamarErp(deps, conn, adapter, "read", (x) => adapter.obterPedido(x, id));
  return comoWorker((c) => rpc<{ status: string }>(c, "worker_apply_order_snapshot", [conn.id, json(pedido)]));
}

async function processarEventoInbox(deps: DepsWorker, ev: EventoInbox): Promise<string> {
  const conn = await conexao(ev.connection_id);
  const adapter = deps.adapterPara(conn);
  const tipo = ev.event_type;
  if (["order", "vendas", "enviados", "notas"].includes(tipo)) {
    if (!ev.entity_external_id) {
      // Sem ID confiável no aviso: dispara sincronização incremental em vez de supor o conteúdo.
      await comoWorker((c) => rpc(c, "worker_request_job", [conn.id, "import_orders", json({})]));
      return "processed";
    }
    await aplicarPedido(deps, conn, adapter, ev.entity_external_id);
    return "processed";
  }
  if (tipo === "purchase_order" && ev.entity_external_id) {
    const oc = await chamarErp(deps, conn, adapter, "read", (x) => adapter.obterOrdemCompra(x, ev.entity_external_id!));
    await comoWorker((c) => rpc(c, "worker_upsert_purchase_receipt", [conn.id, json(oc)]));
    return "processed";
  }
  if ((tipo === "estoque" || tipo === "stock") && ev.entity_external_id) {
    await reconciliarProduto(deps, conn, adapter, ev.entity_external_id);
    return "processed";
  }
  if (tipo === "estoque" || tipo === "stock") {
    await comoWorker((c) => rpc(c, "worker_request_job", [conn.id, "reconcile_stock", json({})]));
    return "processed";
  }
  return "ignored";
}

async function reconciliarProduto(deps: DepsWorker, conn: Conexao, adapter: ErpAdapter, produtoExt: string) {
  const est = await chamarErp(deps, conn, adapter, "read", (x) => adapter.consultarEstoque(x, produtoExt));
  for (const d of est.depositos) {
    await comoWorker((c) => rpc(c, "worker_record_erp_stock", [conn.id, produtoExt, d.external_id, d.saldo]));
  }
}

// ---------------------------------------------------------------------
// Jobs de importação (paginados e retomáveis pelo progresso salvo)
// ---------------------------------------------------------------------
type Job = { id: string; connection_id: string; kind: string; params: Record<string, unknown>; progress: Record<string, unknown>; attempts: number };

export async function processarJob(deps: DepsWorker, paginasPorRodada = 20): Promise<string | null> {
  const job = await comoWorker(async (c) => (await c.query("select * from wms.worker_claim_job($1, $2)", [deps.owner, 300])).rows[0] as Job | undefined);
  if (!job) return null;
  const atualizar = (c: PoolClient, status: string, progress: unknown, erro: string | null = null, retry: number | null = null) =>
    rpc(c, "worker_update_job", [job.id, deps.owner, status, json(progress), erro, retry, 300]);
  try {
    const conn = await conexao(job.connection_id);
    const adapter = deps.adapterPara(conn);
    let offset = Number(job.progress.offset ?? 0);
    if (job.kind === "import_deposits") {
      const deps2 = await chamarErp(deps, conn, adapter, "read", (x) => adapter.listarDepositos(x));
      for (const d of deps2) await comoWorker((c) => rpc(c, "worker_upsert_deposit", [conn.id, d.external_id, d.name, json(d.raw)]));
      await comoWorker((c) => atualizar(c, "completed", { total: deps2.length }));
    } else if (job.kind === "import_products") {
      for (let p = 0; p < paginasPorRodada; p++) {
        const pag = await chamarErp(deps, conn, adapter, "read", (x) => adapter.listarProdutos(x, offset));
        for (const prod of pag.itens) await comoWorker((c) => rpc(c, "worker_upsert_product", [conn.id, json(prod)]));
        if (pag.proximoOffset === null) {
          await comoWorker((c) => atualizar(c, "completed", { offset, done: true }));
          return job.kind;
        }
        offset = pag.proximoOffset;
        await comoWorker((c) => atualizar(c, "running", { offset }));
      }
      await comoWorker((c) => atualizar(c, "retry", { offset }, null, 1));
    } else if (job.kind === "import_orders") {
      const inicio = (job.progress.started_at as string) ?? new Date().toISOString();
      const cursor = await comoWorker(async (c) =>
        (await c.query("select cursor from wms.sync_cursors where connection_id = $1 and resource = 'orders'", [conn.id])).rows[0]?.cursor as { since?: string } | undefined);
      // sobreposição de 1 dia (o filtro documentado é por data; deduplicação pela chave do evento)
      const desde = cursor?.since ? new Date(new Date(cursor.since).getTime() - 86_400_000).toISOString().slice(0, 10) : undefined;
      for (let p = 0; p < paginasPorRodada; p++) {
        const pag = await chamarErp(deps, conn, adapter, "read", (x) => adapter.listarPedidos(x, { atualizadoDesde: desde, offset }));
        for (const r of pag.itens) {
          await comoWorker((c) => rpc(c, "worker_enqueue_poll_event", [conn.id, `poll:order:${r.external_id}:${job.id}`, "order", r.external_id, json({})]));
        }
        if (pag.proximoOffset === null) {
          await comoWorker(async (c) => {
            await rpc(c, "worker_set_cursor", [conn.id, "orders", json({ since: inicio })]);
            await atualizar(c, "completed", { offset, done: true, started_at: inicio });
          });
          return job.kind;
        }
        offset = pag.proximoOffset;
        await comoWorker((c) => atualizar(c, "running", { offset, started_at: inicio }));
      }
      await comoWorker((c) => atualizar(c, "retry", { offset, started_at: inicio }, null, 1));
    } else if (job.kind === "import_purchase_orders") {
      const ids = Array.isArray(job.params.ids) ? (job.params.ids as unknown[]).map(String) : [];
      for (const id of ids) {
        await comoWorker((c) => rpc(c, "worker_enqueue_poll_event", [conn.id, `poll:po:${id}:${job.id}`, "purchase_order", id, json({})]));
      }
      await comoWorker((c) => atualizar(c, "completed", { total: ids.length }));
    } else if (job.kind === "reconcile_stock") {
      const produtos = await comoWorker(async (c) => (await c.query(
        "select external_id from wms.external_mappings where connection_id = $1 and entity_type = 'product' order by external_id offset $2 limit 200",
        [conn.id, offset])).rows as { external_id: string }[]);
      for (const p of produtos) await reconciliarProduto(deps, conn, adapter, p.external_id);
      await comoWorker((c) => atualizar(c, produtos.length < 200 ? "completed" : "retry", { offset: offset + produtos.length }, null, 1));
    } else if (job.kind === "refresh_token") {
      await obterToken(deps, conn.id, true);
      await comoWorker((c) => atualizar(c, "completed", {}));
    }
    return job.kind;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const permanente = (err instanceof ErroErp && err.tipo === "permanente") || err instanceof ErroCapacidade;
    await comoWorker((c) => atualizar(c, permanente ? "failed" : "retry", job.progress, msg,
      atrasoBackoff(job.attempts, err instanceof ErroErp ? err.retryAfterS : undefined, 30)));
    return `${job.kind}:erro`;
  }
}

export async function rodadaWorker(deps: DepsWorker) {
  const job = await processarJob(deps);
  const inbox = await processarInbox(deps);
  const outbox = await processarOutbox(deps);
  return { job, inbox, outbox };
}
