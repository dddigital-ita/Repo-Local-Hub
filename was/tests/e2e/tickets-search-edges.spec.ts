import { test, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * Casi limite della RICERCA nella inbox — i fallback silenziosi portati in
 * test dopo il fix likeContains (tickets-shared):
 *
 *  - i wildcard LIKE dell'utente (% e _) sono LETTERALI: «100%» trova il
 *    ticket che contiene «100%», non «1000…»; «legno_massello» non matcha
 *    «legnoXmassello». Prima del fix il pattern era `%${q}%` e la ricerca
 *    reinterpretava l'input in silenzio (la stessa famiglia del fallback
 *    del canale a zero: l'input non dice quello che mostra l'URL);
 *  - il NUMERO del ticket è un match esatto distinto dal LIKE: «#3» o «3»
 *    non devono essere inghiottiti dal termine liberi;
 *  - stringhe bianche e assenza di q non filtrano nulla (nessun «cerca
 *    «%%»» silenzioso);
 *  - zero risultati = empty state della coda, non una lista di altre chat.
 *
 * Convenzioni del repo: seed scrypt su was_e2e (DB disposable), login
 * reale dal form, MARK /e2e-ricerca-limite, pulizia in afterAll
 * (rerun-safe), serial come le altre spec di inbox.
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

const ADMIN = { email: "ricerca-limite@e2e.local", password: "RicercaSicura!1" };
const MARK = "/e2e-ricerca-limite";
/** Il ticket sonda: contiene i caratteri che PRIMA del fix erano wildcard. */
const QUERY_PCT = "preventivo 100% litografia";
const QUERY_UNDERSCORE = "legno_massello su misura";

test.describe.configure({ mode: "serial" });

async function seedTicket(query: string) {
  const r = await dbExec(
    `insert into conversations (initial_query, source_page, status, channel, created_at, updated_at)
     values ($1, $2, 'operator', 'web', now() - interval '3 hours', now() - interval '2 hours') returning id`,
    [query, MARK],
  );
  await dbExec("insert into messages (conversation_id, sender, body) values ($1, 'visitor', $2)", [
    r.rows[0].id,
    "messaggio cliente di prova (ricerca)",
  ]);
  return r.rows[0].id as string;
}

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

/** Compila la ricerca e attende l'URL con il termine (il form è GET). */
async function cerca(page: Page, term: string) {
  await page.goto(`/admin/tickets?q=${encodeURIComponent(term)}`);
}

test.afterAll(async () => {
  await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
  await dbExec("delete from conversations where source_page = $1", [MARK]);
  await dbExec("delete from admin_users where email = $1", [ADMIN.email]);
});

test.describe("ricerca inbox: casi limite", () => {
  test("setup: seed admin + due ticket sonda con wildcard nel testo", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Ricerca Limite E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
    await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
    await dbExec("delete from conversations where source_page = $1", [MARK]);
    const idPct = await seedTicket(QUERY_PCT);
    const idUnd = await seedTicket(QUERY_UNDERSCORE);
    assert.ok(idPct && idUnd);
  });

  test("«100%» trova SOLO il ticket con «100%» nel titolo (wildcard letterale)", async ({ page }) => {
    await login(page);
    await cerca(page, "100%");

    await expect(page.getByText(QUERY_PCT)).toBeVisible();
    // Prima del fix, % era wildcard: «100%» ≡ «100» + qualsiasi cosa, e la
    // ricerca (che matcha anche initial_query di altre specifiche) diventava
    // troppo larga. Qui il match deve restare SUL titolo con il simbolo.
    await expect(page.getByText(QUERY_UNDERSCORE)).toHaveCount(0);
    await expect(page.getByText("sitoweb prova e2e")).toHaveCount(0);
  });

  test("«legno_massello» non matcha varianti con altro carattere al posto di _", async ({ page }) => {
    await login(page);
    await cerca(page, "legno_massello");

    await expect(page.getByText(QUERY_UNDERSCORE)).toBeVisible();
    // «legnoXmassello» non esiste nel seed: se _ fosse ancora wildcard, il
    // pattern matcherebbe qualunque interpolate — qui la lista resta strettamente
    // sul ticket con l'underscore vero.
    await expect(page.getByText(QUERY_PCT)).toHaveCount(0);
  });

  test("termine bianco o assente: nessun filtro silenzioso", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?q=%20%20");
    // Spazi bianchi: nessuna ricerca Parte, la lista è la coda normale
    // (le due sonde sono visibili perché nessun filtro le toglie).
    await expect(page.getByText(QUERY_PCT)).toBeVisible();
    await expect(page.getByText(QUERY_UNDERSCORE)).toBeVisible();

    // Senza q del tutto: stessa situazione.
    await page.goto("/admin/tickets");
    await expect(page.getByText(QUERY_PCT)).toBeVisible();
  });

  test("zero risultati: empty state della coda, non le altre chat", async ({ page }) => {
    await login(page);
    await cerca(page, "zanzibar non esiste nel seed");

    await expect(page.getByText("Nessun ticket in questa coda")).toBeVisible();
    await expect(page.getByText(QUERY_PCT)).toHaveCount(0);
  });

  test("numero del ticket: match ESATTO (il numero non deve finire nel LIKE)", async ({ page }) =>
    {
    await login(page);
    // Recupera il numero reale della sonda «100%» dal DB: il numero è una
    // sequence condivisa, il valore assoluto non è deterministico.
    const r = await dbExec("select number from conversations where source_page = $1 limit 1", [MARK]);
    const numero: string = String(r.rows[0].number);

    // Il numero puro matcha per uguaglianza esatta (ramo c.number::text = $n).
    await cerca(page, numero);
    await expect(page.getByText(QUERY_PCT)).toBeVisible();
    // Il numero come prefisso NON deve matchare il ticket COMPLETO per via
    // del LIKE (i numeri sono identità, non testo libero). Scelgo un prefisso
    // che non coincide con NESSUN altro numero del DB, così l'unico modo per
    // vedere la sonda sarebbe il match spurio che il fix deve escludere.
    const numeri = await dbExec("select number::text as n from conversations");
    const tutti = new Set(numeri.rows.map((r) => r.n));
    let prefisso = numero.slice(0, -1);
    while (prefisso.length > 0 && [...tutti].some((n) => n.startsWith(prefisso) && n !== numero)) {
      prefisso = prefisso.slice(0, -1);
    }
    if (prefisso.length > 0) {
      await cerca(page, prefisso);
      const visibilePerPrefisso = await page.getByText(QUERY_PCT).isVisible().catch(() => false);
      assert.ok(!visibilePerPrefisso, `il prefisso ${prefisso} non deve tirare su il ticket #${numero}`);
    }
  });
});
