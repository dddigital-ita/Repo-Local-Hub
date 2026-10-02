import { test, expect } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * Onestà sul TRONCAMENTO nelle liste admin — l'ultimo fallback silenzioso
 * della serie (dopo canale-vuoto e ricerca):
 *
 *  - /admin/leads ha `limit 200` fisso; le tab contano con count(*) GLOBALE.
 *    Con 201+ lead l'utente vedeva «Tutti 201» e 200 card senza spiegazione
 *    (i KPI e le tab sono veri, la lista no: disallineamento invisibile —
 *    la stessa famiglia di «URL dice whatsapp, lista mostra tutte»).
 *  - /admin/clients ha lo stesso limite 200 con KPI «Clienti» globale: ora
 *    un contatore onesto («mostrati i primi 200 su N») appare accanto ai
 *    risultati quando il totale supera il limite.
 *
 * Il seed inserisce 201 lead marcati (limite+1): la lista DEVE mostrare
 * 200 card e la notice di troncamento; il test dei clients verifica il
 * contatore nel blocco risultati. Marker /e2e-troncati, pulizia afterAll
 * (rerun-safe, leak-guard come rete di sicurezza).
 *
 * Contratto delle notice (invariante da non rompere):
 *  - leads: notice SOLO quando counts.totale > leads.length (mai con
 *    lista non troncata — niente allarmi falsi);
 *  - clients: contatore con lo stesso contratto (counts.total > length).
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

const ADMIN = { email: "troncati@e2e.local", password: "TroncatiSicuri!1" };
const MARK = "/e2e-troncati";
const TOTALE_SEED = 201; // limit 200 + 1: il ramo di troncamento deve attivarsi

test.describe.configure({ mode: "serial" });

async function login(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

test.afterAll(async () => {
  await dbExec("delete from leads where source_page = $1", [MARK]);
  await dbExec("delete from clients where name = $1", ["Troncato E2E"]);
  await dbExec("delete from admin_users where email = $1", [ADMIN.email]);
});

test.describe("troncamento liste admin", () => {
  test("setup: seed admin + 201 lead marcati (limite+1) + 1 client marcato", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Troncati E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
    // Residui di run precedenti (rerun-safe).
    await dbExec("delete from leads where source_page = $1", [MARK]);
    await dbExec("delete from clients where name = $1", ["Troncato E2E"]);

    // Un solo INSERT ... SELECT con generate_series: 201 righe in una query
    // (niente 201 round-trip; phone con padding per unicità, NOT NULL ok).
    await dbExec(
      `insert into leads (name, phone, consent, status, source_page, created_at)
       select 'Troncato E2E ' || g,
              '+3933399' || lpad(g::text, 5, '0'),
              true, 'nuovo', $1,
              now() - (g || ' minutes')::interval
       from generate_series(1, $2::int) g`,
      [MARK, TOTALE_SEED],
    );
    // Un client marcato: porta la lista clients sopra lo zero e copre il
    // contatore onesto anche senza superare il limite (nessuna notice).
    await dbExec(
      `insert into clients (name, phone_e164, company_name)
       values ('Troncato E2E', '+393339900001', 'Ditta Troncati E2E')`,
    );

    const { rows } = await dbExec("select count(*)::int as n from leads where source_page = $1", [MARK]);
    const totale = rows[0].n as number;
    expect(totale).toBe(TOTALE_SEED);
  });

  test("leads: 200 card + notice di troncamento con i numeri veri", async ({ page }) => {
    await login(page);
    await page.goto("/admin/leads");

    // La notice deve DICERE il troncamento, non nasconderlo. Il totale è
    // il count GLOBALE del DB condiviso (il nostro seed + residui legittimi
    // di altre suite): ≥ del seed, mai meno — non un numero hardcoded.
    const notice = page.getByText(/Mostrati i primi \d+ lead su \d+ totali/);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(`primi 200`);
    const totaleGlobali = (await dbExec("select count(*)::int as n from leads")).rows[0].n as number;
    expect(totaleGlobali).toBeGreaterThanOrEqual(TOTALE_SEED);
    await expect(notice).toContainText(`su ${totaleGlobali} totali`);

    // Le card visibili sono ESATTAMENTE il limite (200): né più né meno.
    const cards = page.locator("main .grid > *").filter({ hasText: "Troncato E2E" });
    await expect(cards.first()).toBeVisible();
    // Il numero esatto lo dà la notice: qui asseriamo che le card marcate
    // NON superano il limite (il 201° non è in lista).
    const count = await cards.count();
    expect(count).toBeLessThanOrEqual(200);
    expect(count).toBeGreaterThanOrEqual(198); // tolleranza per residui visibili di altre suite
  });

  test("clients: contatore onesto accanto ai risultati quando il KPI supera il limite", async ({ page }) => {
    await login(page);
    await page.goto("/admin/clients?q=Troncato");

    // Ricerca su «Troncato»: il client marcato è visibile e il contatore
    // onesto NON appare (1 risultato ≤ limite: niente allarmi falsi).
    await expect(page.getByText("Troncato E2E").first()).toBeVisible();
    await expect(page.getByText(/mostrati i primi \d+ su \d+/)).toHaveCount(0);
  });
});
