import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * Regressione del footgun logout (visto sul vivo su WebAgencyCrema):
 * /admin/logout era un Route Handler GET che cancellava il cookie e
 * «Esci» era un <Link>: Next prefetcha i link visibili a idle → il
 * prefetch eseguiva il GET → la sessione moriva da sola pochi secondi
 * dopo ogni pagina caricata. L'E2E non lo vedeva perché i click arrivano
 * subito, prima che il prefetch a idle parta.
 *
 * Asserzioni:
 *  - restare fermi su /admin NON deve mai far morire la sessione (il GET
 *    di /admin/logout non ha più side-effect: è una pagina con form POST);
 *  - il click su «Esci» slogga davvero (POST → redirect al login);
 *  - dopo il logout, /admin rimanda al login (sessione davvero morta).
 *
 * Seed sulla ricetta di utenti.spec: hash scrypt di lib/admin, DB
 * disposable was_e2e, login reale attraverso il form.
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

const ADMIN = { email: "esci@e2e.local", password: "EsciSicura!42" };

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await dbExec("delete from admin_users where email like '%@e2e.local'");
});

async function login(page: Page, email: string, password: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /accedi|entra|login/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

test.describe("logout senza prefetch-footgun", () => {
  test("setup: seed admin nel DB E2E", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name)
       values ($1,$2,'super_admin','Esci E2E')
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
  });

  test("il cookie sopravvive all'idle (nessun logout da prefetch) ed Esci slogga", async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);

    const cookieViva = async () =>
      (await page.context().cookies()).some((c) => c.name === "wac_admin");

    // Lo scenario del bug: pagina caricata e poi NESSUNA interazione — il
    // prefetch dei link parte a idle. Prima del fix, il GET di /admin/logout
    // (link «Esci» prefetchabile) cancellava il cookie entro pochi secondi.
    await page.waitForTimeout(6_000);
    expect(await cookieViva()).toBe(true);

    // Il percorso del PREFETCH: GET HTTP puro sulla pagina logout (senza
    // renderizzare il client JS, come fa Next a idle). Prima del fix questo
    // GET cancellava il cookie; ora è una pagina inerte — 200 e sessione intatta.
    const res = await page.request.get("/admin/logout");
    expect(res.status()).toBe(200);
    expect(await cookieViva()).toBe(true);

    // Il logout vero arriva solo dal POST: click su «Esci» nella nav.
    await page.getByRole("button", { name: /esci/i }).click();
    await page.waitForURL(/\/admin\/login/, { timeout: 15_000 });
    expect(await cookieViva()).toBe(false);

    // La sessione è davvero morta: /admin non è più raggiungibile.
    await page.goto("/admin");
    await page.waitForURL(/\/admin\/login/, { timeout: 15_000 });
  });

  test("la pagina logout auto-inviata slogga (percorso auto-submit)", async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    // Auto-submit JS → POST → redirect al login, come un vecchio link diretto.
    await page.goto("/admin/logout");
    await page.waitForURL(/\/admin\/login/, { timeout: 15_000 });
    const viva = (await page.context().cookies()).some((c) => c.name === "wac_admin");
    expect(viva).toBe(false);
  });
});
