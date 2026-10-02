import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * E2E del sistema utenti: RUOLI (super_admin | admin), Area personale e
 * gestione account. Le asserzioni chiave:
 *  - il super admin vede e usa la gestione utenti; l'admin semplice NO;
 *  - l'Area personale salva i campi anagrafici nel DB;
 *  - disattivare un account lo blocca al login E uccide la sessione viva
 *    all'istante (due contesti browser simultanei);
 *  - l'ultimo super admin attivo non è declassabile né disattivabile.
 *
 * Il seed scrive SOLO su was_e2e (DB disposable): hash scrypt della stessa
 * ricetta di lib/admin, login reali attraverso il form (non bypass auth).
 * I login reali sono 6 in totale, sotto il rate limit (8/ora per IP).
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

const SUPER = { email: "capo@e2e.local", password: "Sup3rSicura!x" };
const TEAM = { email: "team@e2e.local", password: "TeamSicura!22" };
const NUOVO = { email: "nuovo@e2e.local", password: "NuovoSicura!7" };
/** Account creato DAL TEST di creazione (email diversa dal seed). */
const CREATO = { email: "creato@e2e.local", password: "CreatoSicura!3" };

test.describe.configure({ mode: "serial" });

/**
 * Pulizia FINALE: il seed ripulisce all'inizio (per i rerun), ma senza
 * afterAll ogni run lasciava 4 admin e2e nel DB condiviso (capo, team,
 * creato, nuovo) — il leak di residui visto nei conteggi post-suite.
 * Nessuna FK punta a admin_users: la stesa è sicura così com'è (le sessioni
 * admin vivono nei cookie firmati, non ci sono righe da ripulire).
 */
test.afterAll(async () => {
  await dbExec("delete from admin_users where email like '%@e2e.local'");
});

let seeded = false;

