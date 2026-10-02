import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

/**
 * E2E delle AZIONI BULK sulla coda (parità col gemello WebAgencyCrema):
 * checkbox per card + barra contestuale. Le invarianti da non rompere:
 *  - la selezione vive nella UI ma AGISCE lato server (UNA action, loop
 *    per id): l'esito vero si legge nel DB E2E, non solo nel redirect;
 *  - il selettore «tutti» nell'header accende la barra in fondo (due
 *    istanze del componente che parlano via evento window);
 *  - la selezione NON sopravvive alla coda che non contiene più i ticket
 *    scelti (intersezione con ciò che si vede: non si agisce al buio);
 *  - claim solo per chi ha un operatore (UI senza bottone E guard server);
 *  - le guardie contano onesto: già-archiviato e già-chiuso non si
 *    ritoccano (il ?bulk=op:n del redirect porta il conteggio vero) e la
 *    chiusura FERMA i clock SLA come le azioni singole.
 *
 * Seed sul DB disposable was_e2e (marca /e2e-bulk, pulizia afterAll,
 * rerun-safe — convenzione tickets-inbox.spec). Niente unit dedicato: non
 * c'è una funzione pura nuova (il validation vive nella action, il resto
 * è stato client) — la copertura è E2E, come sul gemello.
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

const ADMIN = { email: "bulk@e2e.local", password: "BulkSicura!1" };
/** Admin SENZA operatore collegato: il claim non deve nemmeno apparire. */
const ADMIN_NO_OP = { email: "bulk-noop@e2e.local", password: "BulkSicura!2" };
/** Marca di tutti i ticket di prova: la pulizia li aggancia a questo. */
const MARK = "/e2e-bulk";
const OP_NAME = "Bulk E2E Op";
const OP_ID = randomUUID();

test.describe.configure({ mode: "serial" });

let T1 = ""; // aperto, clocks SLA armati → claim, poi chiusura con clock fermi
let T2 = ""; // aperto → claim, poi chiusura
let T3 = ""; // aperto → archiviazione
let T4 = ""; // GIÀ CHIUSO (closed_at di 1 giorno fa) → la guardia non lo ritocca
let T4_CLOSED_AT = new Date(0);

/** Un ticket di prova con l'ultimo messaggio di chi scrive. */
async function seedTicket(opts: { query: string; status?: string; closedAt?: Date }) {
  const r = await dbExec(
    `insert into conversations (initial_query, source_page, status, channel, closed_at, created_at, updated_at)
     values ($1, $2, $3, 'web', $4, now() - interval '3 hours', now() - interval '2 hours')
     returning id, closed_at`,
    [opts.query, MARK, opts.status ?? "operator", opts.closedAt ?? null],
  );
  const id = r.rows[0].id as string;
  await dbExec("insert into messages (conversation_id, sender, body) values ($1, 'visitor', $2)", [
    id,
    `messaggio cliente di prova (${opts.query})`,
  ]);
  return { id, closedAt: r.rows[0].closed_at as Date };
}

async function login(page: Page, user: { email: string; password: string } = ADMIN) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

/** La card della coda che contiene la query data (classe gruppo Tailwind). */
function card(page: Page, query: string) {
  return page.locator(".group\\/ticket").filter({ hasText: query });
}

/** Il form bulk dell'operazione data (input nascosto op=…): scope per la
 *  barra — le azioni SINGOLE delle card hanno altri form (stessi nomi di
 *  bottone: «Prendi in carico» esiste anche lì). */
function bulkForm(page: Page, op: string) {
  return page.locator("form").filter({ has: page.locator(`input[name="op"][value="${op}"]`) });
}

