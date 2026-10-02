import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * E2E della pagina CALLBACKS (/admin/callbacks): la coda dei richiami
 * fuori turno. Le asserzioni chiave (le stesse corrette a mano):
 *  - ORDINAMENTO REGISTRO: le PENDING (da chiamare) stanno sempre in cima,
 *    le chiuse (done/missed) in fondo sotto il titolo «Già chiamate
 *    (registro)» — appare UNA volta sola, alla prima occorrenza, come i
 *    data-header della inbox. Prima l'ordinamento per orario mescolava
 *    fatto/missed alla coda: un done di ieri sopra una pending di stanotte.
 *  - ESITO DEFINITIVO: «Fatto» sparisce come bottone, resta come pillola di
 *    registro e il DB registra status='done' (l'esito muove anche il
 *    sync Google Calendar: non è un click decorativo).
 *
 * Il seed scrive SOLO su was_e2e (DB disposable): admin e callback sono
 * marcati (notes='e2e-cb-mark', leads con source_page='/e2e-cb') e rimossi
 * in afterAll — chat-lead.spec legge «l'ultimo lead inserito»: i nostri
 * residui non devono mai sopravvivere al run.
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

const ADMIN = { email: "callback@e2e.local", password: "CallbackSicura!1" };
/** Marca delle righe di prova: slot_label riconoscibile + notes fisso. */
const MARK = "e2e-cb-mark";

async function seedCallback(opts: { slot: string; status: "pending" | "done" | "missed"; when: Date }) {
  const lead = await dbExec(
    `insert into leads (name, phone, consent, status, temperature, source_page, created_at)
     values ('Cliente ' || $1, '+3902000000' || floor(random()*90+10)::int, true, 'contattato', 'tiepido', '/e2e-cb', now() - interval '2 days')
     returning id`,
    [opts.slot],
  );
  const cb = await dbExec(
    `insert into callbacks (lead_id, scheduled_at, slot_label, status, notes, created_at)
     values ($1, $2, $3, $4, $5, now() - interval '2 days')
     returning id`,
    [lead.rows[0].id, opts.when, opts.slot, opts.status, MARK],
  );
  return cb.rows[0].id as string;
}

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  // FK circolari callbacks ↔ leads: si spezza come nel runner del repo
  // (update leads set callback_id = null) prima di cancellare.
  await dbExec("update leads set callback_id = null where callback_id in (select id from callbacks where notes = $1)", [MARK]);
  await dbExec("delete from callbacks where notes = $1", [MARK]);
  await dbExec("delete from leads where source_page = '/e2e-cb'", []);
  await dbExec("delete from admin_users where email = $1", [ADMIN.email]);
});

test.describe("callbacks: coda e registro", () => {
  test("setup: seed admin + 3 callback marcate (2 pending, 1 done)", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Callback E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
    // Rerun-safe: nessun residuo dei run precedenti prima di seminare.
    await dbExec("update leads set callback_id = null where callback_id in (select id from callbacks where notes = $1)", [MARK]);
    await dbExec("delete from callbacks where notes = $1", [MARK]);
    await dbExec("delete from leads where source_page = '/e2e-cb'", []);

    // Date calcolate in JS: un parametro $1 non valuta espressioni SQL
    // («now() + interval…» come stringa = syntax error sul cast).
    const giorno = (n: number) => new Date(Date.now() + n * 86_400_000);
    await seedCallback({ slot: "domani mattina e2e", status: "pending", when: giorno(1) });
    await seedCallback({ slot: "esito e2e", status: "pending", when: giorno(2) });
    await seedCallback({ slot: "ieri e2e", status: "done", when: giorno(-1) });
  });

  test("ordinamento: le pending precedono il registro, il titolo appare una volta sola", async ({ page }) => {
    await login(page);
    await page.goto("/admin/callbacks");

    const pendingCard = page.locator("div.rounded-3xl").filter({ hasText: "domani mattina e2e" });
    const doneCard = page.locator("div.rounded-3xl").filter({ hasText: "ieri e2e" });
    await expect(pendingCard).toBeVisible();
    await expect(doneCard).toBeVisible();

    // La coda da chiamare sta SOPRA il registro: è il senso della pagina
    // («da qui si chiama») — il done di ieri non copre la pending di domani.
    const yPending = (await pendingCard.boundingBox())?.y ?? -1;
    const yDone = (await doneCard.boundingBox())?.y ?? -1;
    expect(yPending).toBeLessThan(yDone);

    // Il titolo del registro appare alla PRIMA occorrenza di una callback
    // chiusa e MAI ripetuto a metà lista (pattern data-header della inbox).
    await expect(page.getByText(/già chiamate \(registro\)/i)).toHaveCount(1);
  });

  test("esito «Fatto»: il bottone sparisce, la pillola resta, il DB registra done", async ({ page }) => {
    await login(page);
    await page.goto("/admin/callbacks");

    const card = page.locator("div.rounded-3xl").filter({ hasText: "esito e2e" });
    // Prima dell'esito: la coppia Fatto/Mancato è nella colonna azioni.
    const fattoBtn = card.getByRole("button", { name: "Fatto", exact: true });
    await expect(fattoBtn).toBeVisible();

    await fattoBtn.click();

    // L'esito è definitivo: i bottoni spariscono e resta la pillola di
    // registro (il reload della server action porta la UI al stato del DB).
    await expect(card.getByRole("button", { name: "Fatto", exact: true })).toHaveCount(0, { timeout: 15_000 });
    await expect(card.locator("span", { hasText: /^Fatto$/ })).toBeVisible();

    // La verità sta nel DB: status='done' sulla callback giusta.
    const row = await dbExec("select status from callbacks where notes = $1 and slot_label = 'esito e2e'", [MARK]);
    expect(row.rows[0]?.status).toBe("done");
  });
});
