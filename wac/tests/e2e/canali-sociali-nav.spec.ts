import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * E2E NAVIGAZIONE CANALI SOCIAL — la scheda OAuth (Facebook pagine,
 * Instagram Business, LinkedIn organizzazioni; migration 045) si
 * raggiunge da tutti gli ingressi previsti dall'hub, come ogni
 * scheda di Impostazioni:
 *   1. hub /admin/settings → card «Canali social» (HubCard = Link);
 *   2. scheda: back-link «Impostazioni» (SubPageHeader) → hub;
 *   3. palette ⌘K → destinazione «Canali social» (admin-destinations);
 *   4. il pannello della scheda è vivo: i 3 provider col badge
 *      «Da collegare» (DB social_accounts vuoto e app non configurate
 *      nell'ambiente E2E — il flusso OAuth vero serve app reali,
 *      fuori portata del DB disposable);
 *   5. il vecchio percorso /admin/tools/social (pre-spostamento)
 *      reindirizza alla scheda: compatibilità per i segnalibri.
 * Guard di sito: la feature esiste solo in Crema (social-oauth),
 * nel gemello non c'è né la scheda né questa spec.
 */

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

const ADMIN = { email: "canali-sociali@e2e.local", password: "CanaliSociali!22" };

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("navigazione canali social", () => {
  test("setup: seed admin e2e (per i rerun)", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Canali Sociali E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
  });

  test("hub Impostazioni: la card «Canali social» apre la scheda col pannello", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "Impostazioni", level: 1 })).toBeVisible();
    // La card è un Link (HubCard): il nome accessibile unisce titolo e testo.
    const card = page.getByRole("link", { name: /Canali social/i });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL("/admin/settings/social");
    await expect(page.getByRole("heading", { name: "Canali social", level: 1 })).toBeVisible();
    // Pannello vivo: i tre provider, tutti «Da collegare» nel DB E2E vuoto.
    await expect(page.getByText("Facebook (pagine)")).toBeVisible();
    await expect(page.getByText("Instagram (Business)")).toBeVisible();
    await expect(page.getByText("LinkedIn (organizzazioni)")).toBeVisible();
    await expect(page.getByText("Da collegare").first()).toBeVisible();
  });

  test("scheda: il back-link riporta all'hub Impostazioni", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings/social");
    await expect(page.getByRole("heading", { name: "Canali social", level: 1 })).toBeVisible();
    // Il back-link vive nell'<header> della scheda (SubPageHeader): lo si
    // filtra sull'h1 così non si confonde con la voce «Impostazioni» della nav.
    const backLink = page
      .locator("header")
      .filter({ has: page.getByRole("heading", { name: "Canali social", level: 1 }) })
      .getByRole("link", { name: "Impostazioni", exact: true });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL("/admin/settings");
    await expect(page.getByRole("heading", { name: "Impostazioni", level: 1 })).toBeVisible();
  });

  test("palette ⌘K: la destinazione «Canali social» apre la scheda", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings");
    const dialog = page.getByRole("dialog", { name: "Vai a una scheda dell'admin" });
    // Gate di attivazione: il primo evento da tastiera appena
    // dopo goto viene perso (la pagina non ha ancora l'input
    // attivo), mentre il click del trigger funziona. Si apre e
    // si chiude (Escape) la palette — verificando anche la
    // chiusura — e poi la scorciatoia arriva al listener.
    await page.getByRole("button", { name: "Vai a… ⌘K" }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // Scorciatoia globale ⌘K / Ctrl+K (il listener esclude i campi testo).
    await page.keyboard.press("ControlOrMeta+k");
    await expect(dialog).toBeVisible();
    await page.getByRole("combobox").fill("canali");
    const opzione = page.getByRole("option", { name: "Canali social", exact: true });
    await expect(opzione).toBeVisible();
    await opzione.click();
    await expect(page).toHaveURL("/admin/settings/social");
    await expect(page.getByRole("heading", { name: "Canali social", level: 1 })).toBeVisible();
  });

  test("compatibilità: il vecchio percorso /admin/tools/social reindirizza", async ({ page }) => {
    await login(page);
    // Il reindirizzamento di Next (permanentRedirect() in Server
    // Component, 308) arriva via RSC payload: in dev il documento è
    // 200 + meta refresh, non 3xx. Ciò che conta per i segnalibri:
    // il vecchio percorso NON è una 404 e il browser atterra sulla
    // scheda nuova.
    const status: number[] = [];
    page.on("response", (r) => {
      if (r.url().endsWith("/admin/tools/social")) status.push(r.status());
    });
    await page.goto("/admin/tools/social");
    await expect(page).toHaveURL("/admin/settings/social");
    await expect(page.getByRole("heading", { name: "Canali social", level: 1 })).toBeVisible();
    expect(status.length, "il vecchio percorso risponde").toBeGreaterThan(0);
    expect(status.every((s) => s !== 404), "nessun hop è una 404").toBe(true);
  });

  test.afterAll(async () => {
    await dbExec("delete from admin_users where email = $1", [ADMIN.email]);
  });
});
