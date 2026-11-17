/**
 * Worker de integração do WMS (processo separado do site).
 *   npm run wms:worker            # laço contínuo
 *   npm run wms:worker -- --once  # uma rodada (útil em agendador)
 * Precisa de DATABASE_URL (papel com permissão de SET ROLE wms_worker) e, para a
 * Olist real, OLIST_CLIENT_ID/SECRET/REDIRECT_URI e INTEGRATION_ENCRYPTION_KEY.
 */
import "dotenv/config";
import { hostname } from "node:os";
import { encerrarPoolWms } from "../src/lib/wms/db";
import { adapterPara } from "../src/lib/wms/integracoes/fabrica";
import { configOAuth, renovarToken } from "../src/lib/wms/integracoes/oauth-olist";
import { rodadaWorker, type DepsWorker } from "../src/lib/wms/worker/processador";

const owner = `${hostname()}:${process.pid}`;
const intervaloMs = Number(process.env.WMS_WORKER_INTERVAL_MS ?? 5000);
let parar = false;
process.on("SIGTERM", () => (parar = true));
process.on("SIGINT", () => (parar = true));

const deps: DepsWorker = {
  owner,
  adapterPara: (c) => adapterPara(c),
  renovarToken: async (refresh) => renovarToken(configOAuth(), refresh),
};

async function main() {
  const umaVez = process.argv.includes("--once");
  console.log(JSON.stringify({ nivel: "info", origem: "wms.worker", evento: "inicio", owner, modo: process.env.OLIST_ADAPTER ?? "mock" }));
  do {
    try {
      const r = await rodadaWorker(deps);
      if (r.job || Object.keys(r.inbox).length || Object.keys(r.outbox).length) {
        console.log(JSON.stringify({ nivel: "info", origem: "wms.worker", evento: "rodada", ...r }));
      }
    } catch (e) {
      console.error(JSON.stringify({ nivel: "erro", origem: "wms.worker", evento: "rodada_falhou", erro: e instanceof Error ? e.message : String(e) }));
    }
    if (!umaVez && !parar) await new Promise((r) => setTimeout(r, intervaloMs));
  } while (!umaVez && !parar);
  await encerrarPoolWms();
}

void main();
