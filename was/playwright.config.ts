import { defineConfig, devices } from "@playwright/test";
import { portaE2ERepo } from "./scripts/e2e-port.cjs";

/**
 * E2E con Playwright — i due flussi che devono restare veri a prescindere
 * dal refactoring: consenso cookie (GDPR) e chat lead-gen (il business).
 *
 * La porta E2E è UNICA PER REPO, derivata dall'hash del percorso (banda
 * 3110–3189): il repo gemello WebAgencyCrema usa lo stesso schema, così i
 * due stack gemelli non si contendono più la stessa porta (30/09/2026 la
 * 3100 condivisa ha causato un riuso cieco col DB sbagliato e una sessione
 * di run uccise a metà). Override esplicito: WAC_E2E_PORT.
 *
 * Il server parte sulla porta derivata con l'ambiente .env.e2e (DB locale
 * disposable `was_e2e`, Turnstile con le chiavi di test ufficiali
 * Cloudflare) — mai il dev diurno (3400) né il DB di produzione.
 * In CI il DB viene montato da servizi GitHub Actions e resettato dal job.
 */

/** Override manuale: vince sempre sulla derivazione dal percorso. */
const E2E_PORT = process.env.WAC_E2E_PORT ?? String(portaE2ERepo());

export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: /prodlike-(captcha|cache|admin-skeleton)\.spec\.ts/, // le prove produzione-like girano SOLO con --config playwright.prodlike.config.ts (server :3105 a mano) — uniformato al gemello
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // la chat scrive nel DB: i test del lead girano in sequenza
  workers: 1, // un solo DB E2E condiviso: anche i FILE girano in sequenza (password-reset e utenti scrivono entrambi admin_users)
  retries: process.env.CI ? 1 : 0, // retry solo in CI: in locale il fallimento deve essere rumoroso
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }] as const] : "list",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Prima del primo test (dopo l'avvio/riuso del webServer): la porta E2E
  // deve parlare il NOSTRO ambiente. Se sulla porta derivata ascolta un
  // processo di un altro repo, reuseExistingServer lo riuserebbe ciecamente
  // col SUO .env.e2e: la run fallisce QUI, con pid e rimedio — non a metà
  // suite coi login «Credenziali non valide» (caso reale 30/09/2026 col
  // repo gemello). Stessa difesa del gemello, convenzione condivisa.
  globalSetup: "scripts/e2e-port-guard.mjs",
  // Dopo l'ultima suite: il DB condiviso deve essere tornato com'era. Gli
  // afterAll di ogni spec puliscono i propri seed; questo guard è la rete
  // di sicurezza che fallisce la run se qualcuno se lo è dimenticato
  // (vedi utenti.spec prima del fix 9eaf3cd).
  globalTeardown: "scripts/e2e-leak-guard.mjs",
  webServer: {
    // distDir proprio: il lock «another dev server» di Next 16 vive dentro
    // il distDir, così l'E2E non entra in conflitto con il dev diurno (3400).
    // L'ambiente E2E arriva dal wrapper scripts/e2e-dev-server.mjs (Playwright
    // passa NODE_OPTIONS ai figli: node --env-file lì è rifiutato).
    // WAC_E2E=1: la app alza il limite admin-login (l'E2E fa molti login reali
    // dallo stesso IP localhost — il limite stretto resta per la produzione).
    command: `WAC_E2E=1 WAC_DIST_DIR=.next-e2e PORT=${E2E_PORT} node scripts/e2e-dev-server.mjs dev`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
