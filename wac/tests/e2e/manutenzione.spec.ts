import { test, expect } from "@playwright/test";
import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

/**
 * E2E MODALITÀ MANUTENZIONE — il ciclo completo del cancello sul browser
 * reale, contro il DB E2E condiviso:
 *   1. seed admin e2e + config spenta (per i rerun);
 *   2. attiva → la home pubblica risponde 503 con la pagina pulita
 *      (logo, CTA WhatsApp/Chiama, footer DDDigital) e NIENTE chat/banner;
 *   3. /admin resta raggiungibile e il login funziona col cancello acceso;
 *   4. spegni → la home torna 200 e il contenuto reale torna visibile;
 *   5. afterAll: pulizia dei seed (leak guard in globalTeardown controlla).
 */

const UTENTE = {
  email: "manutenzione@e2e.local",
  password: "ManutenzioneE2E!2026",
};

// Stessa convenzione di password-reset.spec ed e2e-db-reset.mjs: utente
// «postgres» quando c'è una password (il servizio CI esige credenziali —
// senza utente esplicito Postgres risolve l'utente del SISTEMA, «runner»,
// e rifiuta). Override totale con E2E_DATABASE_URL (passata dal workflow).
const E2E_USER = process.env.E2E_PGUSER ?? (process.env.E2E_PGPASSWORD ? "postgres" : null);
const DSN =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${E2E_USER ? `${E2E_USER}${process.env.E2E_PGPASSWORD ? `:${process.env.E2E_PGPASSWORD}` : ""}@` : ""}${
    process.env.E2E_PGHOST ?? "localhost"
  }:${process.env.E2E_PGPORT ?? "5432"}/${process.env.E2E_PGDATABASE ?? "wac_e2e"}`;

function hash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

async function dbExec(sql: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: DSN });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

test.describe.configure({ mode: "serial" });

async function login(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(UTENTE.email);
  await page.getByLabel("Password").fill(UTENTE.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

test.describe("modalità manutenzione", () => {
  test("setup: seed admin e2e + config manutenzione spenta (per i rerun)", async () => {
    await dbExec("delete from admin_users where email like '%@e2e.local'");
    await dbExec(
      "insert into admin_users (email, password_hash, role, active) values ($1, $2, 'super_admin', true)",
      [UTENTE.email, hash(UTENTE.password)],
    );
    await dbExec("delete from content_settings where key = 'maintenance_mode'");
    await dbExec(
      "insert into content_settings (key, value) values ('maintenance_mode', $1::jsonb)",
      [JSON.stringify({ active: false, message: "", backOnline: "" })],
    );
  });

  test("admin: la scheda esiste, il pannello mostra lo stato spento", async ({ page }) => {
    await login(page);

    await page.goto("/admin/tools/manutenzione");
    await expect(page.getByRole("heading", { name: /Modalità manutenzione/i })).toBeVisible();
    await expect(page.getByText(/Stato: spenta/i)).toBeVisible();
    // Switch iOS (role=switch): niente più conferma a due fasi.
    await expect(page.getByRole("switch", { name: /manutenzione/i })).toBeVisible();
    await expect(page.getByRole("switch", { name: /manutenzione/i })).not.toBeChecked();
  });

  test("attiva: la home pubblica passa a 503 con pagina pulita (CTA + footer, niente chat)", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tools/manutenzione");
    // Un solo gesto: lo switch iOS accende il cancello (stato ottimistico,
    // nessuna conferma a due fasi).
    await page.getByRole("switch", { name: /manutenzione/i }).click();
    await expect(page.getByText(/Stato: ATTIVA/i)).toBeVisible();
    await expect(page.getByRole("switch", { name: /manutenzione/i })).toBeChecked();

    // Warm-up della rotta config: in dev la prima richiesta compila la route
    // on-demand e può superare il timeout del proxy (che degrada APERTO).
    await page.request.get("/api/maintenance/config");
    // Retry limitato: copre la compilazione e il TTL della cache del cancello.
    let response = await page.goto("/");
    for (let i = 0; i < 5 && response?.status() !== 503; i++) {
      await page.waitForTimeout(1_500);
      response = await page.goto("/");
    }
    expect(response?.status()).toBe(503);
    await expect(page.getByRole("heading", { name: /Ci stiamo prendendo cura del sito/i })).toBeVisible();
    // Requisiti del cliente, nel markup pubblico:
    await expect(page.getByRole("link", { name: /WhatsApp/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /\+39 320 279 2782/i })).toBeVisible(); // CTA Chiama
    await expect(page.getByText(/a branch by DDDigital/i)).toBeVisible();
    // La pagina è AUTONOMA: zero <script> (niente Next, niente chat, niente
    // analytics) e niente banner cookie — è HTML puro servito dal cancello.
    await expect(page.locator("script")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Solo necessari/i })).toHaveCount(0);
    await expect(page.getByText(/Zone/i)).toHaveCount(0); // il footer completo non c'è
  });

  test("col cancello acceso l'admin resta raggiungibile", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin/);
  });

  test("spegni: la home torna 200 col contenuto reale", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tools/manutenzione");
    // Un solo gesto: lo switch iOS spegne il cancello.
    await page.getByRole("switch", { name: /manutenzione/i }).click();
    await expect(page.getByText(/Stato: spenta/i)).toBeVisible();
    await expect(page.getByRole("switch", { name: /manutenzione/i })).not.toBeChecked();

    // Attendi lo scadere della cache del proxy (15s) e verifica il ritorno.
    await page.waitForTimeout(16_000);
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  });

  test.afterAll(async () => {
    await dbExec("delete from admin_users where email like '%@e2e.local'");
    await dbExec("delete from content_settings where key = 'maintenance_mode'");
  });
});