test.afterAll(async () => {
  // Nessuna traccia dopo di sé: gli altri spec contano le righe del DB E2E.
  // Le note (addAudit) prima delle conversazioni: la FK non basta da sola
  // se il cascade non è dichiarato. Gli admin PRIMA dell'operatore:
  // admin_users.operator_id è una FK verso operators — nel verso opposto
  // la delete dell'operatore muore (beccato alla prima run).
  await dbExec("delete from ticket_notes where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
  await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
  await dbExec("delete from conversations where source_page = $1", [MARK]);
  await dbExec("delete from admin_users where email in ($1, $2)", [ADMIN.email, ADMIN_NO_OP.email]);
  await dbExec("delete from operators where id = $1", [OP_ID]);
});

test.describe("azioni bulk sulla coda ticket", () => {
  test("setup: seed admin (con e senza operatore) + ticket marcati nel DB E2E", async () => {
    // Rerun-safe: i residui di run precedenti vanno via prima del seed.
    await dbExec("delete from ticket_notes where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
    await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
    await dbExec("delete from conversations where source_page = $1", [MARK]);

    const op = await dbExec(
      `insert into operators (id, first_name, phone, shift_start, shift_end, active)
       values ($1, $2, '+393339990043', 9, 18, true)
       on conflict (id) do update set first_name = excluded.first_name, active = true
       returning id`,
      [OP_ID, OP_NAME],
    );
    expect(op.rows).toHaveLength(1);
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active, operator_id)
       values ($1, $2, 'super_admin', 'Bulk E2E', true, $3)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true, operator_id = excluded.operator_id`,
      [ADMIN.email, hash(ADMIN.password), OP_ID],
    );
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active, operator_id)
       values ($1, $2, 'super_admin', 'Bulk NoOp E2E', true, null)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true, operator_id = null`,
      [ADMIN_NO_OP.email, hash(ADMIN_NO_OP.password)],
    );

    const t1 = await seedTicket({ query: "bulk uno e2e" });
    T1 = t1.id;
    // T1 porta i clock SLA ARMATI: la chiusura bulk deve spegnerli (regola
    // di setTicketStatus: chiuso = fermi).
    await dbExec(
      "update conversations set sla_next_reply_due = now() + interval '2 hours', sla_resolve_due = now() + interval '1 day' where id = $1",
      [T1],
    );
    T2 = (await seedTicket({ query: "bulk due e2e" })).id;
    T3 = (await seedTicket({ query: "bulk tre e2e" })).id;
    const t4 = await seedTicket({ query: "bulk quattro e2e", status: "closed", closedAt: new Date(Date.now() - 86_400_000) });
    T4 = t4.id;
    T4_CLOSED_AT = t4.closedAt;
  });

  test("la coda offre la selezione: checkbox per card e toggle «tutti» nell'header", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?f=tutti");

    // Le 4 card marcate portano la checkbox (colonna dedicata a 28px prima
    // del numero — la colonna c'è solo quando la riga è in inbox).
    for (const q of ["bulk uno e2e", "bulk due e2e", "bulk tre e2e", "bulk quattro e2e"]) {
      await expect(card(page, q).getByRole("checkbox")).toBeVisible();
    }
    // Il selettore «tutti» vive nel titolo della coda.
    await expect(page.getByLabel("Seleziona tutta la coda per azioni multiple")).toBeVisible();
  });

  test("selezionare accende la barra col conteggio; «deseleziona» la spegne", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?f=tutti");

    await card(page, "bulk uno e2e").getByRole("checkbox").check();
    await card(page, "bulk due e2e").getByRole("checkbox").check();
    await expect(page.getByText("2 ticket selezionati")).toBeVisible();
    // I form della barra: le tre azioni, col claim visibile (admin con operatore).
    await expect(bulkForm(page, "archive").getByRole("button", { name: /archivia/i })).toBeVisible();
    await expect(bulkForm(page, "close").getByRole("button", { name: /chiudi/i })).toBeVisible();
    await expect(bulkForm(page, "claim").getByRole("button", { name: /prendi in carico/i })).toBeVisible();

    await page.getByRole("button", { name: /deseleziona/i }).click();
    await expect(page.getByText(/ticket selezionat/)).toHaveCount(0);
  });

  test("«tutti» nell'header accende la barra per l'intera coda corrente", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?f=tutti");

    // Il checkbox «tutti» (header) parla con la barra (fondo) via evento:
    // due istanze, un solo stato — la lezione E2E del gemello.
    await page.getByLabel("Seleziona tutta la coda per azioni multiple").check();
    await expect(page.getByText(/\d+ ticket selezionat/)).toBeVisible();
    // E tutte le card sono effettivamente spuntate.
    for (const q of ["bulk uno e2e", "bulk due e2e", "bulk tre e2e", "bulk quattro e2e"]) {
      await expect(card(page, q).getByRole("checkbox")).toBeChecked();
    }
    await page.getByLabel("Seleziona tutta la coda per azioni multiple").uncheck();
    await expect(page.getByText(/ticket selezionat/)).toHaveCount(0);
  });

  test("la selezione non sopravvive alla coda che non contiene più i ticket", async ({ page }) => {
    await login(page);
    // T4 (chiuso) è visibile solo in «tutti»: lo seleziono lì.
    await page.goto("/admin/tickets?f=tutti");
    await card(page, "bulk quattro e2e").getByRole("checkbox").check();
    await expect(page.getByText("1 ticket selezionato")).toBeVisible();

    // Passo ad «aperti»: T4 esce dalla coda → l'intersezione svuota la
    // selezione e la barra sparisce (non si agisce su ciò che non si vede).
    await page.locator('nav[aria-label="Filtri ticket"] a[href*="f=aperti"]').click();
    await expect(page.getByText(/ticket selezionat/)).toHaveCount(0);
  });

  test("claim in blocco: i ticket finiscono all'operatore collegato", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?f=tutti");
    await card(page, "bulk uno e2e").getByRole("checkbox").check();
    await card(page, "bulk due e2e").getByRole("checkbox").check();

    await bulkForm(page, "claim").getByRole("button", { name: /prendi in carico/i }).click();
    await expect(page).toHaveURL(/bulk=claim:2/);
    await expect(page.getByText("Presi in carico in blocco: 2 ticket")).toBeVisible();

    const { rows } = await dbExec("select id, assigned_to from conversations where id = any($1)", [[T1, T2, T3, T4]]);
    const byId = new Map(rows.map((r) => [r.id as string, r.assigned_to as string | null]));
    expect(byId.get(T1)).toBe(OP_ID);
    expect(byId.get(T2)).toBe(OP_ID);
    expect(byId.get(T3)).toBeNull();
    expect(byId.get(T4)).toBeNull();
  });

  test("un admin senza operatore non ha il claim (l'azione non esiste in UI)", async ({ page }) => {
    await login(page, ADMIN_NO_OP);
    await page.goto("/admin/tickets?f=tutti");
    await card(page, "bulk tre e2e").getByRole("checkbox").check();

    // L'ultima lezione del gemello: il return silenzioso perde il redirect.
    // QUI il claim non arriva nemmeno alla action: senza operatore il
    // bottone non esiste (e l'admin resta libero di archiviare/chiudere).
    await expect(bulkForm(page, "claim")).toHaveCount(0);
    await expect(bulkForm(page, "archive").getByRole("button", { name: /archivia/i })).toBeVisible();
    await expect(bulkForm(page, "close").getByRole("button", { name: /chiudi/i })).toBeVisible();
  });

  test("archiviazione in blocco: conteggio onesto e riga fuori dalla coda", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?f=tutti");
    await card(page, "bulk tre e2e").getByRole("checkbox").check();

    await bulkForm(page, "archive").getByRole("button", { name: /archivia/i }).click();
    await expect(page).toHaveURL(/bulk=archive:1/);
    await expect(page.getByText("Archiviati in blocco: 1 ticket")).toBeVisible();

    const { rows } = await dbExec("select id, archived_at from conversations where id = any($1)", [[T1, T2, T3]]);
    const byId = new Map(rows.map((r) => [r.id as string, r.archived_at as Date | null]));
    expect(byId.get(T3)).not.toBeNull();
    expect(byId.get(T1)).toBeNull();
    expect(byId.get(T2)).toBeNull();
    // E la nota di audit per-ticket esiste (la storia resta leggibile).
    const note = await dbExec(
      "select body from ticket_notes where conversation_id = $1 and author_email = 'system'",
      [T3],
    );
    expect(note.rows[0]?.body as string).toContain("archiviazione multipla");
  });

  test("chiusura in blocco: clock SLA fermi e i già chiusi non si ritoccano", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?f=tutti");
    // T1 + T2 aperti, T4 GIÀ chiuso: seleziono tutti e tre.
    await card(page, "bulk uno e2e").getByRole("checkbox").check();
    await card(page, "bulk due e2e").getByRole("checkbox").check();
    await card(page, "bulk quattro e2e").getByRole("checkbox").check();

    await bulkForm(page, "close").getByRole("button", { name: /chiudi/i }).click();
    // :2 e non :3 — la guardia «status <> closed» non conta T4.
    await expect(page).toHaveURL(/bulk=close:2/);
    await expect(page.getByText("Chiusi in blocco: 2 ticket")).toBeVisible();

    const { rows } = await dbExec(
      `select id, status, closed_at, closed_by, sla_next_reply_due, sla_resolve_due, awaiting_notified_at
       from conversations where id = any($1)`,
      [[T1, T2, T4]],
    );
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    for (const id of [T1, T2]) {
      const r = byId.get(id)!;
      expect(r.status).toBe("closed");
      expect(r.closed_at).not.toBeNull();
      expect(r.closed_by).toBe(OP_ID); // stessa semantica di setTicketStatus
      expect(r.sla_next_reply_due).toBeNull(); // i clock si FERMANO
      expect(r.sla_resolve_due).toBeNull();
      expect(r.awaiting_notified_at).toBeNull();
    }
    // T4: closed_at resta QUello del seed (un giorno fa) — la chiusura bulk
    // non riscrive la storia dei già chiusi.
    const t4 = byId.get(T4)!;
    expect(Math.abs(new Date(t4.closed_at as Date).getTime() - T4_CLOSED_AT.getTime())).toBeLessThan(2000);
  });
});
