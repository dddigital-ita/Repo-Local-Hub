import { defineConfig, devices } from "@playwright/test";

/**
 * PROVA PRODUZIONE-LIKE del captcha: gira contro un server BUILD (`next start`
 * su :3105) avviato a mano con l'ambiente .env.e2e — NON gestisce un webServer
 * (il server deve già essere vivo, come un deploy vero). Stesso motore e
 * stesso percorso Cloudflare del deploy: solo le chiavi sono quelle di TEST.
 *
 * Uso (vedi CHECKLIST-CAPTCHA-PRODUZIONE.md):
 *   node scripts/e2e-db-reset.mjs
 *   set -a; source .env.e2e; set +a
 *   WAC_DIST_DIR=.next-prod npx next start -p 3105 &
 *   npx playwright test --config playwright.prodlike.config.ts
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /prodlike-(captcha|cache|admin-skeleton)\.spec\.ts/, // le prove produzione-like (uniformato al gemello)
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3105",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
