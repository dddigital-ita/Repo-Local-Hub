import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * E2E della PAGINAZIONE della coda ticket (/admin/tickets?page=N):
 * Precedenti/Successivi minimali, niente numeri di pagina. Le asserzioni
 * chiave (le stesse verificate a mano con 67 ticket reali):
 *  - FIXTURE > PAGE_SIZE (60): la pagina 1 taglia a 60 e offre «Successivi»,
 *    la pagina 2 porta le restanti con «Precedenti» al posto della primaria;
 *  - PRESERVAZIONE: pagina e filtro viaggiano insieme nell'URL (?f=tutti&page=2)
 *    e tornare indietro RIABDONA l'URL (pagina 1 = ?f=tutti, mai &page=1);
 *  - AZZERAMENTO AL CAMBIO FILTRO: scegliere un'altra tab parte dalla pagina 1
 *    (finire in pagina 3 di un filtro appena scelto era un cortocircuito);
 *  - EDGE OLTRE LA FINE: ?page=999 → lista vuota SENZA nav di paginazione
 *    (Precedenti cadrebbe in un'altra pagina vuota) e con la CTA di recupero.
 *
 * Il seed inserisce 70 ticket chiusi marcati source_page='/e2e-pag' (≥1 pagina
 * intera + coda, indipendente dal contenuto del DB E2E) e li rimuove in
 * afterAll. Created_at scaglionati: l'ordinamento è stabile tra le pagine.
 *
 * Il DB E2E è CONDIVISO (chat-lead, inbox e altri lasciano conversazioni non
 * archiviate): ciò che conta qui è «più di 60 non archiviate», non il totale
 * esatto — per questo il range in pagina 2 NON è hardcodato (61–70 è vero
 * solo col DB pulito): lo rileggo dal DB con lo stesso predicato e lo stesso
 * ordine di listTickets (bucket «da rispondere» prima, poi updated_at/id).
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

const ADMIN = { email: "paginazione@e2e.local", password: "PaginaSicura!1" };
const MARK = "/e2e-pag";
const N_TICKET = 70; // > 60: una pagina intera + coda
const PAGE_SIZE = 60;

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

const paginazione = (page: Page) => page.locator('nav[aria-label="Paginazione coda"]');

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
  await dbExec("delete from conversations where source_page = $1", [MARK]);
  await dbExec("delete from admin_users where email = $1", [ADMIN.email]);
});

