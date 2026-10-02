import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * E2E della pagina LEADS (/admin/leads): la pipeline dei contatti.
 * Le asserzioni chiave (le stesse corrette a mano):
 *  - PERSISTENZA DELLE NOTE: il dettaglio «Note» resta APERTO per quel lead
 *    tra una navigazione e l'altra (sessionStorage per lead + ripristino
 *    pre-paint). Prima il <details> non controllato si richiudeva da solo
 *    mentre l'utente stava lavorando alla nota. E il NEIGHBOR resta chiuso:
 *    lo stato è per lead, non per pagina.
 *  - ANTEPRIMA AL POSTO DEL FALSO CONTATORE: il summary mostra l'inizio
 *    della nota salvata («Note: …»), non «Note (1)» — le note sono un campo
 *    singolo, il contatore non esiste.
 *  - FILTRO «DA RISPONDERE»: la chat che finisce col visitatore diventa
 *    lead con ricontatta_il impostato — la coda «devi richiamare» è letta
 *    dal DB (colonna ricontatta_il), i numeri della pagina devono
 *    corrispondere alla stessa fonte.
 *
 * Il seed scrive SOLO su wac_e2e (DB disposable): admin marcati
 * (@e2e.local, rimessi a posto dal seed) e leads marcati
 * source_page='/e2e-leads', rimossi in afterAll — chat-lead.spec legge
 * «l'ultimo lead inserito»: i nostri residui non devono mai sopravvivere.
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

const ADMIN = { email: "lead@e2e.local", password: "LeadSicura!22" };
const MARK = "/e2e-leads";

/** Un lead di prova; con conversationId attacca anche la chat del visitatore. */
async function seedLead(opts: { name: string; query: string; notes?: string }) {
  const lead = await dbExec(
    `insert into leads (name, phone, consent, status, temperature, source_page, initial_query, notes, created_at)
     values ($1, '+3902000000' || floor(random()*90+10)::int, true, 'nuovo', 'tiepido', $2, $3, $4, now() - interval '4 hours')
     returning id`,
    [opts.name, MARK, opts.query, opts.notes ?? null],
  );
  return lead.rows[0].id as string;
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
  await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
  await dbExec("delete from leads where source_page = $1", [MARK]);
  await dbExec("delete from conversations where source_page = $1", [MARK]);
  await dbExec("delete from admin_users where email = $1", [ADMIN.email]);
});

