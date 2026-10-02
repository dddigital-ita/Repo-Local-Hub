import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * E2E del canale VUOTO nella inbox (/admin/tickets?channel=…): la tab «a
 * zero» è uno stato legittimo, non un canale inesistente.
 *
 * Bug corretto (30/09/2026, scoperto pulendo lo scenario demo WhatsApp):
 * la validazione del ?channel accettava solo i canali PRESENTI nel DB
 * (count > 0), quindi un canale a 0 conversazioni collassava in «tutti» —
 * l'URL diceva whatsapp ma la lista mostrava le ALTRE chat, con nessuna
 * tab attiva. Prima i ticket demo mascheravano il caso. Il fix: i canali
 * permanenti della UI (KNOWN_CHANNELS) restano validi anche a count 0 e
 * la lista mostra l'EMPTY STATE («Nessun ticket in questa coda»).
 *
 * Le asserzioni chiave (le stesse corrette a mano e da non più rompere):
 *  - ?channel=whatsapp con zero WhatsApp nel DB: tab ATTIVA (aria-current),
 *    sottotitolo «· whatsapp» sulla coda, empty state, NESSUNA card di
 *    altri canali;
 *  - il contrasto: la stessa lista SENZA filtro mostra le card seminate
 *    (il bug era proprio il fallback silenzioso, non la lista vuota);
 *  - ?channel=web con righe: filtra davvero;
 *  - canale sconosciuto (?channel=piccione): degrada ESPLICITAMENTE in
 *    «tutti» — tab Tutti i canali attiva e card visibili.
 *
 * Il seed scrive SOLO su was_e2e (DB disposable): hash scrypt della stessa
 * ricetta di lib/admin, login reale attraverso il form. I ticket di prova
 * sono marcati source_page='/e2e-canale-vuoto' e rimossi in afterAll
 * (rerun-safe). Per rendere deterministico lo scenario «canale a zero», il
 * setup rimuove anche eventuali residui WhatsApp di altre spec (marker
 * /e2e-%): è il tratto che il leak-guard segnala a fine run comunque.
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

const ADMIN = { email: "canale-vuoto@e2e.local", password: "CanaleSicuro!1" };
/** Marca dei ticket di prova: la pulizia li aggancia a questo. */
const MARK = "/e2e-canale-vuoto";
const QUERY_WEB = "sitoweb canale vuoto e2e";
const QUERY_WEB_ALTRO = "seo canale vuoto e2e";

test.describe.configure({ mode: "serial" });

async function seedWebTicket(query: string) {
  const r = await dbExec(
    `insert into conversations (initial_query, source_page, status, channel, created_at, updated_at)
     values ($1, $2, 'operator', 'web', now() - interval '3 hours', now() - interval '2 hours') returning id`,
    [query, MARK],
  );
  await dbExec("insert into messages (conversation_id, sender, body) values ($1, 'visitor', $2)", [
    r.rows[0].id,
    "messaggio cliente di prova (web)",
  ]);
}

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

/** La tab del canale (link con ?channel=…, testo «Label N»). */
function tabCanale(page: Page, label: string) {
  return page.getByRole("link", { name: new RegExp(`^${label}\\s*\\d+$`) });
}

test.afterAll(async () => {
  // Nessuna traccia dopo di sé: gli altri spec contano le righe del DB E2E.
  await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
  await dbExec("delete from conversations where source_page = $1", [MARK]);
  await dbExec("delete from admin_users where email = $1", [ADMIN.email]);
});

test.describe("canale vuoto nella inbox ticket", () => {
  test("setup: seed admin + solo ticket web marcati, zero whatsapp nel DB", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Canale Vuoto E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
    // Residui di run precedenti (rerun-safe)…
    await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
    await dbExec("delete from conversations where source_page = $1", [MARK]);
    // …e qualsiasi residuo WhatsApp e2e di altre spec: lo scenario richiede
    // il canale davvero a zero (altrimenti il test fila anche col bug).
    await dbExec(
      "delete from messages where conversation_id in (select id from conversations where channel = 'whatsapp' and source_page like '/e2e-%')",
    );
    await dbExec("delete from conversations where channel = 'whatsapp' and source_page like '/e2e-%'");

    // Due ticket WEB: senza questi, «lista vuota sul canale vuoto» sarebbe
    // ambiguo (il bug mostrava le chat web SOTTO l'URL whatsapp).
    await seedWebTicket(QUERY_WEB);
    await seedWebTicket(QUERY_WEB_ALTRO);

    const { rows } = await dbExec(
      "select count(*)::int as n from conversations where channel = 'whatsapp'",
    );
    expect(rows[0].n).toBe(0);
  });

  test("?channel=whatsapp a zero: tab attiva, empty state, nessuna card altrui", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?channel=whatsapp");

    // La tab WhatsApp resta ATTIVA anche a zero (il bug la disattivava).
    const tabWa = tabCanale(page, "WhatsApp");
    await expect(tabWa).toHaveAttribute("aria-current", "page");
    await expect(tabWa).toHaveText(/WhatsApp\s*0/);

    // Il sottotitolo della coda dichiara il canale…
    await expect(page.getByRole("heading", { name: /Coda/ })).toHaveText(/Coda\s*·\s*whatsapp/);
    // …la lista è l'EMPTY STATE dedicato…
    await expect(page.getByText("Nessun ticket in questa coda")).toBeVisible();
    // …e NESSUNA card di altri canali (il bug mostrava le 22 chat web).
    await expect(page.locator("div.group\\/ticket")).toHaveCount(0);
    await expect(page.getByText(QUERY_WEB)).toHaveCount(0);
  });

  test("senza filtro le card seminate ci sono: il contrasto prova il filtro", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets");

    await expect(page.getByText(QUERY_WEB)).toBeVisible();
    await expect(page.getByText(QUERY_WEB_ALTRO)).toBeVisible();
    // «Tutti i canali» attivo, WhatsApp torna a contare zero.
    await expect(page.getByRole("link", { name: /^Tutti i canali\s*\d+$/ })).toHaveAttribute("aria-current", "page");
    await expect(tabCanale(page, "WhatsApp")).toHaveText(/WhatsApp\s*0/);
  });

  test("?channel=web con righe: il filtro funziona davvero", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?channel=web");

    await expect(tabCanale(page, "Chat web")).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(QUERY_WEB)).toBeVisible();
    await expect(page.getByText(QUERY_WEB_ALTRO)).toBeVisible();
  });

  test("?channel=piccione (canale sconosciuto): degrada esplicitamente in tutti", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?channel=piccione");

    // Valore non noto e non nel DB → «tutti»: la lista è piena e la tab
    // Tutti i canali è attiva (mai una lista oscura senza tab selezionata).
    await expect(page.getByRole("link", { name: /^Tutti i canali\s*\d+$/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(QUERY_WEB)).toBeVisible();
  });
});
