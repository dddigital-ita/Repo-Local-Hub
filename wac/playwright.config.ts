import { defineConfig, devices } from "@playwright/test";
import { portaE2ERepo } from "./scripts/e2e-port.cjs";

// Porta E2E UNICA per repo: derivata dal percorso (banda 3110–3189, vedi
// scripts/e2e-port-guard.mjs). Il repo gemello «Web Agency Salento +
// Installer» (stesso stack E2E copiato) resta lontano: percorsi diversi →
// porte diverse, mai più intrusioni come le due del 30/09/2026. Override
// esplicito: E2E_PORT vince sempre sulla derivazione.
const PORTA_E2E = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : portaE2ERepo();

/**
 * E2E con Playwright — i due flussi che devono restare veri a prescindere
 * dal refactoring: consenso cookie (GDPR) e chat lead-gen (il business).
 *
 * Il server parte sulla porta E2E derivata dal percorso del repo
 * (portaE2ERepo: banda 3110–3189) con l'ambiente .env.e2e (DB locale
 * disposable `wac_e2e`, Turnstile con le chiavi di test ufficiali
 * Cloudflare) — mai il dev diurno (3200) né il DB di produzione.
 * In CI il DB viene montato da servizi GitHub Actions e resettato dal job.
 */
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
    baseURL: `http://localhost:${PORTA_E2E}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Prima di ogni run: la porta deve parlare il NOSTRO ambiente. Con
  // reuseExistingServer (!CI) riusa qualunque server già in ascolto sulla
  // porta: se è di un altro repo parla col SUO database (beccato il
  // 30/09/2026: il gemello «Web Agency Salento + Installer» sulla 3100 col
  // DB was_e2e → ogni login «Credenziali non valide»). Il guard riconosce
  // il caso dal cwd del processo in ascolto e fallisce subito col rimedio,
  // invece di lasciare fallire i login in diagnosi al buio.
  globalSetup: "scripts/e2e-port-guard.mjs",
  // Dopo l'ultima suite: il DB condiviso deve essere tornato com'era. Gli
  // afterAll di ogni spec puliscono i propri seed; questo guard è la rete
  // di sicurezza che fallisce la run se qualcuno se lo è dimenticato
  // (vedi utenti.spec prima del fix 9eaf3cd).
  globalTeardown: "scripts/e2e-leak-guard.mjs",
  webServer: {
    // distDir proprio: il lock «another dev server» di Next 16 vive dentro
    // il distDir, così l'E2E non entra in conflitto con il dev diurno (3200).
    // L'ambiente E2E arriva dal wrapper scripts/e2e-dev-server.mjs (Playwright
    // passa NODE_OPTIONS ai figli: node --env-file lì è rifiutato).
    // WAC_E2E=1: la app alza il limite admin-login (l'E2E fa molti login reali
    // dallo stesso IP localhost — il limite stretto resta per la produzione).
    command: `WAC_E2E=1 WAC_DIST_DIR=.next-e2e PORT=${PORTA_E2E} node scripts/e2e-dev-server.mjs dev`,
    url: `http://localhost:${PORTA_E2E}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
