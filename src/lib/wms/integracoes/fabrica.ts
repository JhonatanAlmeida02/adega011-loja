/**
 * Escolhe o adaptador de cada conexão. O simulador é usado quando a conexão
 * é 'mock' (desenvolvimento). Escrita real exige OLIST_WRITE_ENABLED=true no
 * ambiente E write_enabled na conexão (o worker só reivindica eventos assim).
 */
import type { Conexao } from "../worker/processador";
import { MockOlistAdapter } from "./mock-olist";
import { OlistV3Adapter } from "./olist-v3";
import type { ErpAdapter } from "./tipos";

const mocks = new Map<string, MockOlistAdapter>();

export function mockDaConexao(id: string): MockOlistAdapter {
  let m = mocks.get(id);
  if (!m) {
    m = new MockOlistAdapter();
    mocks.set(id, m);
  }
  return m;
}

export function adapterPara(c: Conexao, env: NodeJS.ProcessEnv = process.env): ErpAdapter {
  if (c.adapter === "mock") return mockDaConexao(c.id);
  const settings = c.settings ?? {};
  return new OlistV3Adapter({
    baseUrl: env.OLIST_API_BASE_URL || undefined,
    timeoutMs: Number(env.OLIST_HTTP_TIMEOUT_MS ?? 20_000),
    escritaHabilitada: env.OLIST_WRITE_ENABLED === "true" && c.write_enabled,
    situacoesNotaAutorizada: Array.isArray(settings.fiscal_authorized_statuses) ? (settings.fiscal_authorized_statuses as unknown[]).map(String) : [],
    depositoPadraoOrdemCompra: typeof settings.purchase_order_deposit_external_id === "string" ? settings.purchase_order_deposit_external_id : null,
  });
}
