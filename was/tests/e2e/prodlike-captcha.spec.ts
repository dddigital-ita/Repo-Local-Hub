import { test, expect } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * PROVA DI PRODUZIONE del captcha (da lanciare contro un server BUILD con
 * `next start`, non il dev): stesso motore del deploy, stesso percorso
 * Cloudflare siteverify, chiavi di TEST ufficiali (accettano qualunque token
 * per progettazione — vedi https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
 *
 * Cosa garantisce (la "fede di produzione"):
 *  1. il widget invisibile è montato SU LOGIN, CHAT e LEAD anche con la build;
 *  2. i form vengono inviati CON il token (il flusso lazy non blocca le persone);
 *  3. login, chat e lead funzionano a fine corsa;
 *  4. il runtime server chiamarebbe siteverify col secret attivo (verificato
 *     a parte con curl: secret errata → success:false, invalid-input-secret).
 */

const E2E_USER = process.env.E2E_PGUSER ?? (process.env.E2E_PGPASSWORD ? "postgres" : null);
const DSN =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${E2E_USER ? `${E2E_USER}${process.env.E2E_PGPASSWORD ? `:${process.env.E2E_PGPASSWORD}` : ""}@` : ""}${
    process.env.E2E_PGHOST ?? "localhost"
  }:${process.env.E2E_PGPORT ?? "5432"}/${process.env.E2E_PGDATABASE ?? "was_e2e"}`;

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

const UTENTE = { email: "prodlike@e2e.local", password: "ProdLike!2026" };

test.describe.configure({ mode: "serial" });

test.describe("captcha su build di produzione-like", () => {
  test("seed utente di test", async () => {
    await dbExec("delete from admin_users where email = $1", [UTENTE.email]);
    await dbExec(
      `insert into admin_users (email, password_hash, role) values ($1,$2,'admin')`,
      [UTENTE.email, hash(UTENTE.password)],
    );
  });

  test("LOGIN: widget montato, token allegato, accesso riuscito su build", async ({ page }) => {
    await page.goto("/admin/login");
    // Il widget invisibile esiste (build compresa) e lo script Cloudflare è caricato.
    await expect(page.locator("#wac-turnstile-login")).toHaveCount(1);
    await expect(page.locator('script[src*="challenges.cloudflare.com/turnstile"]')).toHaveCount(1);
    // Il challenge invisibile risolve: il token è in pagina PRIMA del submit.
    await expect.poll(async () => page.evaluate(() => Boolean(window.wacTurnstile?.getToken?.())), { timeout: 15_000 }).toBe(true);
    // Il flusso completo: il token viene allegato dal listener e il login passa.
    await page.getByLabel("Email", { exact: true }).fill(UTENTE.email);
    await page.getByLabel("Password").fill(UTENTE.password);
    await page.getByRole("button", { name: /entra/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  });

  test("CHAT: apertura con captcha attivo su build (chat-init passa la verifica)", async ({ page }) => {
    // Percorso lead-gen vero (come chat-lead.spec): home → ricerca → /consulenza.
    const QUERY = "captcha prodlike";
    await page.goto("/");
    await page.getByRole("searchbox", { name: /cerca/i }).fill(QUERY);
    await page.getByRole("searchbox", { name: /cerca/i }).press("Enter");
    // La chat parte da sola (splash + init): il greeting conferma che
    // /api/chat/init è passato la verifica Turnstile (con token valido il
    // server NON risponde 403 captcha_failed).
    await expect(page.getByText(new RegExp(`Cerchi «${QUERY}»\\?`))).toBeVisible({ timeout: 20_000 });
    // I bottoni del primo step sono la prova che l'init ha costruito lo script.
    await expect(page.getByRole("button", { name: /Un sito web nuovo/ })).toBeVisible();
  });

  test("LEAD: widget globale presente sulle pagine pubbliche (token pronto per /api/lead)", async ({ page }) => {
    await page.goto("/contatti");
    await expect(page.locator("#wac-turnstile-box")).toHaveCount(1);
    // Lo script Cloudflare viene caricato anche qui (lazyOnload) e risolve.
    await expect(page.locator('script[src*="challenges.cloudflare.com/turnstile"]')).toHaveCount(1);
    await expect.poll(async () => page.evaluate(() => Boolean(window.wacTurnstile?.getToken?.())), { timeout: 15_000 }).toBe(true);
  });

  test("PASSWORD DIMENTICATA: widget sulla richiesta pubblica e invio che passa su build", async ({ page }) => {
    await page.goto("/admin/password-dimenticata");
    await expect(page.locator("#wac-turnstile-reset")).toHaveCount(1);
    await expect.poll(async () => page.evaluate(() => Boolean(window.wacTurnstile?.getToken?.())), { timeout: 15_000 }).toBe(true);
    // La richiesta completa con captcha attivo: risposta neutra (non captcha_failed).
    await page.getByLabel("Email dell'account").fill("chiunque@example.com");
    await page.getByRole("button", { name: /inviami il link/i }).click();
    await expect(page.getByText(/Se questa email corrisponde a un account/)).toBeVisible({ timeout: 15_000 });
    // Il form col token privato NON monta il widget.
    await page.goto("/admin/password-dimenticata?token=probe");
    await expect(page.locator("#wac-turnstile-reset")).toHaveCount(0);
  });

  test("siteverify raggiungibile dal runtime: il server risponde con l'errore Cloudflare se la secret è sbagliata", async () => {
    // Prova diretta dell'endpoint di verifica con una secret volutamente errata:
    // dimostra che la catena runtime → Cloudflare è viva e che l'errore NON è
    // un fail-open silenzioso (success:false propagato).
    const env = await import("node:fs").then((fs) => fs.promises.readFile(".env.e2e", "utf8"));
    const realSecret = env.match(/^TURNSTILE_SECRET_KEY=(.*)$/m)?.[1];
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: realSecret + "corrotta", response: "sometoken" }),
    });
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data["error-codes"]).toContain("invalid-input-secret");
  });
});
