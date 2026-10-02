import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * E2E delle difese RBAC su BACKUP / RESTORE / RESET PASSWORD.
 *
 * Le sentinelle unitarie (users-rbac.test.mjs) blindano il codice: qui si
 * verifica il comportamento VIVO su un file di backup FORGIATO —
 *  1. l'export di backup dell'app NON contiene admin_users (né hash né
 *     anagrafica privata degli account);
 *  2. il restore di un file forgiato (admin_users con role 'super_admin')
 *     NON permette a un admin semplice di auto-promuoversi: la tabella non
 *     è nel piano, non è selezionabile, non viene toccata;
 *  3. il reset password manuale mostra la password temporanea via nota
 *     monouso lato server: NESSUN segreto nell'URL (?temp= è vietato);
 *  4. la nuova password temporanea vale davvero al login.
 *
 * Il seed scrive SOLO su wac_e2e (DB disposable) con email dedicate
 * (*-bk@e2e.local): i rerun e le altre spec non si contaminano.
 */

const E2E_USER = process.env.E2E_PGUSER ?? (process.env.E2E_PGPASSWORD ? "postgres" : null);
const DSN =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${E2E_USER ? `${E2E_USER}${process.env.E2E_PGPASSWORD ? `:${E2E_PGPASSWORD_SAFE()}` : ""}@` : ""}${
    process.env.E2E_PGHOST ?? "localhost"
  }:${process.env.E2E_PGPORT ?? "5432"}/${process.env.E2E_PGDATABASE ?? "wac_e2e"}`;

function E2E_PGPASSWORD_SAFE(): string {
  return process.env.E2E_PGPASSWORD ?? "";
}

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

const SUPER = { email: "capo-bk@e2e.local", password: "Sup3rBk!22" };
const TEAM = { email: "team-bk@e2e.local", password: "TeamBk!33" };
const FLAG_KEY = "bk_flag_e2e";

test.describe.configure({ mode: "serial" });

let seeded = false;

async function seed() {
  if (seeded) return;
  await dbExec(
    `insert into admin_users (email, password_hash, role, display_name)
     values ($1,$2,'super_admin','Capo Backup E2E'), ($3,$4,'admin','Team Backup E2E')
     on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role, active = true`,
    [SUPER.email, hash(SUPER.password), TEAM.email, hash(TEAM.password)],
  );
  seeded = true;
}

/** Il banner consenso cookie (GDPR) copre ogni pagina senza consenso: chiuso
 *  qui una volta, i rerun e i test successivi del contesto girano puliti.
 *  Attende il montaggio (il banner è un client component: arriva dopo
 *  l'idratazione, isVisible a secco non lo vedrebbe mai). */
async function acceptConsent(page: Page) {
  const accept = page.getByRole("button", { name: "Accetta tutti" });
  const visible = await accept.waitFor({ state: "visible", timeout: 5_000 }).catch(() => null);
  if (visible) {
    await accept.click();
    await expect(accept).toBeHidden();
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/admin/login");
  await acceptConsent(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /accedi|entra|login/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

/** File backup FORGIATO: content_settings legit (righe correnti + flag) e una
 *  riga admin_users con role 'super_admin' — l'attacco che la sentinella
 *  server deve rendere inoffensivo. */
async function forgeBackup(): Promise<Buffer> {
  const current = await dbExec("select key, value, updated_at from content_settings order by key");
  const rows = current.rows.map((r) => ({ key: r.key, value: r.value, updated_at: r.updated_at }));
  rows.push({ key: FLAG_KEY, value: 1, updated_at: new Date().toISOString() });
  const forged = {
    meta: {
      kind: "webagencycrema-backup",
      version: 1,
      appVersion: "0.3.0",
      createdAt: new Date().toISOString(),
      createdBy: "attaccante-e2e",
      tables: { content_settings: rows.length, admin_users: 1 },
    },
    data: {
      content_settings: rows,
      admin_users: [
        {
          email: TEAM.email,
          password_hash: hash("PasswordForgiata!1"),
          role: "super_admin",
          active: true,
          display_name: "Account Promosso col malloppo",
          operator_id: null,
          first_name: "",
          last_name: "",
          vat_number: "",
          fiscal_code: "",
          phone: "",
          address: "",
          city: "",
          province: "",
          postal_code: "",
          bio: "",
          created_at: new Date().toISOString(),
        },
      ],
    },
  };
  return Buffer.from(JSON.stringify(forged, null, 2), "utf8");
}

test.describe("backup, restore e reset password (RBAC)", () => {
  test("l'export di backup senza sessione è negato (401)", async ({ request }) => {
    const res = await request.get("/api/admin/backup/00000000-0000-4000-8000-000000000000");
    expect(res.status()).toBe(401);
  });

  test("il backup dell'app NON contiene admin_users (né hash né anagrafica)", async ({ page }) => {
    await seed();
    await login(page, SUPER.email, SUPER.password);
    // L'id è un placeholder: il contenuto si rigenera fresco al download.
    const res = await page.request.get("/api/admin/backup/00000000-0000-4000-8000-000000000000");
    expect(res.status()).toBe(200);
    const payload = (await res.json()) as { meta?: { kind?: string }; data?: Record<string, unknown[]> };
    expect(payload.meta?.kind).toBe("webagencycrema-backup");
    expect(payload.data).toBeDefined();
    // Il cuore del test: nessuna tabella account nel file scaricabile.
    expect(Object.keys(payload.data ?? {})).not.toContain("admin_users");
    expect(payload.data?.["admin_users"]).toBeUndefined();
    // Sanity: il backup contiene davvero le entità di business.
    expect(Object.keys(payload.data ?? {})).toContain("content_settings");
  });

  test("reset password manuale: nota monouso a video, NESSUN segreto nell'URL, la temporanea vale al login", async ({ page }) => {
    await seed();
    await login(page, SUPER.email, SUPER.password);
    await page.goto("/admin/utenti");
    await acceptConsent(page); // il banner riappare su ogni nuovo contesto/pagina
    const card = page.locator(`[data-user="${TEAM.email}"]`);
    await card.getByRole("button", { name: /reset password/i }).click();

    // Banner della nota: la password temporanea è visibile UNA volta.
    await expect(page.getByText(`Password temporanea per ${TEAM.email}`)).toBeVisible({ timeout: 15_000 });
    // Nessun segreto nella query string: ?temp= è vietato per costruzione;
    // il flag ?note= (opaco) viene ripulito dall'URL lato client dopo il claim.
    expect(page.url()).not.toContain("temp=");
    const temp = (await page.locator("code").first().textContent())?.trim() ?? "";
    expect(temp.length).toBeGreaterThanOrEqual(8);
    expect(page.url()).not.toContain(encodeURIComponent(temp));
    // La pulizia client (?note= via replaceState) è completata dopo l'idratazione.
    await expect.poll(() => page.url(), { timeout: 10_000 }).not.toContain("note=");

    // Reload: la nota è stata consumata, il banner non riappare.
    await page.reload();
    await expect(page.getByText(`Password temporanea per ${TEAM.email}`)).toHaveCount(0);

    // La temporanea vale davvero al login: contesto FRESCO (questa pagina ha
    // ancora il cookie del super admin, il login page rimbalzerebbe a /admin).
    const teamCtx = await page.context().browser()!.newContext();
    const teamPage = await teamCtx.newPage();
    await login(teamPage, TEAM.email, temp);
    await expect(teamPage).toHaveURL(/\/admin$/);
    await teamCtx.close();

    // Ripristino la password del seed per i test successivi (rerun-safe).
    await dbExec("update admin_users set password_hash = $2 where email = $1", [TEAM.email, hash(TEAM.password)]);
  });

  test("restore di un file forgiato da un admin semplice: nessuna escalation, i dati legit tornano", async ({ page }) => {
    await seed();
    // L'attore è l'ADMIN SEMPLICE: è la persona non gradita dello scenario.
    await login(page, TEAM.email, TEAM.password);
    await page.goto("/admin/tools/backup");
    await acceptConsent(page);
    await expect(page.getByRole("heading", { name: "Backup e aggiornamenti", exact: true })).toBeVisible();

    const forged = await forgeBackup();
    await page.locator("#restore-file").setInputFiles({
      name: "forged.json",
      mimeType: "application/json",
      buffer: forged,
    });
    await page.getByRole("button", { name: /analizza il backup/i }).click();

    // Il piano NON propone admin_users: nessuna checkbox, nessuna riga.
    const checkboxes = page.locator('form input[name="tables"]');
    await checkboxes.first().waitFor({ state: "visible", timeout: 15_000 });
    const values = await checkboxes.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(values).not.toContain("admin_users");
    expect(values).toContain("content_settings");

    // Conferma esplicita e lancio del restore (content_settings + flag legit).
    await page.locator("#restore-confirm").fill("RIPRISTINA");
    await page.getByRole("button", { name: /ripristina le tabelle selezionate/i }).click();
    await expect(page.getByText("Restore completato")).toBeVisible({ timeout: 20_000 });

    // Il file forgiato NON ha toccato admin_users: TEAM resta admin attivo,
    // col display_name del seed (il forgiato diceva «Account Promosso…»).
    const row = await dbExec("select role, active, display_name from admin_users where email = $1", [TEAM.email]);
    expect(row.rows[0]).toMatchObject({ role: "admin", active: true, display_name: "Team Backup E2E" });

    // Le righe legit di content_settings sono tornate: il flag del file è nel
    // DB (verifica con retry: la connessione del test e quella del server sono
    // transazioni diverse, la lettura deve attendere il commit — poi si pulisce
    // per i rerun).
    await expect
      .poll(
        async () => {
          const flag = await dbExec("select value from content_settings where key = $1", [FLAG_KEY]);
          return Number(flag.rows[0]?.value ?? 0);
        },
        { timeout: 10_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(1);
    await dbExec("delete from content_settings where key = $1", [FLAG_KEY]);
    const supersNow = await dbExec(
      "select email from admin_users where role = 'super_admin' and email = any($1)",
      [[SUPER.email, TEAM.email]],
    );
    // Solo il super admin legit: l'account dell'attore è rimasto admin.
    expect(supersNow.rows.map((r) => r.email)).toEqual([SUPER.email]);
  });
});
