import { defineConfig, devices } from "@playwright/test";

const PORTA = Number(process.env.PORTA_E2E ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORTA}`,
    trace: "off",
  },
  projects: [
    { name: "celular", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
  ],
  webServer: {
    // Roda sem variáveis do Supabase => modo demonstração com os dados de exemplo.
    command: `npm run build && npx next start -p ${PORTA}`,
    port: PORTA,
    timeout: 240_000,
    reuseExistingServer: true,
    env: { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" },
  },
});
