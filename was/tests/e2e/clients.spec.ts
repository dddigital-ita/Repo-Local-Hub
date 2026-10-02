import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * E2E della SCHEDA CLIENTE (/admin/clients/[id]) e della lista portafoglio.
 * Le asserzioni chiave (le stesse corrette a mano e da non più rompere):
 *  - RIGHE TICKET CONDIVISE: la scheda cliente usa la STESSA riga della
 *    inbox (TicketQueueRow): titolo-link al ticket, pill canale, contatore
 *    messaggi e azioni di triage fuori dal link (nessun interattivo
 *    annidato). Se la inbox cambia semantica, la scheda la segue — ed è
 *    proprio questo il punto del riuso;
 *  - WHATSAPP CONTESTUALE: il ticket che porta il WhatsApp del lead mostra
 *    il bottone emerald «WhatsApp per il ticket #N» con wa.me precompilato;
 *    il ticket senza WhatsApp no (il canale web non lo porta);
 *  - PERCORSO REALE: dalla lista /admin/clients si arriva alla scheda col
 *    conteggio ticket vero («Ticket (2)»);
 *  - FILTRI DELLA LISTA: «solo con ticket aperti» esclude la scheda col
 *    solo ticket chiuso; «budget: più alto prima» ribalta l'ordine del
 *    default (che è last_seen): due schede con budget diversi e ordini
 *    opposti provano il reorder, non un ordine casuale;
 *  - NOTA PERSISTENTE: il form «Salva nota» della scheda scrive nel DB
 *    (non solo nella UI) e lascia l'audit col suo attore;
 *  - SYNC AMBROSIO: un ticket MAI visto dal roster diventa scheda col
 *    click su «Sincronizza ora» (notice, scheda in lista, roster scritto,
 *    audit), e il secondo giro dice «già aggiornato» — il claim è il lock.
 *
 * Il seed scrive SOLO su was_e2e (DB disposable): due lead (whatsapp con
 * wa_phone e budget, web senza), una conversazione ciascuno, la scheda
 * cliente con il roster client_conversations; più una seconda scheda con
 * ticket chiuso (filtri) e una conversazione NON rosterata (il sync).
 * Tutto marcato source_page='/e2e-clients' e rimosso in afterAll
 * (rerun-safe, come la convenzione di tickets-inbox.spec: nessuna traccia
 * dopo di sé — la scheda nata dal sync si smonta per telefono).
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

const ADMIN = { email: "clients@e2e.local", password: "ClientiSicuri!1" };
/** Marca di tutti i seed di prova: la pulizia li aggancia a questo. */
const MARK = "/e2e-clients";
/** Identità fissa del cliente di prova: il telefono è la chiave di dedup. */
const CLIENT = { name: "Cliente E2E Salento", phone: "+393339990001", email: "cliente.e2e@e2e.local" };
/** Marca testuale dei due ticket (distintive per i locator «card che contiene…»). */
const QUERY_WEB = "rossopv e2e";
const QUERY_WA = "whatsappv e2e";
/** Seconda scheda per i filtri: budget alto, ticket chiuso, vista prima. */
const RICCO = { name: "Ricco E2E Salento", phone: "+393339990003", email: "ricco.e2e@e2e.local" };
const QUERY_CLOSED = "chiusopv e2e";
/** Identità del ticket per il sync: nome+telefono bastano ad Ambrosio. */
const SYNC_LEAD = { name: "Nuovo E2E Sync", phone: "+393339990004" };
const QUERY_SYNC = "syncambrosio e2e";

let clientId = "";
let numberWeb = 0;
let numberWa = 0;

test.describe.configure({ mode: "serial" });

