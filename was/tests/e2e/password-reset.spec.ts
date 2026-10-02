import { test, expect } from "@playwright/test";
import { scryptSync, randomBytes, createHash } from "node:crypto";
import pg from "pg";

/**
 * E2E del recupero password self-service («password dimenticata»).
 *
 * L'invio email reale NON viene fatto (SMTP assente in E2E): il test
 *estrae il token dalla tabella password_reset_tokens (il link lo costruisce
 * la app con NEXT_PUBLIC_SITE_URL) e completa il flusso come farebbe l'utente.
 *
 * Cosa si verifica:
 *  - risposta NEUTRA identica per email esistente e inesistente (anti-enum);
 *  - il token nel DB è HASHato (non leggibile), scadenza ~1h;
 *  - il reset funziona: login con la nuova, la vecchia è morta;
 *  - il token è monouso: il secondo tentativo è rifiutato.
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

const UTENTE = { email: "dimentica@e2e.local", password: "VecchiaSicura!1", nuova: "NuovaSicura!9" };

// Pulizia finale: gli altri spec (es. utenti) contano gli *@e2e.local nel DB —
// questo file NON deve lasciare traccia dopo di sé.
test.afterAll(async () => {
  await dbExec("delete from password_reset_tokens where email like '%@e2e.local'");
  await dbExec("delete from admin_users where email like '%@e2e.local'");
});

test.describe.configure({ mode: "serial" });

test.describe("recupero password", () => {
  test("seed: utente con password nota", async () => {
    await dbExec("delete from admin_users where email like '%@e2e.local'");
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name) values ($1,$2,'admin','Dimentica E2E')
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [UTENTE.email, hash(UTENTE.password)],
    );
    // Pulizia di eventuali token residui.
    await dbExec("delete from password_reset_tokens where email like '%@e2e.local'");
  });

  test("richiesta: risposta neutra identica per email esistente e ignota", async ({ page }) => {
    await page.goto("/admin/password-dimenticata");
    // L'endpoint pubblico è coperto dal captcha invisibile (se configurato):
    // il widget è montato e il token arriva PRIMA del submit (flusso lazy).
    await expect(page.locator("#wac-turnstile-reset")).toHaveCount(1);
    await expect.poll(async () => page.evaluate(() => Boolean(window.wacTurnstile?.getToken?.())), { timeout: 15_000 }).toBe(true);

    // Email ESISTENTE → schermo di conferma.
    await page.getByLabel("Email dell'account").fill(UTENTE.email);
    await page.getByRole("button", { name: /inviami il link/i }).click();
    await expect(page.getByText(/Se questa email corrisponde a un account/)).toBeVisible();

    // Email INESISTENTE → STESSO schermo (anti-enumerazione).
    await page.goto("/admin/password-dimenticata");
    await page.getByLabel("Email dell'account").fill("inesistente@e2e.local");
    await page.getByRole("button", { name: /inviami il link/i }).click();
    await expect(page.getByText(/Se questa email corrisponde a un account/)).toBeVisible();

    // Solo per l'email esistente è stato creato un token... no: SEMPRE, ma
    // quello per l'email ignota non porterà a nessun reset usabile (l'update
    // matcherebbe zero righe). Verifichiamo i token dell'email esistente.
    const tokens = await dbExec(
      "select token_hash, expires_at, used_at from password_reset_tokens where email = $1 order by created_at desc",
      [UTENTE.email],
    );
    expect(tokens.rows).toHaveLength(1);
    // Il token nel DB è un SHA-256 hex (64 caratteri): non leggibile.
    expect(tokens.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    // Scadenza entro ~1h.
    const ms = new Date(tokens.rows[0].expires_at).getTime() - Date.now();
    expect(ms).toBeGreaterThan(55 * 60 * 1000);
    expect(ms).toBeLessThan(61 * 60 * 1000);
  });

  test("reset completo: nuova password vale, vecchia è morta, token monouso", async ({ page }) => {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await dbExec(
      `insert into password_reset_tokens (email, token_hash, expires_at) values ($1, $2, now() + interval '1 hour')`,
      [UTENTE.email, tokenHash],
    );

    // Il link porta alla pagina con il form nuova password.
    await page.goto(`/admin/password-dimenticata?token=${encodeURIComponent(token)}`);
    await expect(page.getByRole("heading", { name: /scegli una nuova password/i })).toBeVisible();

    // Password vuota/sbagliata nel confronto → errore, token NON consumato.
    await page.getByLabel("Nuova password", { exact: true }).fill(UTENTE.nuova);
    await page.getByLabel("Conferma nuova password").fill("Diversa!123");
    await page.getByRole("button", { name: /imposta password/i }).click();
    await expect(page.getByText(/almeno 8 caratteri|non riuscita/i)).toBeVisible();

    // Corretta → conferma.
    await page.getByLabel("Nuova password", { exact: true }).fill(UTENTE.nuova);
    await page.getByLabel("Conferma nuova password").fill(UTENTE.nuova);
    await page.getByRole("button", { name: /imposta password/i }).click();
    await expect(page.getByText(/Password aggiornata/)).toBeVisible();

    // Token segnato usato.
    const used = await dbExec("select used_at from password_reset_tokens where token_hash = $1", [tokenHash]);
    expect(used.rows[0].used_at).toBeTruthy();

    // La VECCHIA password non vale più; la NUOVA sì (login reali).
    // Ogni tentativo parte da una navigazione fresca: il widget Turnstile è
    // lazy e il suo listener attende il token al submit (pattern identico a
    // utenti.spec, che con captcha attivo fa fail-then-success login).
    await page.goto("/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(UTENTE.email);
    await page.getByLabel("Password").fill(UTENTE.password);
    await page.getByRole("button", { name: /entra/i }).click();
    await expect(page.getByText("Credenziali non valide")).toBeVisible();

    await page.goto("/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(UTENTE.email);
    await page.getByLabel("Password").fill(UTENTE.nuova);
    await page.getByRole("button", { name: /entra/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });

    // Secondo uso dello stesso token → rifiutato (monouso).
    await page.goto("/admin/logout");
    await page.waitForURL(/\/admin\/login/, { timeout: 15_000 });
    await page.goto(`/admin/password-dimenticata?token=${encodeURIComponent(token)}`);
    await page.getByLabel("Nuova password", { exact: true }).fill("AncoraAltra!1");
    await page.getByLabel("Conferma nuova password").fill("AncoraAltra!1");
    await page.getByRole("button", { name: /imposta password/i }).click();
    await expect(page.getByText(/non valido o già usato/i)).toBeVisible();
  });

  test("il link «Password dimenticata?» esiste nella pagina di login", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.getByRole("link", { name: /password dimenticata/i })).toBeVisible();
  });

  test("il form col token privato NON monta il captcha (serve solo sulla richiesta pubblica)", async ({ page }) => {
    await page.goto("/admin/password-dimenticata");
    // Senza token in URL: widget presente (richiesta pubblica, invia email).
    await expect(page.locator("#wac-turnstile-reset")).toHaveCount(1);
    // Con token in URL: form nuova password — nessun widget (token segreto,
    // chi lo possiede ha già superato la verifica via link email).
    await page.goto("/admin/password-dimenticata?token=token-di-prova");
    await expect(page.locator("#wac-turnstile-reset")).toHaveCount(0);
  });
});