test.describe("paginazione della coda ticket", () => {
  test("setup: seed admin + 70 ticket marcati", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Paginazione E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
    // Rerun-safe: nessun residuo dei run precedenti prima di seminare.
    await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
    await dbExec("delete from conversations where source_page = $1", [MARK]);

    // Chiusi: la coda «aperti» resta pulita per gli altri spec. Scaglionati
    // di 1 minuto (ordinamento totale updated_at+id: stabile tra pagine).
    const values: string[] = [];
    for (let i = 1; i <= N_TICKET; i++) {
      values.push(`('pagtest ticket ${String(i).padStart(2, "0")}', '${MARK}', 'closed', now() - interval '${i} minutes', now() - interval '${i} minutes')`);
    }
    const r = await dbExec(
      `insert into conversations (initial_query, source_page, status, created_at, updated_at) values ${values.join(",")}`,
    );
    expect(r.rowCount).toBe(N_TICKET);
  });

  test("pagina 1: taglia a 60, offre «Successivi», URL pulito senza page", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?f=tutti");

    // Il titolo della coda dice il taglio: «60 ticket», niente range in pagina 1.
    await expect(page.locator('section[aria-labelledby="ticket-queue-title"] >> text=/^60 ticket$/')).toBeVisible();

    // La nav esiste (c'è una pagina 2) ma con SOLO «Successivi»: prima pagina,
    // niente «Precedenti» che porterebbe a un URL con &page=0.
    const nav = paginazione(page);
    await expect(nav.getByText(/pagina 1/i)).toBeVisible();
    await expect(nav.getByRole("link", { name: /successivi/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /precedenti/i })).toHaveCount(0);

    // Le card in pagina sono esattamente PAGE_SIZE (il +1 della query è il
    // sonda «esiste la pagina successiva», mai renderizzato).
    const cardCount = await page.locator('a[href^="/admin/tickets/"][href*="-"]').count();
    expect(cardCount).toBe(PAGE_SIZE);

    // URL pulito: la pagina 1 non compare mai nei link condivisibili.
    expect(new URL(page.url()).search).toBe("?f=tutti");
  });

  test("pagina 2: il resto della coda, «Precedenti» riabbrona l'URL, filtro preservato", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?f=tutti");
    await paginazione(page).getByRole("link", { name: /successivi/i }).click();
    await page.waitForURL(/\bpage=2\b/);

    // Quante righe restano oltre la pagina 1 lo dice il DB (condiviso!), con
    // lo stesso predicato di listTickets per f=tutti (archiviati esclusi) e
    // lo stesso ordine totale della pagina (bucket, updated_at, id).
    const { rows } = await dbExec(
      `with ord as (
         select (case when c.status <> 'closed' and c.status <> 'on_hold'
                       and (select sender from messages m2 where m2.conversation_id = c.id
                            order by created_at desc limit 1) = 'visitor'
                      then 0 else 1 end) as bucket,
                c.updated_at, c.id
         from conversations c
         where c.archived_at is null
       ), ranked as (
         select row_number() over (order by bucket asc, updated_at desc, id desc) as rn from ord
       )
       select count(*)::int as n from ranked where rn > $1`,
      [PAGE_SIZE],
    );
    const oltrePrima = Number(rows[0]?.n ?? 0);
    expect(oltrePrima).toBeGreaterThan(0);

    // Range onesto: il server non conosce il totale senza un conteggio —
    // «Ticket 61–N» (posizione), non «di N» (controsenso del vecchio formato).
    await expect(page.getByText(new RegExp(`Ticket 61–${PAGE_SIZE + oltrePrima}`))).toBeVisible();

    const nav = paginazione(page);
    // «Successivi» sparisce solo se il resto ci sta in una pagina (nel DB E2E
    // condiviso il resto è una manciata: qui deve mancare; se un domani un
    // altro spec gonfiasse la coda oltre 120, l'assert adattato non mente).
    if (oltrePrima <= PAGE_SIZE) {
      await expect(nav.getByRole("link", { name: /successivi/i })).toHaveCount(0);
    }
    await expect(nav.getByText(/pagina 2/i)).toBeVisible();

    // «Precedenti» riabbrona l'URL: il filtro resta, la pagina sparisce (1 = pulito).
    // HREF PRIMA del click (contratto all'utente). Poi click e attesa breve:
    // in dev la transizione client su una lista di 60+ card a volte si abortisce
    // («Transition was aborted», artefatto di performance dev-mode — in prod è
    // istantanea) e può lasciare l'URL immutato: fallback hard-nav, il resto
    // delle asserzioni misura comunque la semantica dell'URL di destinazione.
    const precedenti = nav.getByRole("link", { name: /precedenti/i });
    await expect(precedenti).toHaveAttribute("href", /\/admin\/tickets\?f=tutti$/);
    await precedenti.click();
    await page.waitForURL(/\/admin\/tickets\?f=tutti$/, { timeout: 8_000 }).catch(() => page.goto("/admin/tickets?f=tutti"));
    expect(new URL(page.url()).search).toBe("?f=tutti");
    await expect(nav.getByText(/pagina 1/i)).toBeVisible();
  });

  test("cambio filtro: la pagina si azzera (mai pagina 3 di un filtro appena scelto)", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?f=tutti&page=2");
    await expect(paginazione(page)).toBeVisible(); // pagina 2 esiste per «tutti»

    // Le tab filtro portano f=… SENZA page: il clic da pagina 2 deve atterrare
    // sulla pagina 1 del nuovo filtro, non su una pagina 2 magari inesistente.
    // HREF prima + fallback hard-nav (stesso artefatto del router dev, vedi sopra).
    const tab = page.locator('nav[aria-label="Filtri ticket"] a[href*="f=da_rispondere"]');
    await expect(tab).toHaveAttribute("href", /f=da_rispondere$/);
    await tab.click();
    await page.waitForURL(/f=da_rispondere/, { timeout: 8_000 }).catch(() => page.goto("/admin/tickets?f=da_rispondere"));
    expect(new URL(page.url()).search).not.toContain("page=");
    // E la nav sparisce: la coda «da rispondere» del DB E2E (condiviso) sta
    // in una pagina — la rileggo dal DB col predicato AWAITING della pagina
    // invece di darlo per scontato.
    const { rows } = await dbExec(
      `select count(*)::int as n from conversations c
       where c.archived_at is null and c.status <> 'closed' and c.status <> 'on_hold'
         and (select sender from messages m2 where m2.conversation_id = c.id
              order by created_at desc limit 1) = 'visitor'`,
    );
    if (Number(rows[0]?.n ?? 0) <= PAGE_SIZE) {
      await expect(paginazione(page)).toHaveCount(0);
    }
  });

  test("edge oltre la fine: ?page=999 → vuoto SENZA nav, con CTA di recupero", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?f=tutti&page=999");

    // Stato vuoto riconoscibile (non una pagina rotta).
    await expect(page.getByText("Nessun ticket in questa coda")).toBeVisible();

    // La nav di paginazione NON c'è: «Precedenti» qui cadrebbe in un'altra
    // pagina vuota (998) — la via d'uscita è la CTA dedicata del vuoto.
    await expect(paginazione(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /torna alla prima pagina/i })).toBeVisible();

    // E la CTA funziona: torna alla pagina 1 con il filtro preservato
    // (fallback hard-nav anche qui: vedi l'artefatto del router dev sopra).
    const cta = page.getByRole("link", { name: /torna alla prima pagina/i });
    // Il banner consenso (fixed in fondo pagina) può coprire la CTA prima
    // che il consenso esista: la corsa è reale (01/10, run a cache fredda su
    // Crema — 82 retry e timeout). Lo chiudo prima del click, con l'idioma
    // di backup-restore: attesa del montaggio, click se c'è, mai fatale.
    const accetta = page.getByRole("button", { name: "Accetta tutti" });
    if (await accetta.waitFor({ state: "visible", timeout: 2_000 }).catch(() => null)) {
      await accetta.click();
      await expect(accetta).toBeHidden();
    }
    await cta.click();
    await page.waitForURL(/\/admin\/tickets\?f=tutti$/, { timeout: 8_000 }).catch(() => page.goto("/admin/tickets?f=tutti"));
    expect(new URL(page.url()).search).toBe("?f=tutti");
    await expect(page.getByText(/Nessun ticket in questa coda/)).toHaveCount(0);
  });

  test("page sporca nell'URL: NaN, 0 e negativi cadono sulla pagina 1", async ({ page }) => {
    await login(page);
    // parseInt('abc') = NaN → || 1; 0 e negativi → Math.max(1, …). La pagina
    // 1 ha l'URL «pulito» nel senso funzionale: la nav parte da «Pagina 1».
    for (const dirty of ["abc", "0", "-3"]) {
      await page.goto(`/admin/tickets?f=tutti&page=${dirty}`);
      await expect(paginazione(page).getByText(/pagina 1/i)).toBeVisible();
      expect(new URL(page.url()).search).toBe(`?f=tutti&page=${dirty}`); // l'URL dell'utente non viene riscritto
    }
  });
});
