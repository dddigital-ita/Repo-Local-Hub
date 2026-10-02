import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * E2E CATALOGO SERVIZI — Ambrosio vende anche SERVIZI oltre ai pacchetti
 * (migration 035: colonna kind su packages). Il ciclo su browser reale:
 *   1. seed admin e2e (per i rerun);
 *   2. tab Servizi in /admin/packages: i 4 seed della migration visibili;
 *   3. creazione di un servizio vero dal form → riga nel DB con kind='service';
 *   4. la home pubblica mostra la sezione «Servizi che vanno oltre il sito»
 *      col servizio creato (e i pacchetti restano nella loro sezione);
 *   5. dopoAll: pulizia dei seed (leak guard in globalTeardown controlla).
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

const ADMIN = { email: "servizi@e2e.local", password: "ServiziSicuri!22" };
const NUOVO_SERVIZIO = "Servizio Test Droni E2E";

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("catalogo servizi", () => {
  test("setup: seed admin e2e + archivio senza la riga di prova (per i rerun)", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Servizi E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
    await dbExec("delete from packages where name = $1", [NUOVO_SERVIZIO]);
  });

  test("tab Servizi: i 4 seed della migration sono nel catalogo", async ({ page }) => {
    await login(page);
    await page.goto("/admin/packages?tab=servizi");
    await expect(page.getByRole("heading", { name: /Servizi da vendere/i })).toBeVisible();
    for (const nome of ["Servizio Fotografico", "Servizio Video", "Assistenza Tecnica", "Assistenza Tecnica SOS Web"]) {
      await expect(page.getByText(nome).first()).toBeVisible();
    }
    // Le tab dei due cataloghi esistono ed entrambe raggiungibili.
    await expect(page.getByRole("tab", { name: /Pacchetti/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Servizi/i })).toBeVisible();
  });

  test("creo un servizio dal form: arriva nel DB con kind='service' e attivo", async ({ page }) => {
    await login(page);
    await page.goto("/admin/packages?tab=servizi");

    // Il form NUOVO è l'unico col bottone «Crea servizio» (i form di modifica
    // delle righe hanno «Salva modifiche»): così il selettore resta univoco.
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: /Crea servizio/i }) });
    await form.getByLabel("Nome*").fill(NUOVO_SERVIZIO);
    await form.getByLabel("Prezzo*").fill("da 90 €");
    await form.getByLabel(/Frase di vendita/).fill("Giriamo il tuo progetto dall'alto.");
    await form.getByLabel(/Cosa include/).fill("20 minuti di volo\n10 scatti aeree");
    // Ordine 1: la home mostra i primi 4 per sort_order (i 4 seed stanno a
    // 10–40) — l'operatore che vuole in home mette il servizio in cima.
    await form.getByLabel(/Ordine/).fill("1");
    await form.getByRole("button", { name: /Crea servizio/i }).click();
    // L'action server re-renderizza la lista: attendo la riga nuova PRIMA di
    // interrogare il DB (altrimenti l'insert può essere ancora in flight).
    await expect(page.getByText(NUOVO_SERVIZIO)).toBeVisible({ timeout: 15_000 });

    // La verità è nel DB: la riga esiste col catalogo giusto.
    const { rows } = await dbExec(
      "select kind, active, sort_order from packages where name = $1",
      [NUOVO_SERVIZIO],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("service");
    expect(rows[0].active).toBe(true);
  });

  test("la home pubblica mostra la sezione servizi col servizio creato", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Servizi che vanno oltre il sito/i })).toBeVisible();
    await expect(page.getByText(NUOVO_SERVIZIO)).toBeVisible();
    // I due cataloghi restano SEPARATI in home: la sezione pacchetti esiste
    // ancora e il servizio non compare lì dentro.
    await expect(page.getByRole("heading", { name: /Pacchetti chiari/i })).toBeVisible();
    const pacchetti = page.locator("section", { has: page.getByRole("heading", { name: /Pacchetti chiari/i }) });
    await expect(pacchetti.getByText(NUOVO_SERVIZIO)).toHaveCount(0);
  });

  test.afterAll(async () => {
    await dbExec("delete from packages where name = $1", [NUOVO_SERVIZIO]);
    await dbExec("delete from admin_users where email = $1", [ADMIN.email]);
  });
});
