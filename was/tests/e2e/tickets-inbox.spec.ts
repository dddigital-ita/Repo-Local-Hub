import { test, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * E2E della INBOX TICKET (/admin/tickets): il triage quotidiano del team.
 * Le asserzioni chiave (le stesse corrette a mano e da non più rompere):
 *  - GERARCHIA CTA: una sola azione primaria a schermo. Con la casella email
 *    vuota «Sincronizza email» è primaria e «Nuovo ticket» secondaria — e
 *    viceversa quando esistono ticket email (l'azione urgente cambia col
 *    contesto, mai due bottoni che si contendono il click);
 *  - CONTEGGI DEI FILTRI: i numeri della segmented control corrispondono al
 *    DB reale (aperti = non chiusi e non archiviati, da rispondere = ultimo
 *    messaggio del visitatore) e la riga filtro mostra «· N da rispondere»;
 *  - CARD TICKET SU MOBILE: la card esiste, il titolo è il link (gesto
 *    primario), le azioni di triage vivono FUORI dal link (nessun
 *    interattivo annidato) e la riga meta va a capo TRA le voci, mai dentro
 *    (niente separatori orfani a inizio riga).
 *
 * Il seed scrive SOLO su was_e2e (DB disposable): hash scrypt della stessa
 * ricetta di lib/admin, login reale attraverso il form. I ticket di prova
 * sono marcati source_page='/e2e-inbox' e rimossi in afterAll (rerun-safe,
 * come la convenzione di password-reset.spec: nessuna traccia dopo di sé).
 *
 * Fasi 2–3 del redesign (assessment docs/tickets-redesign-assessment.md):
 *  - ETÀ RELATIVA sulla riga («3gg» accanto alla data assoluta): la forma
 *    breve dice quanto è vecchio, la lunga quando è successo;
 *  - BOTTONE DASHBOARD in header: scoperta a vetro SEMPRE secondaria — la
 *    gerarchia CTA resta una-primaria-per-scenario (test dedicato sotto).
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

const ADMIN = { email: "inbox@e2e.local", password: "InboxSicura!1" };
/** Marca di tutti i ticket di prova: la pulizia li aggancia a questo. */
const MARK = "/e2e-inbox";
/** La conversazione WhatsApp per la variante C (lead con wa_phone). */
const QUERY_WA = "whatsappv e2e";
const LEAD_WA = { name: "Marco WA E2E", phone: "+393339990042" };

test.describe.configure({ mode: "serial" });

/** Un ticket di prova con l'ultimo messaggio di chi scrive (visitor | operator). */
async function seedTicket(opts: {
  query: string;
  status?: string;
  lastSender?: "visitor" | "operator";
  channel?: string;
}) {
  const r = await dbExec(
    `insert into conversations (initial_query, source_page, status, channel, created_at, updated_at)
     values ($1, $2, $3, $4, now() - interval '3 hours', now() - interval '2 hours') returning id, number`,
    [opts.query, MARK, opts.status ?? "operator", opts.channel ?? "web"],
  );
  const id = r.rows[0].id as string;
  await dbExec(
    "insert into messages (conversation_id, sender, body) values ($1, $2, $3)",
    [id, opts.lastSender ?? "operator", `messaggio di prova (${opts.lastSender ?? "operator"})`],
  );
  return { id, number: r.rows[0].number as number };
}

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

test.afterAll(async () => {
  // Nessuna traccia dopo di sé: gli altri spec contano le righe del DB E2E.
  await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
  await dbExec("delete from conversations where source_page = $1", [MARK]);
  await dbExec("delete from leads where source_page = $1", [MARK]);
  await dbExec("delete from admin_users where email like '%@e2e.local'");
});

test.describe("inbox ticket", () => {
  test("setup: seed admin + ticket marcati nel DB E2E", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Inbox E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
    // Reset dei residui di run precedenti (rerun-safe), poi lo scenario fisso:
    //  - «sitoweb prova e2e»: aperto, l'ultima parola è del CLIENTE → da rispondere;
    //  - «seo prova e2e»: chiuso → conta solo in «Tutti»;
    //  - «email prova e2e»: canale email, in attesa del cliente → dà un ticket email.
    await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
    await dbExec("delete from conversations where source_page = $1", [MARK]);
    await seedTicket({ query: "sitoweb prova e2e", status: "operator", lastSender: "visitor" });
    await seedTicket({ query: "seo prova e2e", status: "closed", lastSender: "visitor" });
    await seedTicket({ query: "email prova e2e", status: "operator", lastSender: "visitor", channel: "email" });

    // La conversazione per la VARIANTE C: canale whatsapp, lead che porta
    // wa_phone (migration 021) — è la condizione del bottone contestuale.
    const lead = await dbExec(
      `insert into leads (name, phone, consent, status, temperature, source_page, initial_query, wa_phone, created_at)
       values ($1, $2, true, 'nuovo', 'tiepido', $3, $4, $2, now() - interval '2 hours')
       returning id`,
      [LEAD_WA.name, LEAD_WA.phone, MARK, QUERY_WA],
    );
    const conv = await dbExec(
      `insert into conversations (initial_query, source_page, status, channel, lead_id, created_at, updated_at)
       values ($1, $2, 'operator', 'whatsapp', $3, now() - interval '2 hours', now() - interval '1 hour')
       returning id`,
      [QUERY_WA, MARK, lead.rows[0].id],
    );
    await dbExec("insert into messages (conversation_id, sender, body) values ($1, 'visitor', $2)", [
      conv.rows[0].id,
      "messaggio cliente di prova (whatsapp)",
    ]);
  });

  test("gerarchia CTA: una sola azione primaria, che cambia col contesto email", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets");

    // Con ticket email presenti, «Nuovo ticket» è l'unica CTA primaria
    // (il canale email è già rifornito: l'urgente è il triage, non l'ingresso).
    await expect(page.getByRole("link", { name: /nuovo ticket/i })).toHaveClass(/bg-brand-600/);
    const syncBtn = page.getByRole("button", { name: /sincronizza email/i });
    await expect(syncBtn).not.toHaveClass(/bg-brand-600/);

    // Lo scenario si ribalta quando la casella email si svuota: il canale
    // email a 0 rende PRIMARIA la sincronizzazione (è il modo in cui i
    // ticket email entrano) e secondario il nuovo ticket.
    await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1 and channel = 'email')", [MARK]);
    await dbExec("delete from conversations where source_page = $1 and channel = 'email'", [MARK]);
    await page.goto("/admin/tickets");
    await expect(syncBtn).toHaveClass(/bg-brand-600/);
    await expect(page.getByRole("link", { name: /nuovo ticket/i })).not.toHaveClass(/bg-brand-600/);
  });

  test("conteggi dei filtri corrispondono al DB reale", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?f=tutti");

    // I numeri li conosce il DB, non la UI: li rileggo dalla stessa fonte
    // della pagina (stessa definizione di countTickets/ticketFilterSql).
    const { rows } = await dbExec(
      `select
         count(*) filter (where archived_at is null and status <> 'closed')::int as aperti,
         count(*) filter (where archived_at is null and status <> 'closed' and status <> 'on_hold' and status <> 'bot'
                          and (select sender from messages m2 where m2.conversation_id = c.id order by created_at desc limit 1) = 'visitor')::int as da_rispondere,
         count(*) filter (where archived_at is null)::int as tutti
       from conversations c`,
    );
    const db = rows[0] as { aperti: number; da_rispondere: number; tutti: number };

    // Segment control: ogni filtro porta il suo numero, il filtro attivo è segnato.
    await expect(page.locator('nav[aria-label="Filtri ticket"] a[href*="f=aperti"]')).toContainText(String(db.aperti));
    await expect(page.locator('nav[aria-label="Filtri ticket"] a[href*="f=da_rispondere"]')).toContainText(String(db.da_rispondere));
    await expect(page.locator('nav[aria-label="Filtri ticket"] a[href*="f=tutti"]')).toContainText(String(db.tutti));
    // aria-current sulla tab attiva (accessibilità come da convenzione).
    await expect(page.locator('nav[aria-label="Filtri ticket"] a[href*="f=tutti"]')).toHaveAttribute("aria-current", "page");

    // La riga «Aperti» è l'unica a portare il promemoria «· N da rispondere»
    // (regola della pagina: la semantica vive in un posto solo).
    await expect(page.locator('nav[aria-label="Filtri ticket"] a[href*="f=aperti"]')).toContainText("da rispondere");
    await expect(page.locator('nav[aria-label="Filtri ticket"] a[href*="f=da_rispondere"]')).not.toContainText("da rispondere");

    // Tab canali: «Tutti i canali» somma i canali noti (web+email visibili sempre, anche a 0).
    await expect(page.getByRole("link", { name: /tutti i canali/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^chat web/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^email/i })).toBeVisible();
  });

  test("card ticket su viewport mobile: titolo-link, azioni fuori dal link, meta che non si spezza", async ({ page }) => {
    await login(page);
    // Viewport mobile reale (iPhone 12/13/14: 390×844).
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/tickets?f=tutti");

    // La CARD è il div .group/ticket (classe Tailwind con nome gruppo):
    // un locator generico «div che contiene il link» prenderebbe il
    // contenitore più interno (solo titolo+pills) e le azioni mancherebbero.
    const card = page.locator(".group\\/ticket").filter({ hasText: "sitoweb prova e2e" });

    // GESTO PRIMARIO: il titolo è il link alla pagina completa del ticket.
    const titleLink = card.getByRole("link", { name: /sitoweb prova e2e/i });
    await expect(titleLink).toBeVisible();
    await expect(titleLink).toHaveAttribute("href", /\/admin\/tickets\/[0-9a-f-]{36}$/);

    // NESSUN INTERATTIVO ANNIDATO: le azioni di triage (Prendi in carico,
    // menu ⋯) esistono nella card MA fuori dal link del titolo. È la regola
    // ARIA che nella vecchia UI era violata (click sul menu apriva il ticket).
    const takeOver = card.getByRole("button", { name: /prendi in carico/i });
    await expect(takeOver).toBeVisible();
    expect(await titleLink.locator("button").count()).toBe(0);

    // La riga meta (canale · contatto · msg · data) è composta da voci
    // nowrap: nessuna voce interna va a capo (niente «8 /» da un lato e
    // «msg» dall'altro, niente «·» orfani a inizio riga dopo il wrap).
    const metaOverflow = await card.evaluate((el) => {
      const p = el.querySelector("p.mt-0\\.5");
      if (!p) return "meta non trovata";
      return [...p.querySelectorAll("span")].some((s) => s.scrollWidth > s.clientWidth + 1)
        ? "una voce interna va a capo"
        : "ok";
    });
    expect(metaOverflow).toBe("ok");

    // La data non compare MAI come voce isolata che inizia col separatore
    // (il difetto «· 28 set, 05:45» corretto a mano e da non far tornare).
    const metaText = await card.locator("p.mt-0\\.5").innerText();
    for (const line of metaText.split("\n")) {
      expect(line.trim().startsWith("·")).toBe(false);
    }

    // Le tab canali scrollano orizzontalmente senza tagliare la pill attiva
    // (il padding verticale del contenitore serve proprio a questo).
    const clip = await page.locator('nav[aria-label="Canali"]').evaluate((el) => {
      const active = el.querySelector('[aria-current="page"]');
      if (!active) return "nessuna pill attiva";
      const r = active.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return r.top >= box.top - 1 && r.bottom <= box.bottom + 1 ? "ok" : "pill tagliata dal contenitore";
    });
    expect(clip).toBe("ok");
  });

  test("il filtro «Da rispondere» mostra i ticket con l'ultima parola del cliente", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/tickets?f=da_rispondere");

    // Il ticket marcatore è visibile; quelli chiusi no (anche se il loro
    // ultimo messaggio è del visitatore: la coda è «devi agire», non «storia»).
    await expect(page.getByRole("link", { name: /sitoweb prova e2e/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /seo prova e2e/i })).toHaveCount(0);

    // Il titolo della coda dice cosa conta il numero accanto («N risultati»).
    await expect(page.locator("#ticket-queue-title")).toHaveText(/Coda/);
  });

  test("fasi 2–3: bottone Dashboard in header (mai primario) ed età relativa sulla riga", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets");

    // FASE 3 — la scoperta della dashboard è un bottone a vetro visibile che
    // porta a /admin/tickets/dashboard (prima era solo testo nel sottotitolo).
    const dashBtn = page.getByRole("link", { name: /Dashboard/ }).filter({ has: page.locator("svg") });
    await expect(dashBtn).toBeVisible();
    await expect(dashBtn).toHaveAttribute("href", "/admin/tickets/dashboard");

    // GERARCHIA CTA: il bottone dashboard non deve MAI salire a primaria, e
    // tra «Sincronizza email» e «Nuovo ticket» ne resta UNA sola primaria
    // (quale delle due dipende dal canale email: il test della gerarchia qui
    // sopra lo svuota di proposito — l'invariante è lo stato, non la coppia).
    await expect(dashBtn).not.toHaveClass(/bg-brand-600/);
    const primarie = await page
      .locator("a:has-text('Nuovo ticket'), form button:has-text('Sincronizza email')")
      .evaluateAll((els) => els.filter((e) => e.className.includes("bg-brand-600")).length);
    expect(primarie).toBe(1);

    // FASE 2 — la riga porta l'età relativa accanto alla data assoluta:
    // forma breve («3m», «2h», «3gg», «2sett») con title sulla data completa.
    const age = page.locator(".group\\/ticket").filter({ hasText: "sitoweb prova e2e" }).locator("span[title^='Ultimo aggiornamento']");
    await expect(age).toHaveText(/^\d+(m|h|gg|sett)$/);
    // La data assoluta resta accanto: le due forme rispondono a domande diverse.
    await expect(age.locator("xpath=following-sibling::span[1]")).toContainText(/\d{1,2} [a-z]{3}/);
  });

  test("variante C: icona WhatsApp solo sulla riga che porta wa_phone, mai in pill", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets?f=tutti");

    // SULLA RIGA GIUSTA: l'icona compatta in colonna azioni (aria-label che
    // cita il ticket, href wa.me, classe icona h-9 w-9 — NON la pill della
    // scheda cliente che affollerebbe la riga stato).
    const waCard = page.locator(".group\\/ticket").filter({ hasText: QUERY_WA });
    const waBtn = waCard.getByRole("link", { name: /^WhatsApp per il ticket #/ });
    await expect(waBtn).toBeVisible();
    const href = await waBtn.getAttribute("href");
    assert.ok(href?.startsWith("https://wa.me/393339990042?text="), `href inatteso: ${href}`);
    const text = decodeURIComponent(new URL(href!).searchParams.get("text") ?? "");
    assert.match(text, /ticket #\d+/); // il testo precompilato CITA il ticket
    await expect(waBtn).toHaveClass(/h-9 w-9/);
    // Nella riga stato (le pill accanto al titolo) NON c'è nessun link WA:
    // l'etichetta «WhatsApp» vive solo nella meta del canale.
    const pillRow = waCard.locator("div").filter({ has: waCard.getByRole("link", { name: new RegExp(QUERY_WA, "i") }) }).first();
    await expect(pillRow.getByRole("link", { name: /whatsapp/i })).toHaveCount(0);

    // SULLE ALTRE RIGHE (lead senza wa_phone): nessun bottone — la regola è
    // per-ticket, non di lista.
    const noWa = page.locator(".group\\/ticket").filter({ hasText: "sitoweb prova e2e" });
    await expect(noWa.getByRole("link", { name: /^WhatsApp per il ticket #/ })).toHaveCount(0);
  });
});
