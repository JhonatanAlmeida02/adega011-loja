import { defineConfig, devices } from "@playwright/test";

/**
 * Ponta a ponta do WMS: Next (modo dev) + PostgreSQL local de teste + Auth falso.
 * Pré-requisitos: `bash scripts/wms-db-local.sh` e WMS_TEST_DATABASE_URL apontando para ele.
 *   WMS_TEST_DATABASE_URL=postgresql://... npm run test:e2e:wms
 */
const PORTA = Number(process.env.PORTA_E2E_WMS ?? 3300);
const PORTA_AUTH = Number(process.env.PORTA_AUTH_FALSO ?? 54399);

export default defineConfig({
  testDir: "tests/e2e-wms",
  timeout: 180_000,
  workers: 1,
  use: { baseURL: `http://localhost:${PORTA}`, trace: "off" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } }],
  webServer: [
    {
      command: "npx tsx tests/e2e-wms/auth-falso-servidor.ts",
      url: `http://127.0.0.1:${PORTA_AUTH}/rest/v1/saude`,
      reuseExistingServer: false,
      env: { PORTA_AUTH_FALSO: String(PORTA_AUTH) },
    },
    {
      // next dev: a vitrine da loja exige Supabase real no build; o build de produção é validado à parte.
      command: `npx next dev -p ${PORTA}`,
      port: PORTA,
      timeout: 300_000,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PORTA_AUTH}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "chave-publica-de-teste",
        DATABASE_URL: process.env.WMS_TEST_DATABASE_URL ?? "",
        APP_URL: `http://localhost:${PORTA}`,
      },
    },
  ],
});