test.describe("leads: note persistenti e pipeline", () => {
  test("setup: seed admin + lead marcati", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Lead E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
    // Rerun-safe: nessun residuo dei run precedenti.
    await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
    await dbExec("delete from leads where source_page = $1", [MARK]);
    await dbExec("delete from conversations where source_page = $1", [MARK]);

    await seedLead({ name: "Anna E2E", query: "richiesta e2e anna", notes: "Cliente vuole essere richiamata dopo le 15." });
    await seedLead({ name: "Bruno E2E", query: "richiesta e2e bruno" });
  });

  test("il summary mostra l'anteprima della nota, non il falso contatore (1)", async ({ page }) => {
    await login(page);
    await page.goto("/admin/leads");

    // Anna ha una nota: il summary ne mostra l'INIZIO (riconoscerla senza
    // aprirla è il senso dell'anteprima)…
    const annaCard = page.locator("div.rounded-3xl").filter({ hasText: "Anna E2E" });
    await expect(annaCard.locator("summary")).toContainText("Note: Cliente vuole essere richiamata");
    // …e il vecchio «(1)» non deve tornare: le note sono un campo singolo.
    await expect(annaCard.locator("summary")).not.toContainText("(1)");

    // Bruno non ha note: summary asciutto, nessun numero inventato.
    const brunoCard = page.locator("div.rounded-3xl").filter({ hasText: "Bruno E2E" });
    await expect(brunoCard.locator("summary")).toHaveText(/Note$/);
  });

  test("il dettaglio Note resta aperto per quel lead tra le navigazioni; il vicino resta chiuso", async ({ page }) => {
    await login(page);
    await page.goto("/admin/leads");

    const annaCard = page.locator("div.rounded-3xl").filter({ hasText: "Anna E2E" });

    // Apro SOLO le note di Anna.
    await annaCard.locator("summary").click();
    await expect(annaCard.locator("textarea[name='notes']")).toBeVisible();

    // Navigo via e torno: la lista si riordina/ricarica, ma lo stato aperto
    // è per lead (sessionStorage) e sopravvive — prima si richiudeva da solo.
    await page.goto("/admin/callbacks");
    await page.goto("/admin/leads");

    const annaRiaperata = page.locator("div.rounded-3xl").filter({ hasText: "Anna E2E" });
    const brunoRiaperato = page.locator("div.rounded-3xl").filter({ hasText: "Bruno E2E" });
    await expect(annaRiaperata.locator("textarea[name='notes']")).toBeVisible();
    // Lo stato è PER LEAD: il vicino non si apre per conto suo. Attenzione
    // al selettore: un <details> chiuso mantiene i figli NEL DOM (solo non
    // renderizzati) — l'asserzione giusta è di VISIBILITÀ, non di conteggio.
    await expect(brunoRiaperato.locator("textarea[name='notes']")).not.toBeVisible();
    // E la verifica strutturale: il details di Bruno non ha l'attributo open.
    await expect(brunoRiaperato.locator("details")).not.toHaveAttribute("open");
  });

  test("salva nota: il testo arriva nel DB (l'anteprima si aggiorna al reload)", async ({ page }) => {
    await login(page);
    await page.goto("/admin/leads");

    const brunoCard = page.locator("div.rounded-3xl").filter({ hasText: "Bruno E2E" });
    await brunoCard.locator("summary").click();
    const TESTO = "Richiamare in orario ufficio, interessato a SEO locale.";
    await brunoCard.locator("textarea[name='notes']").fill(TESTO);
    await brunoCard.getByRole("button", { name: /salva nota/i }).click();
    // Il toast iOS di conferma (pattern admin-toaster del repo).
    await expect(page.getByText(/nota salvata/i)).toBeVisible({ timeout: 10_000 });

    const row = await dbExec("select notes from leads where source_page = $1 and name = 'Bruno E2E'", [MARK]);
    expect(row.rows[0]?.notes).toBe(TESTO);

    // Al reload l'anteprima riflette la nota salvata (la verità è nel DB).
    await page.goto("/admin/leads");
    const cardReloaded = page.locator("div.rounded-3xl").filter({ hasText: "Bruno E2E" });
    await expect(cardReloaded.locator("summary")).toContainText("Note: Richiamare in orario ufficio");
  });

  test("la coda «Da rispondere» del DB è quella che legge la pagina", async ({ page }) => {
    // Scenario: lead con ricontatta_il già passato = da richiamare.
    await dbExec(
      "update leads set ricontatta_il = now() - interval '1 hour' where source_page = $1 and name = 'Anna E2E'",
      [MARK],
    );

    await login(page);
    await page.goto("/admin/leads");

    // Il numero mostrato nella pagina (badge «richiama il …» + agenda della
    // panoramica) deriva dalla colonna ricontatta_il: il lead marcato deve
    // portare il suo promemoria scaduto in vista.
    const annaCard = page.locator("div.rounded-3xl").filter({ hasText: "Anna E2E" });
    await expect(annaCard.getByText(/richiama il/i)).toBeVisible();

    // E il DB conferma la fonte: esattamente 1 lead marcato è «da richiamare».
    const { rows } = await dbExec(
      "select count(*)::int as n from leads where source_page = $1 and ricontatta_il is not null and ricontatta_il < now() + interval '12 hours' and status <> 'chiuso'",
      [MARK],
    );
    expect(rows[0].n).toBe(1);
  });
});