/** La pulizia condivisa: idempotente, chiamata anche prima del seed. */
async function cleanup() {
  // client_conversations cascade con clients e conversations: le schede
  // seminate escono per telefono/email; quella nata dal sync non porta
  // email (il lead del sync ne è privo) — esce per telefono.
  await dbExec("delete from clients where email_norm = $1 or phone_e164 = $2 or phone_e164 = $3 or phone_e164 = $4", [
    CLIENT.email,
    CLIENT.phone,
    RICCO.phone,
    SYNC_LEAD.phone,
  ]);
  await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
  await dbExec("delete from conversations where source_page = $1", [MARK]);
  await dbExec("delete from leads where source_page = $1", [MARK]);
  await dbExec("delete from admin_users where email like '%@e2e.local'");
}

test.afterAll(cleanup);

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

test.describe("scheda cliente", () => {
  test("setup: seed admin + lead con WhatsApp + due ticket + scheda cliente", async () => {
    // Prima i residui (anche l'admin di run passate: la cleanup toglie tutti
    // gli %@e2e.local), POI il seed — l'ordine inverso cancellerebbe le
    // credenziali appena create (login «Credenziali non valide»). 
    await cleanup();
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Clienti E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );

    // DUE lead, una sola scheda (il roster manuale replica il merge di
    // Ambrosio): il lead WhatsApp porta wa_phone (migration 021) — è la
    // fonte del bottone contestuale per ticket — quello del canale web no:
    // stessa persona, canale che non ha mai portato WhatsApp.
    const leadWa = await dbExec(
      `insert into leads (name, phone, consent, status, temperature, source_page, initial_query, wa_phone, budget, created_at)
       values ($1, $2, true, 'nuovo', 'tiepido', $3, $4, $2, $5, now() - interval '4 hours')
       returning id`,
      ["Rosso E2E", CLIENT.phone, MARK, QUERY_WA, "9000-10000 euro"],
    );
    const leadWeb = await dbExec(
      `insert into leads (name, phone, consent, status, temperature, source_page, initial_query, created_at)
       values ($1, '+393339990002', true, 'nuovo', 'tiepido', $2, $3, now() - interval '4 hours')
       returning id`,
      ["Rosso E2E web", MARK, QUERY_WEB],
    );

    // La scheda cliente una sola, poi il roster dei due ticket.
    const cl = await dbExec(
      `insert into clients (name, phone_e164, email_norm, contact_email)
       values ($1, $2, $3, $3) returning id`,
      [CLIENT.name, CLIENT.phone, CLIENT.email],
    );
    clientId = cl.rows[0].id as string;

    // Last message del VISITOR → entrambe «da rispondere».
    for (const [query, channel, leadId] of [
      [QUERY_WEB, "web", leadWeb.rows[0].id as string],
      [QUERY_WA, "whatsapp", leadWa.rows[0].id as string],
    ] as const) {
      const conv = await dbExec(
        `insert into conversations (initial_query, source_page, status, channel, lead_id, created_at, updated_at)
         values ($1, $2, 'operator', $3, $4, now() - interval '3 hours', now() - interval '2 hours')
         returning id, number`,
        [query, MARK, channel, leadId],
      );
      const convId = conv.rows[0].id as string;
      if (channel === "web") numberWeb = conv.rows[0].number as number;
      else numberWa = conv.rows[0].number as number;
      await dbExec("insert into messages (conversation_id, sender, body) values ($1, 'visitor', $2)", [
        convId,
        `messaggio cliente di prova (${channel})`,
      ]);
      await dbExec("insert into client_conversations (conversation_id, client_id) values ($1, $2)", [convId, clientId]);
    }

    // SECONDA SCHEDA per i filtri della lista: budget più alto (50.000 >
    // il ~10.000 della prima) MA ticket chiuso (non conta in «solo aperti»)
    // e last_seen più vecchio — default e ordinamento per budget danno
    // ordini OPPOSTI: la prova del reorder è vera, non casuale.
    const leadRicco = await dbExec(
      `insert into leads (name, phone, consent, status, temperature, source_page, initial_query, budget, created_at)
       values ($1, $2, true, 'nuovo', 'tiepido', $3, $4, '50000 euro', now() - interval '2 days')
       returning id`,
      ["Ricco E2E", RICCO.phone, MARK, QUERY_CLOSED],
    );
    const convRicco = await dbExec(
      `insert into conversations (initial_query, source_page, status, channel, lead_id, created_at, updated_at)
       values ($1, $2, 'closed', 'web', $3, now() - interval '2 days', now() - interval '1 day')
       returning id`,
      [QUERY_CLOSED, MARK, leadRicco.rows[0].id],
    );
    await dbExec("insert into messages (conversation_id, sender, body) values ($1, 'visitor', $2)", [
      convRicco.rows[0].id,
      "messaggio cliente di prova (chiuso)",
    ]);
    const clRicco = await dbExec(
      `insert into clients (name, phone_e164, email_norm, contact_email, last_seen_at)
       values ($1, $2, $3, $3, now() - interval '1 day') returning id`,
      [RICCO.name, RICCO.phone, RICCO.email],
    );
    await dbExec("insert into client_conversations (conversation_id, client_id) values ($1, $2)", [
      convRicco.rows[0].id,
      clRicco.rows[0].id,
    ]);

    // IL TICKET PER IL SYNC: mai visto dal roster (nessuna riga in
    // client_conversations). Il lead porta nome+telefono: identità
    // sufficiente perché Ambrosio componga la scheda; senza email il dedup
    // resta sul telefono (che è la chiave unica della scheda).
    const leadSync = await dbExec(
      `insert into leads (name, phone, consent, status, temperature, source_page, initial_query, created_at)
       values ($1, $2, true, 'nuovo', 'tiepido', $3, $4, now() - interval '1 hour')
       returning id`,
      [SYNC_LEAD.name, SYNC_LEAD.phone, MARK, QUERY_SYNC],
    );
    const convSync = await dbExec(
      `insert into conversations (initial_query, source_page, status, channel, lead_id, created_at, updated_at)
       values ($1, $2, 'operator', 'web', $3, now() - interval '1 hour', now() - interval '30 minutes')
       returning id`,
      [QUERY_SYNC, MARK, leadSync.rows[0].id],
    );
    await dbExec("insert into messages (conversation_id, sender, body) values ($1, 'visitor', $2)", [
      convSync.rows[0].id,
      "messaggio cliente di prova (sync)",
    ]);

    expect(clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(numberWeb).toBeGreaterThan(0);
    expect(numberWa).toBeGreaterThan(0);
  });

  test("dalla lista portafoglio si apre la scheda col conteggio ticket vero", async ({ page }) => {
    await login(page);
    await page.goto("/admin/clients");

    // La lista mostra la scheda (nome = identità ricostruita dai ticket):
    // click sul LINK della riga, non su un contenitore generico.
    const row = page.locator('a[href^="/admin/clients/"]').filter({ hasText: CLIENT.name }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/admin/clients/${clientId}$`));

    // Il conteggio nell'heading viene dal DB (due ticket seedati), non è testo fisso.
    await expect(page.getByRole("heading", { name: /Ticket \(2\)/ })).toBeVisible();
    // L'empty-state non deve comparire quando i ticket ci sono.
    await expect(page.getByText(/Nessun ticket collegato/i)).toHaveCount(0);
  });

  test("le righe ticket usano TicketQueueRow: titolo-link, azioni fuori dal link, canale giusto", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/clients/${clientId}`);

    // La CARD è .group/ticket, la stessa della inbox: il riuso della riga
    // si verifica per comportamento, non per import.
    const cardWeb = page.locator(".group\\/ticket").filter({ hasText: QUERY_WEB });
    const cardWa = page.locator(".group\\/ticket").filter({ hasText: QUERY_WA });
    await expect(cardWeb).toBeVisible();
    await expect(cardWa).toBeVisible();

    // GESTO PRIMARIO: il titolo è il link alla pagina completa del ticket,
    // identico alla inbox (stesso href pattern, stesso gesto).
    for (const [card, query] of [
      [cardWeb, QUERY_WEB],
      [cardWa, QUERY_WA],
    ] as const) {
      const titleLink = card.getByRole("link", { name: new RegExp(query, "i") });
      await expect(titleLink).toBeVisible();
      await expect(titleLink).toHaveAttribute("href", /\/admin\/tickets\/[0-9a-f-]{36}$/);
      // Nessun interattivo annidato: le azioni di triage vivono fuori dal link.
      expect(await titleLink.locator("button").count()).toBe(0);
    }

    // Le pill canale della riga shared distinguono i due ticket: la riga
    // meta (canale · contatto · msg · data) porta il canale giusto. Nella
    // card WA il testo «WhatsApp» matcherebbe anche il bottone contestuale:
    // l'etichetta si verifica sulla meta, non col testo generico.
    await expect(cardWeb.locator("p.mt-0\\.5")).toContainText("Chat web");
    await expect(cardWa.locator("p.mt-0\\.5")).toContainText("WhatsApp");

    // Il contatore messaggi è quello del DB (un messaggio per conversazione).
    await expect(cardWeb.locator("p.mt-0\\.5")).toContainText("1 msg");
    await expect(cardWa.locator("p.mt-0\\.5")).toContainText("1 msg");

    // L'età relativa (Fase 2 del redesign) arriva sulla riga CONDIVISA:
    // anche la scheda cliente la porta senza cambiamenti propri — è il
    // punto del riuso, e non serve duplicare l'asserzione nel dettaglio.
    await expect(cardWeb.locator("span[title^='Ultimo aggiornamento']")).toHaveText(/^\d+(m|h|gg|sett)$/);
  });

  test("il bottone WhatsApp contestuale compare solo sul ticket che porta il numero", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/clients/${clientId}`);

    // Sul ticket whatsapp: wa.me precompilato che cita il NUMERO del ticket.
    const waButton = page
      .locator(".group\\/ticket")
      .filter({ hasText: QUERY_WA })
      .getByRole("link", { name: new RegExp(`WhatsApp per il ticket #${numberWa}`, "i") });
    await expect(waButton).toBeVisible();
    await expect(waButton).toHaveAttribute("href", new RegExp(`^https://wa\\.me/393339990001\\?text=`));

    // Sul ticket web (il SUO lead non ha wa_phone): NESSUN bottone — la
    // riga resta identica a quella della inbox quando whatsappLink manca.
    const webCard = page.locator(".group\\/ticket").filter({ hasText: QUERY_WEB });
    await expect(webCard.getByRole("link", { name: /WhatsApp per il ticket/i })).toHaveCount(0);
  });

  /** Posizione di una scheda nella lista (indice del link-nome). */
  async function orderOf(page: Page, name: string): Promise<number> {
    return page.locator('a[href^="/admin/clients/"]').evaluateAll(
      (els, n) => els.findIndex((e) => e.textContent?.includes(n as string)),
      name,
    );
  }

  test("filtri della lista: «solo aperti» esclude il chiuso, il budget ribalta l'ordine", async ({ page }) => {
    await login(page);
    await page.goto("/admin/clients");

    // ORDINE DEFAULT (last_seen): la scheda vista adesso precede Ricco,
    // visto ieri — il seed le mette deliberatamente in ordine opposto al
    // budget, perché il reorder sia una prova e non una coincidenza.
    expect(await orderOf(page, CLIENT.name)).toBeLessThan(await orderOf(page, RICCO.name));

    // «Solo con ticket aperti»: la pill è pressed e Ricco (solo ticket
    // chiuso) esce — il cribbio del portafoglio conta i vivi, non la storia.
    await page.goto("/admin/clients?aperti=1");
    await expect(page.getByRole("link", { name: /solo con ticket aperti/i })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('a[href^="/admin/clients/"]').filter({ hasText: CLIENT.name })).toBeVisible();
    await expect(page.locator('a[href^="/admin/clients/"]').filter({ hasText: RICCO.name })).toHaveCount(0);
    // Il conteggio risultati è della pagina (visibile solo con filtro attivo).
    await expect(page.getByText(/\d+ risultat/)).toBeVisible();

    // «Budget: più alto prima»: 50.000 € di Ricco passano davanti ai
    // ~10.000 € dell'altra — l'ordine default si RIBALTA.
    await page.goto("/admin/clients?ordina=budget");
    await expect(page.getByRole("link", { name: /budget: più alto prima/i })).toHaveAttribute("aria-pressed", "true");
    expect(await orderOf(page, RICCO.name)).toBeLessThan(await orderOf(page, CLIENT.name));
    // La cifra derivata (withBudgetTotal: «fino a 50.000») è visibile in colonna.
    await expect(page.getByText(/50\.000 € dichiarati/)).toBeVisible();
  });

  test("la nota della scheda si salva nel DB e lascia l'audit col suo attore", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/clients/${clientId}`);

    // Il form è reale (server action): submit del browser, non magia client.
    const nota = "Preferisce i contatti pomeridiani — nota e2e";
    await page.getByPlaceholder("Storico, preferenze, accordi…").fill(nota);
    await page.getByRole("button", { name: /salva nota/i }).click();

    // La verità sta nel DB: la UI potrebbe mentire (stato ottimistico), la
    // riga no — ed è la stessa che il prossimo accesso rilegge.
    const { rows } = await dbExec("select notes from clients where id = $1", [clientId]);
    expect(rows[0]?.notes).toBe(nota);

    // L'audit porta l'ATTORE (l'admin che ha salvato, non Ambrosio) e il target.
    const audit = await dbExec(
      "select actor from audit_log where action = 'client.nota' and target = $1 order by created_at desc limit 1",
      [clientId],
    );
    expect(audit.rows[0]?.actor).toBe(ADMIN.email);
  });

  test("il sync di Ambrosio crea la scheda dal ticket mai visto (e il secondo giro è no-op)", async ({ page }) => {
    await login(page);
    await page.goto("/admin/clients");

    // Prima del sync la scheda NON esiste: il ticket non è mai stato visto.
    await expect(page.locator('a[href^="/admin/clients/"]').filter({ hasText: SYNC_LEAD.name })).toHaveCount(0);

    // IL GESTO REALE: il bottone della pagina (stesso percorso del cron,
    // blocco 9) — la server action processa i non-rosterati e ridirige
    // con la notice.
    await page.getByRole("button", { name: /sincronizza ora/i }).click();
    await expect(page.getByText(/ticket riconciliat/)).toBeVisible();

    // La scheda nasce in lista (nome dal lead) e in DB (telefono = chiave).
    await expect(page.locator('a[href^="/admin/clients/"]').filter({ hasText: SYNC_LEAD.name })).toBeVisible();
    const cl = await dbExec("select id from clients where phone_e164 = $1", [SYNC_LEAD.phone]);
    expect(cl.rows).toHaveLength(1);

    // Il roster ora contiene il ticket (il claim è il lock: il secondo giro
    // non lo riprende) e l'audit registra il sync col suo attore.
    const roster = await dbExec(
      `select cc.client_id from client_conversations cc
       join conversations c on c.id = cc.conversation_id
       where c.initial_query = $1`,
      [QUERY_SYNC],
    );
    expect(roster.rows[0]?.client_id).toBe(cl.rows[0].id);
    const audit = await dbExec(
      "select actor from audit_log where action = 'client.sync' and actor = $1 order by created_at desc limit 1",
      [ADMIN.email],
    );
    // audit_log è append-only (mai pulito): basta l'ESISTENZA dell'ultimo
    // sync col suo attore — il conteggio romperebbe i rerun.
    expect(audit.rows[0]?.actor).toBe(ADMIN.email);

    // SECONDO GIRO: «già aggiornato» — idempotente, nessun doppione.
    await page.getByRole("button", { name: /sincronizza ora/i }).click();
    await expect(page.getByText(/Portafoglio già aggiornato/)).toBeVisible();
    const again = await dbExec("select count(*)::int as n from clients where phone_e164 = $1", [SYNC_LEAD.phone]);
    expect(again.rows[0].n).toBe(1);
  });
});
