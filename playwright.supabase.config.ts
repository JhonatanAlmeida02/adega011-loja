import { defineConfig, devices } from "@playwright/test";

/**
 * Testes de integração com um Supabase de verdade (ex.: `npx supabase start`).
 * Usa as variáveis do .env.local e um admin criado com `npm run criar-admin`.
 *   ADMIN_EMAIL=... ADMIN_SENHA=... npm run test:e2e:supabase
 */
const PORTA = Number(process.env.PORTA_E2E ?? 3200);

export default defineConfig({
  testDir: "tests/e2e-supabase",
  timeout: 90_000,
  workers: 1,
  use: { baseURL: `http://localhost:${PORTA}`, trace: "off", actionTimeout: 15_000 },
  projects: [{ name: "celular", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `npm run build && npx next start -p ${PORTA}`,
    port: PORTA,
    timeout: 240_000,
    reuseExistingServer: true,
  },
});