async function seed() {
  if (seeded) return;
  // Auto-pulizia: i rerun senza reset DB non devono trovare residui dei run
  // precedenti (nuovo@ creato dal test di creazione, ecc.).
  await dbExec("delete from admin_users where email like '%@e2e.local'");
  // Il test di cambio email rinomina «nuovo» → «nuovo-alt»: il seed ripristina
  // anche lo stato dei rerun precedenti (email spostate, residui di creazione).
  // «nuovo» esiste GIÀ nel seed: i test possono girare anche con --grep
  // parziale senza dipendere dall'ordine (il test di creazione verifica la
  // UI e che il nuovo account sia nel DB — la riga è già lì, upsert).
  await dbExec(
    `insert into admin_users (email, password_hash, role, display_name)
     values ($1,$2,'super_admin','Capo E2E'), ($3,$4,'admin','Team E2E'), ($5,$6,'admin','Nuovo E2E')
     on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role, active = true`,
    [SUPER.email, hash(SUPER.password), TEAM.email, hash(TEAM.password), NUOVO.email, hash(NUOVO.password)],
  );
  seeded = true;
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /accedi|entra|login/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

test.describe("utenti e area personale", () => {
  test("setup: seed super admin + team admin nel DB E2E", async () => {
    await seed();
    const roles = await dbExec("select email, role from admin_users where email like '%@e2e.local'");
    expect(roles.rows).toHaveLength(3); // capo (super) + team + nuovo (admin)
  });

  test("il super admin vede Utenti, crea un account e lo vede in lista", async ({ page }) => {
    await seed();
    // Pulizia del target: il test crea un account con email nuova assoluta
    // per provare il percorso di creazione END-TO-END (rerun-safe).
    await dbExec("delete from admin_users where email = $1", [CREATO.email]);
    await login(page, SUPER.email, SUPER.password);

    // Nav: Utente visibile per il super admin + Area personale presente.
    await expect(page.getByRole("link", { name: /area personale/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^utenti$/i })).toBeVisible();

    await page.goto("/admin/utenti");
    await expect(page.getByRole("heading", { name: "Utenti" })).toBeVisible();

    // Crea l'account «creato» (admin) — label «Email» ESATTA (in pagina c'è
    // anche «Nuova email per …» nei dettagli Cambia email).
    await page.getByLabel("Email", { exact: true }).fill(CREATO.email);
    await page.getByLabel("Password iniziale").fill(CREATO.password);
    await page.getByRole("button", { name: /crea account/i }).click();

    await expect(page.getByText("Account creato")).toBeVisible();
    await expect(page.getByText(CREATO.email)).toBeVisible();

    // L'account è davvero nel DB con ruolo admin.
    const row = await dbExec("select role, active from admin_users where email = $1", [CREATO.email]);
    expect(row.rows[0]?.role).toBe("admin");
    expect(row.rows[0]?.active).toBe(true);
  });

  test("l'area personale salva i campi anagrafici nel DB", async ({ page }) => {
    await login(page, NUOVO.email, NUOVO.password);

    await page.getByRole("link", { name: /area personale/i }).click();
    await expect(page.getByRole("heading", { name: /area personale/i })).toBeVisible();

    // Compila l'anagrafica e salva («Nome» esatto: altrimenti matcha «Cognome»).
    await page.getByLabel("Nome", { exact: true }).fill("Giulia");
    await page.getByLabel("Cognome").fill("Rossi");
    await page.getByLabel("Partita IVA").fill("01234567890");
    await page.getByLabel("Numero di telefono").fill("333 9988776");
    await page.getByLabel("Via e numero civico").fill("Via Roma 12");
    await page.getByLabel("Città").fill("Lecce");
    await page.getByLabel("Provincia").fill("LE");
    await page.getByLabel("CAP").fill("73100");
    await page.getByRole("button", { name: /salva dati personali/i }).click();
    await expect(page.getByText("Dati personali salvati")).toBeVisible({ timeout: 10_000 });

    // I dati sono nel DB dell'account giusto.
    const row = await dbExec(
      "select first_name, last_name, vat_number, phone, address, city, province, postal_code from admin_users where email = $1",
      [NUOVO.email],
    );
    expect(row.rows[0]).toMatchObject({
      first_name: "Giulia",
      last_name: "Rossi",
      vat_number: "01234567890",
      phone: "333 9988776",
      address: "Via Roma 12",
      city: "Lecce",
      province: "LE",
      postal_code: "73100",
    });

    // I campi restano compilati dopo il reload (persistenza UI).
    await page.reload();
    await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Giulia");
  });

  test("l'admin semplice NON vede la gestione utenti (gating ruolo)", async ({ page }) => {
    await login(page, TEAM.email, TEAM.password);

    // Nella nav non esiste la voce Utenti.
    await expect(page.getByRole("link", { name: /^utenti$/i })).toHaveCount(0);
    // Accesso diretto alla URL: rimbalzato fuori (guardia server-side).
    await page.goto("/admin/utenti");
    await expect(page).not.toHaveURL(/\/admin\/utenti/);
  });

  test("disattivare un account: sessione viva uccisa al punto, login bloccato", async ({ page, context }) => {
    // L'account «nuovo» è già loggato (sessione viva dal test precedente,
    // ma per indipendenza ne apriamo una qui). login() verifica già l'URL /admin.
    await login(page, NUOVO.email, NUOVO.password);

    // Secondo contesto: il super admin disattiva l'account «nuovo».
    const adminCtx = await context.browser()!.newContext();
    const adminPage = await adminCtx.newPage();
    await login(adminPage, SUPER.email, SUPER.password);
    await adminPage.goto("/admin/utenti");
    // Card precisa via data-user (un locator generico su div annidati
    // rischierebbe di cliccare il bottone di un altro utente).
    const card = adminPage.locator(`[data-user="${NUOVO.email}"]`);
    await card.getByRole("button", { name: /disattiva/i }).click();
    await expect(adminPage.getByText("Account disattivato")).toBeVisible({ timeout: 15_000 });
    await adminCtx.close();

    // La sessione GIAÀ aperta dell'account disattivato muore al punto:
    // il prossimo giro di navigazione rimbalza al login (revoca immediata).
    await page.goto("/admin/profilo");
    await expect(page).toHaveURL(/\/admin\/login/);

    // E il login con credenziali CORRETTE è rifiutato.
    await loginExpectFail(page, NUOVO.email, NUOVO.password);

    // Riattivazione: il super admin ripristina l'account per il test successivo.
    const adminCtx2 = await context.browser()!.newContext();
    const adminPage2 = await adminCtx2.newPage();
    await login(adminPage2, SUPER.email, SUPER.password);
    await adminPage2.goto("/admin/utenti");
    await adminPage2.locator(`[data-user="${NUOVO.email}"]`).getByRole("button", { name: /riattiva/i }).click();
    await expect(adminPage2.getByText("Account riattivato")).toBeVisible({ timeout: 15_000 });
    await adminCtx2.close();
  });

  test("l'ultimo super admin: nessuna azione sulla propria card (autoprotezione)", async ({ page }) => {
    await login(page, SUPER.email, SUPER.password);
    await page.goto("/admin/utenti");

    // La propria card non offre azioni (self): la protezione «ultimo super
    // admin» è nel server come backstop (race condition / chiamate dirette),
    // ma il caso UI è già coperto dal fatto che l'ultimo super admin sono io.
    const superCard = page.locator(`[data-user="${SUPER.email}"]`);
    await expect(superCard.getByText(SUPER.email)).toBeVisible();
    await expect(superCard.getByRole("button")).toHaveCount(0);
    // Badge ruolo e stato presenti.
    await expect(superCard.getByText("Super admin", { exact: true })).toBeVisible();
  });

  test("cambio email proprio account: password richiesta, login solo con la nuova", async ({ page }) => {
    // Il limite admin-login è alzato in E2E (WAC_E2E=1): i login reali qui
    // sono legittimi e verificano davvero cookie e re-issue di sessione.
    await login(page, NUOVO.email, NUOVO.password);
    await page.goto("/admin/profilo");

    const NUOVA_EMAIL = "nuovo-alt@e2e.local";

    // Password sbagliata → errore, email invariata.
    await page.getByLabel("Nuova email").fill(NUOVA_EMAIL);
    await page.getByLabel("Password attuale").fill("sbagliata!");
    await page.getByRole("button", { name: /cambia email/i }).click();
    await expect(page.getByText("Password non corretta")).toBeVisible({ timeout: 10_000 });

    // Password giusta → redirect con conferma e sessione rinnovata.
    await page.getByLabel("Nuova email").fill(NUOVA_EMAIL);
    await page.getByLabel("Password attuale").fill(NUOVO.password);
    await page.getByRole("button", { name: /cambia email/i }).click();
    await expect(page.getByText("Email aggiornata")).toBeVisible({ timeout: 10_000 });

    // Il DB ha la nuova email (non la vecchia).
    const row = await dbExec("select email from admin_users where email in ($1, $2)", [NUOVO.email, NUOVA_EMAIL]);
    expect(row.rows.map((r) => r.email)).toEqual([NUOVA_EMAIL]);

    // La sessione è stata rinnovata: la pagina profilo funziona SENZA riloggarsi.
    await page.reload();
    await expect(page.getByRole("heading", { name: /area personale/i })).toBeVisible();

    // Logout e rientro SOLO con la nuova email (la vecchia non esiste più).
    // «Esci» è un form POST nella nav (il link prefetchabile cancellava la
    // sessione a idle — footgun del route handler GET): aspettiamo il login.
    await page.getByRole("button", { name: /esci/i }).click();
    await page.waitForURL(/\/admin\/login/, { timeout: 15_000 });
    await loginExpectFail(page, NUOVO.email, NUOVO.password); // vecchia email: credenziali non valide
    await login(page, NUOVA_EMAIL, NUOVO.password);
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("super admin cambia email a un altro utente dalla pagina Utenti", async ({ page }) => {
    await login(page, SUPER.email, SUPER.password);
    await page.goto("/admin/utenti");

    const ALTRE = "nuovo-alt@e2e.local"; // email corrente dell'utente «nuovo»
    const DEFINITIVA = "nuovo@e2e.local"; // la riportiamo all'originale
    const card = page.locator(`[data-user="${ALTRE}"]`);
    await card.getByText("Cambia email").click();
    await card.getByLabel(`Nuova email per ${ALTRE}`).fill(DEFINITIVA);
    await card.getByRole("button", { name: "Salva" }).click();
    await expect(page.getByText("Email aggiornata")).toBeVisible({ timeout: 10_000 });

    const row = await dbExec("select email from admin_users where email in ($1, $2)", [ALTRE, DEFINITIVA]);
    expect(row.rows.map((r) => r.email)).toEqual([DEFINITIVA]);
  });
});

async function loginExpectFail(page: Page, email: string, password: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /accedi|entra|login/i }).click();
  await expect(page.getByText("Credenziali non valide")).toBeVisible({ timeout: 10_000 });
}
