import { test, expect, type Page } from "@playwright/test";
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
 * Il seed scrive SOLO su wac_e2e (DB disposable): hash scrypt della stessa
 * ricetta di lib/admin, login reale attraverso il form. I ticket di prova
 * sono marcati source_page='/e2e-inbox' e rimossi in afterAll (rerun-safe,
 * come la convenzione di password-reset.spec: nessuna traccia dopo di sé).
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

const ADMIN = { email: "inbox@e2e.local", password: "InboxSicura!1" };
/** Marca di tutti i ticket di prova: la pulizia li aggancia a questo. */
const MARK = "/e2e-inbox";

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

  test("scorciatoia /: la ricerca si apre e focusa da qualunque punto", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets");
    // Il bottone mostra la scorciatoia (discoverabilità)…
    await expect(page.getByRole("button", { name: /Cerca/ })).toContainText("/");
    // …e «/» premuto altrove apre la casella con il focus (non scrive «/»).
    // L'idratazione arriva QUANDO arriva: con la cache dev fredda la
    // compilazione ritarda i listener di secondi e un «/» premuto prima
    // viene inghiottito (corsa reale 01/10: spec verde su cache tiepida,
    // rossa alla prima run del giorno dopo lo svuotamento di .next-e2e).
    // Il toPass riprova finché il gestore esiste; fill("») neutralizza
    // un «/» caduto nella casella tra un tentativo e l altro.
    await expect(async () => {
      const casella = page.locator("#ticket-search");
      if (await casella.count()) await casella.fill("");
      await page.keyboard.press("/");
      await expect(casella).toBeFocused();
      await expect(casella).toHaveValue("");
    }).toPass({ timeout: 15_000 });
    // Dentro un campo di testo «/» è testo, non comando: il valore resta.
    await page.keyboard.type("prova/");
    await expect(page.locator("#ticket-search")).toHaveValue("prova/");
  });

  test("empty state: «Vai a Tutti» è il gesto precompilato del vuoto", async ({ page }) => {
    await login(page);
    // Ricerca senza risultati → l'uscita proposta è TORNARE alla coda…
    await page.goto("/admin/tickets?q=zzz-nessuno-così");
    await expect(page.getByText("Nessun ticket in questa coda")).toBeVisible();
    await expect(page.getByRole("link", { name: /Torna alla coda/ })).toBeVisible();
    // …mentre un filtro senza risultati (WhatsApp vuoto nel seed) propone
    // «Vai a Tutti», il gesto più probabile, senza passare da parole.
    await page.goto("/admin/tickets?channel=whatsapp");
    const vuoto = page.getByText("Nessun ticket in questa coda");
    const n = await vuoto.count();
    if (n > 0) {
      await expect(page.getByRole("link", { name: /Vai a Tutti/ })).toBeVisible();
    }
  });

  test("bozza composer: sopravvive al cambio ticket, muore all'invio", async ({ page }) => {
    await login(page);
    const a = await seedTicket({ query: "bozza e2e ALFA", status: "operator", lastSender: "visitor" });
    const b = await seedTicket({ query: "bozza e2e BETA", status: "operator", lastSender: "visitor" });

    // Scrivo una risposta ALFA e NON la invio.
    await page.goto(`/admin/tickets/${a.id}`);
    await page.getByLabel("Risposta al cliente").fill("Testo bozza che deve sopravvivere");
    // Vado al ticket B: il testo di A non è in scena…
    await page.goto(`/admin/tickets/${b.id}`);
    await expect(page.getByLabel("Risposta al cliente")).toHaveValue("");
    // …ma tornando ad A la bozza è tornata (sessionStorage per conversationId).
    await page.goto(`/admin/tickets/${a.id}`);
    await expect(page.getByLabel("Risposta al cliente")).toHaveValue("Testo bozza che deve sopravvivere");

    // L'invio la consuma: dopo il toast, il campo è vuoto e la bozza morta.
    await page.getByLabel("Risposta al cliente").press("Enter");
    await expect(page.getByText(/risposta inviata|inviata/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Risposta al cliente")).toHaveValue("");
    await page.reload();
    await expect(page.getByLabel("Risposta al cliente")).toHaveValue("");
  });

  test("nota interna: autore in evidenza prima della data", async ({ page }) => {
    await login(page);
    const t = await seedTicket({ query: "note autore e2e", status: "operator", lastSender: "visitor" });
    await dbExec(
      "insert into ticket_notes (conversation_id, author_email, body) values ($1, 'agente@e2e.local', 'Nota con autore in evidenza')",
      [t.id],
    );
    await page.goto(`/admin/tickets/${t.id}`);
    const caption = page.locator("p", { hasText: "agente@e2e.local" }).first();
    await expect(caption).toBeVisible();
    // Il nome è in <span> font-semibold DENTRO la caption, prima della data.
    const nomeBold = caption.locator("span.font-semibold", { hasText: "agente@e2e.local" });
    await expect(nomeBold).toBeVisible();
  });

  test("bulk: seleziono tre ticket e li archivio in un gesto", async ({ page }) => {
    await login(page);
    const t1 = await seedTicket({ query: "bulk e2e uno", status: "operator", lastSender: "visitor" });
    const t2 = await seedTicket({ query: "bulk e2e due", status: "operator", lastSender: "visitor" });
    const t3 = await seedTicket({ query: "bulk e2e tre", status: "operator", lastSender: "visitor" });

    await page.goto("/admin/tickets");
    for (const t of [t1, t2, t3]) {
      // Il numero è matchato col prefisso «#» e word-boundary: hasText "7"
      // matchava anche #17, #27, #71… (strict violation con counter basso).
      const card = page.locator("div.group\\/ticket").filter({ hasText: new RegExp(`#${t.number}\\b`, "u") });
      await card.locator("input[type=checkbox]").check();
    }
    // La barra contestuale appare col conto giusto (mobile-first: da v0.6.4
    // su mobile è full-width bottom-3, la pill centrata bottom-4 è solo sm+;
    // inset-x-2 resta la firma della barra a ogni breakpoint).
    const barra = page.locator("div.fixed.inset-x-2");
    await expect(barra).toContainText("3 ticket selezionati");

    await barra.getByRole("button", { name: /Archivia/ }).click();
    // Il redirect dice cosa e quanto; la GlassNotice della pagina lo porta in vista.
    await expect(page).toHaveURL(/bulk=archive:3/, { timeout: 15_000 });
    await expect(page.getByText(/Archiviati in blocco: 3 ticket/)).toBeVisible({ timeout: 15_000 });

    // La verità è nel DB: tutti e tre archiviati, con l'audit della action.
    for (const t of [t1, t2, t3]) {
      const { rows } = await dbExec("select archived_at from conversations where id = $1", [t.id]);
      expect(rows[0].archived_at).not.toBeNull();
    }
    // E la coda corrente non li mostra più.
    await expect(page.locator("div.group\\/ticket").filter({ hasText: "bulk e2e uno" })).toHaveCount(0);
  });

  test("bulk: «tutti» seleziona la coda; il claim richiede un operatore collegato", async ({ page }) => {
    await login(page);
    await seedTicket({ query: "bulk claim alfa", status: "operator", lastSender: "visitor" });
    await seedTicket({ query: "bulk claim beta", status: "operator", lastSender: "visitor" });

    await page.goto("/admin/tickets");
    await page.getByLabel("Seleziona tutta la coda per azioni multiple").check();
    const barra = page.locator("div.fixed.inset-x-2");
    const testo = await barra.locator("p").first().textContent();
    // Il conteggio segue la coda reale (≥ 2: i nostri due sono dentro).
    const m = testo?.match(/(\d+) ticket selezionati/);
    expect(Number(m?.[1] ?? 0)).toBeGreaterThanOrEqual(2);

    // L'admin E2E è super_admin SENZA operatore collegato: il claim (che
    // assegna a ME) non esiste per lui — come per l'azione singola. Le
    // altre due azioni sì.
    await expect(barra.getByRole("button", { name: /Archivia/ })).toBeVisible();
    await expect(barra.getByRole("button", { name: /Chiudi/ })).toBeVisible();
    await expect(barra.getByRole("button", { name: /Prendi in carico/ })).toHaveCount(0);

    // Chiudo in blocco: anche senza operatore, la pulizia della coda è lecita.
    await barra.getByRole("button", { name: /Chiudi/ }).click();
    await expect(page).toHaveURL(/bulk=close/, { timeout: 15_000 });
    const { rows } = await dbExec(
      "select count(*)::int as n from conversations where source_page = $1 and initial_query like 'bulk claim%' and status = 'closed'",
      [MARK],
    );
    expect(rows[0].n).toBe(2);
  });

  test("bulk senza selezione: la barra non esiste e nessun id parte", async ({ page }) => {
    await login(page);
    // Il test porta il SUO ticket: le coda dei precedenti è stata svuotata
    // dalle azioni bulk stesse (il toggle «tutti» appare solo con righe).
    await seedTicket({ query: "bulk zero selezione", status: "operator", lastSender: "visitor" });
    await page.goto("/admin/tickets");
    // Zero selezioni → nessuna barra fissa in pagina.
    await expect(page.locator("div.fixed.inset-x-2")).toHaveCount(0);
    // Il toggle «tutti» c'è (la coda ha almeno il nostro ticket).
    await expect(page.getByLabel("Seleziona tutta la coda per azioni multiple")).toBeVisible();
    // Seleziono e deseleziono: la barra sparisce di nuovo.
    await page.getByLabel("Seleziona tutta la coda per azioni multiple").check();
    await expect(page.locator("div.fixed.inset-x-2")).toBeVisible();
    await page.getByLabel("Seleziona tutta la coda per azioni multiple").uncheck();
    await expect(page.locator("div.fixed.inset-x-2")).toHaveCount(0);
  });
});
