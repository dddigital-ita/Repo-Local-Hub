import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * E2E della DASHBOARD TICKET (/admin/tickets/dashboard): la lettura
 * aggregata separata dal triage (docs/dashboard-ticket-brief.md).
 * Le asserzioni chiave (quelle verificate a mano e da non più rompere):
 *  - KPI RILETTI DAL DB: i 5 numeri non sono hardcoded — li ricalcola il
 *    test con LE STELLE definizioni della pagina (aperti = non chiusi e
 *    non archiviati; da rispondere = ultima parola del cliente, bot
 *    escluso; media 1ª risposta su first_response_at - created_at;
 *    risolti su closed_at 7gg; violazioni = risposta > 2h o mai risposto
 *    da > 2h con umano coinvolto). Il DB E2E è CONDIVISO: i conteggi
 *    assoluti hardcodati sarebbero bug, i seed marcati /e2e-dash spostano
 *    i numeri e il test deve seguirli.
 *  - BARRE DEL VOLUME: la griglia dei giorni è CONTINUA (30 colonne per
 *    30gg, anche a 0 — il vuoto nel tempo è un dato) e le barre esistono
 *    solo nei giorni con ticket; il canale selezionato filtra le serie.
 *  - FILTRI VIA URL: days/channel vivono nella query string (condivisibile),
 *    l'etichetta della card segue il periodo scelto, la notice dichiara che
 *    il canale NON filtra i KPI (gli SLA sono doveri del team).
 *  - CAVEAT E USCITA: il footer dice onestamente cosa non sa misurare
 *    (breach storici su soglia 2h, riaperture non tracciate) e l'azione
 *    finale porta alla coda «Da rispondere» pre-filtrata.
 *  - CONFRONTI «VS PERIODO PRECEDENTE»: sotto ogni grafico una riga di
 *    delta calcolata sulla finestra shiftata (nessun numero hardcoded: il
 *    totale attuale e il prev sono riletti dal DB condiviso); con prev=0
 *    il badge dichiara «nessun dato nel periodo prec.» invece di un delta
 *    dal nulla.
 *  - TENDENZA PER OPERATORE: attività attribuita a CHI l'ha fatta
 *    (messages.author per le risposte, closed_by per le chiusure); le righe
 *    esistono anche a 0 nella finestra se il precedente aveva attività (pausa
 *    ≠ estinzione) e il ghost della barra precedente rende la tendenza
 *    leggibile sullo stesso righello.
 *
 * Il seed (admin temporaneo + 7 conversazioni marcate source_page='/e2e-d2',
 * 2 operatori di prova, tempi scaglionati per rendere deterministica la media)
 * si auto-pulisce in afterAll: nessuna traccia per gli spec che girano dopo
 * (convenzione di tickets-inbox.spec).
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

const ADMIN = { email: "dash@e2e.local", password: "DashSicura!1" };
const MARK = "/e2e-d2";

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

const kpiSection = (page: Page) => page.locator('section[aria-label="Indicatori chiave"]');
/** La i-esima card KPI per aria-label (le card portano la label minuscola in CSS). */
const kpiCard = (page: Page, name: string) => kpiSection(page).locator("div", { has: page.locator(`xpath=.//p[normalize-space()="${name}"]`) }).first();
const valoreKpi = (page: Page, name: string) => kpiCard(page, name).locator("p.text-2xl");

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
  await dbExec("delete from conversations where source_page = $1", [MARK]);
  // Gli operatori di prova dopo le conversazioni: closed_by ha FK su operators.
  await dbExec("delete from operators where id in ('e2e-davide', 'e2e-sara')");
  await dbExec("delete from admin_users where email = $1", [ADMIN.email]);
});

test.describe("dashboard ticket", () => {
  test("setup: seed admin + 7 conversazioni marcate con tempi deterministici", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Dash E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
    await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
    await dbExec("delete from conversations where source_page = $1", [MARK]);

    // Le chiusure sono attribuite a OPERATORI veri (closed_by ha FK su
    // operators.id), le risposte a messages.author (displayName): nella lib
    // le due chiavi si incontrano sul first_name dell'operatore. Nomi con
    // suffisso E2E per non collidere con l'eventuale team del DB condiviso.
    for (const [id, nome] of [["e2e-davide", "Davide E2E"], ["e2e-sara", "Sara E2E"]] as const) {
      await dbExec(
        `insert into operators (id, first_name, phone, shift_start, shift_end, active)
         values ($1, $2, '+390000000000', 9, 18, true)
         on conflict (id) do update set first_name = excluded.first_name, active = true`,
        [id, nome],
      );
    }
    //  G) 40gg fa, web, chiuso da Davide, risposta in 60min → FUORI da ogni
    //     finestra corrente MA dentro il periodo PRECEDENTE: dà alla tendenza
    //     (prev_risposte=1 → ghost del righello) e ai badge «vs periodo prec.»
    //     un precedente vero da confrontare, senza toccare i KPI correnti.
    const casi: [number, string, string, number | null, string | null][] = [
      [30, "web", "operator", 30, "Davide E2E"],
      [100, "web", "operator", 90, "Sara E2E"],
      [200, "web", "operator", 150, "Davide E2E"],
      [3 * 1440, "email", "operator", null, null],
      [2 * 1440, "web", "closed", 45, "Davide E2E"],
      [5 * 1440, "whatsapp", "closed", 20, "Sara E2E"],
      [40 * 1440, "web", "closed", 60, "Davide E2E"],
    ];
    for (const [min, ch, st, resp, autore] of casi) {
      const fr = resp != null ? `now() - interval '${min - resp} minutes'` : "null";
      const closed = st === "closed" ? `now() - interval '${Math.max(1, min - 60)} minutes'` : "null";
      // closed_by vuole l'ID dell'operatore (FK su operators.id), non il nome.
      const opId = autore === "Davide E2E" ? "e2e-davide" : "e2e-sara";
      const closedBy = st === "closed" && autore ? `'${opId}'` : "null";
      const q = await dbExec(
        `insert into conversations (initial_query, source_page, status, channel, created_at, updated_at, first_response_at, closed_at, closed_by)
         values ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval, now() - interval '10 minutes', ${fr}, ${closed}, ${closedBy})
         returning id`,
        [`dash d2 ${ch} ${st}`, MARK, st, ch, String(min)],
      );
      // L'ultimo messaggio decide «da rispondere»: i tre aperti restano sul cliente,
      // i chiusi sull'operatore (chiusi non contano comunque per la coda).
      const sender = st === "closed" ? "operator" : "visitor";
      await dbExec(
        `insert into messages (conversation_id, sender, body, author, created_at)
         values ($1, $2, 'msg d2', ${sender === "operator" && autore ? `'${autore}'` : "null"}, now() - ($3 || ' minutes')::interval)`,
        [q.rows[0].id, sender, String(Math.max(1, min - 5))],
      );
      // Il messaggio operatore attribuito È la risposta (per la tendenza):
      // per i casi con risposta è l'UNICO messaggio operatore, quindi anche
      // first_response_at = questo istante (coerenza con l'attribuzione).
      if (resp != null && autore) {
        await dbExec(
          `insert into messages (conversation_id, sender, body, author, created_at)
           values ($1, 'operator', 'risposta d2', $2, now() - ($3 || ' minutes')::interval)`,
          [q.rows[0].id, autore, String(min - resp)],
        );
      }
    }
    const n = await dbExec("select count(*)::int as n from conversations where source_page = $1", [MARK]);
    expect(n.rows[0].n).toBe(7);
  });

  test("i 5 KPI corrispondono alle definizioni SQL della pagina (lette dal DB condiviso)", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets/dashboard");

    // Le stesse query della pagina (finestra 30gg, stessa semantica): rileggerle
    // qui rende il test vero su QUALSIASI contenuto del DB condiviso.
    const { rows } = await dbExec(
      `select
         (select count(*) from conversations c where c.archived_at is null and c.status not in ('closed','on_hold'))::int as aperti,
         (select count(*) from conversations c where c.archived_at is null and c.status not in ('closed','on_hold','bot')
            and (select m2.sender from messages m2 where m2.conversation_id = c.id order by m2.created_at desc limit 1) = 'visitor')::int as da_rispondere,
         (select max(extract(epoch from (now() - c.created_at)))/3600.0 from conversations c
            where c.archived_at is null and c.status not in ('closed','on_hold','bot')
            and (select m2.sender from messages m2 where m2.conversation_id = c.id order by m2.created_at desc limit 1) = 'visitor')::float as oldest_h,
         round((select avg(extract(epoch from (c.first_response_at - c.created_at)))/60.0 from conversations c
            where c.first_response_at is not null and c.status not in ('bot','callback_scheduled')
            and c.created_at >= now() - interval '30 days'))::int as resp_avg,
         (select count(*) from conversations c where c.status = 'closed' and c.closed_at >= now() - interval '7 days')::int as risolti7,
         (select count(*) from conversations c where c.status not in ('bot','callback_scheduled') and c.created_at >= now() - interval '30 days'
            and ((c.first_response_at is not null and extract(epoch from (c.first_response_at - c.created_at)) > 7200)
                 or (c.first_response_at is null and c.created_at < now() - interval '2 hours')))::int as violazioni`,
    );
    const k = rows[0];

    await expect(valoreKpi(page, "Aperti")).toHaveText(String(k.aperti));
    await expect(valoreKpi(page, "Da rispondere")).toHaveText(String(k.da_rispondere));
    await expect(valoreKpi(page, "Risolti (7gg)")).toHaveText(String(k.risolti7));
    await expect(valoreKpi(page, "Violazioni SLA (30gg)")).toHaveText(String(k.violazioni));
    // Media 1ª risposta: formato italiano «1,4 h» — confronto numerico con tolleranza d'arrotondamento.
    const media = await valoreKpi(page, "Media 1ª risposta (30gg)").textContent();
    const letto = Number.parseFloat((media ?? "").replace(",", ".")) || -1;
    const atteso = k.resp_avg / 60;
    expect(Math.abs(letto - atteso)).toBeLessThan(0.1);
    // Sub della card «Da rispondere»: l'età del più vecchio (formattata giorni/ore).
    const sub = await kpiCard(page, "Da rispondere").textContent();
    expect(sub ?? "").toContain("il più vecchio aspetta da");
    expect(sub ?? "").toContain(k.oldest_h >= 48 ? "giorni" : "h");
    // Il riquadro di pericolo: violazioni > 0 → valore in rosso (ring di allerta).
    if (k.violazioni > 0) {
      await expect(valoreKpi(page, "Violazioni SLA (30gg)")).toHaveClass(/text-red-700/);
    }
  });

  test("volume per giorno: griglia continua e barre solo dove ci sono ticket", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets/dashboard?days=30");

    const { rows } = await dbExec(
      `select to_char(date_trunc('day', c.created_at), 'YYYY-MM-DD') as g, count(*)::int as n
       from conversations c
       where c.created_at >= now() - interval '30 days' and c.channel = any(array['web','email','whatsapp'])
       group by 1 order by 1`,
    );
    const perGiorno = new Map(rows.map((r) => [r.g, Number(r.n)]));
    const giorniConTicket = perGiorno.size;

    // 30 colonne SEMPRE (griglia continua): i giorni a 0 non spariscono.
    // (il title ISO «2026-…» distingue le colonne del volume; l'altezza 160px
    // sta sul contenitore, NON sulle colonne — per questo niente selettori
    // per stile, che qui non esiste)
    const colonne = page.locator('div[title^="20"]');
    await expect(colonne).toHaveCount(30);
    // Le barre esistono solo nei giorni con ticket (un giorno a 0 non ha figli).
    const conBarre = await colonne.evaluateAll((els) =>
      els.filter((el) => el.querySelector("div[class*='rounded-[3px]']")).length,
    );
    expect(conBarre).toBe(giorniConTicket);
    // Il giorno più ricco è il più alto: maxGiorno = max del DB.
    const maxN = Math.max(...perGiorno.values());
    // La barra più alta è ~la cella intera (160px): con maxN>0 deve essere
    // la più grande. Le barre crescono con la transition CSS (300ms): una
    // singola misura può coglierle a 0px mentre partono (corsa reale
    // 01/10, DB intatto e nessuna contesa: era la misurazione, non i dati).
    // toPass rimisura finché l'animazione è finita.
    await expect(async () => {
      const maxH = await colonne.evaluateAll((els) =>
        Math.max(0, ...els.flatMap((el) =>
          [...el.querySelectorAll("div[class*='rounded-[3px]']")].map((b) => b.getBoundingClientRect().height),
        )),
      );
      if (maxN > 0) expect(maxH).toBeGreaterThan(100);
    }).toPass({ timeout: 5_000 });
  });

  test("filtro periodo via URL: etichette KPI e finestra del volume seguono ?days=", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets/dashboard?days=7");

    // La tab attiva è «7 giorni» e le card portano la finestra scelta.
    await expect(page.locator('nav[aria-label="Periodo"] a[href*="days=7"]')).toHaveAttribute("aria-current", "page");
    await expect(valoreKpi(page, "Violazioni SLA (7gg)")).toBeVisible();
    // Volume: 7 colonne (la griglia continua scala col periodo).
    await expect(page.locator('div[title^="20"]')).toHaveCount(7);
    // URL pulito di default: nessun link porta days=30 (il default non si scrive,
    // stesso principio della pagina 1 della paginazione — e la forma giusta
    // dell'assert è count(0): not.toHaveAttribute su zero elementi fallisce).
    await page.goto("/admin/tickets/dashboard");
    await expect(page.locator('nav[aria-label="Periodo"] a[href*="days=30"]')).toHaveCount(0);
    // Valore fuori elenco: ricade su 30 (nessun crash, comportamento sanificato).
    await page.goto("/admin/tickets/dashboard?days=45");
    await expect(page.locator('nav[aria-label="Periodo"] a[href*="days=7"]')).toBeVisible();
  });

  test("filtro canale via URL: le barre si riducono al canale, i KPI restano globali (e la notice lo dichiara)", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets/dashboard?days=30&channel=email");

    // La notice dice la regola: serie filtrate, KPI globali.
    await expect(page.getByText(/Serie filtrate sul canale «Email»/)).toBeVisible();
    // Le barre visibili sono TUTTE del colore email (ambra) — niente serie web.
    const barre = page.locator("div[class*='rounded-[3px]']");
    const colors = await barre.evaluateAll((els) => els.map((b) => b.className));
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.every((c) => c.includes("amber"))).toBe(true);
    // Le 5 card KPI esistono ancora (il filtro non le riscrive).
    for (const name of ["Aperti", "Da rispondere", "Risolti (7gg)", "Violazioni SLA (30gg)"]) {
      await expect(valoreKpi(page, name)).toBeVisible();
    }
    // Tab canali: i canali NOTI restano in elenco anche a 0 (regola della inbox).
    await expect(page.locator('nav[aria-label="Canali"] a', { hasText: "WhatsApp" })).toBeVisible();
  });

  test("caveat onesto in footer e uscita alla coda «Da rispondere»", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets/dashboard");

    // Il footer non nasconde i limiti: soglia 2h per i breach storici e
    // riaperture non tracciate (le due cose che la brief dice di non promettere).
    await expect(page.getByText(/soglia 2h/)).toBeVisible();
    await expect(page.getByText(/Le riaperture non sono tracciate/)).toBeVisible();

    // L'uscita trasforma la lettura in azione: link alla coda pre-filtrata.
    const uscita = page.getByRole("link", { name: /Vai alla coda «Da rispondere»/ });
    await expect(uscita).toHaveAttribute("href", "/admin/tickets?f=da_rispondere");
    await uscita.click();
    await expect(page).toHaveURL(/\/admin\/tickets\?f=da_rispondere/);
    // E la inbox mostra il link di scoperta (la stanza è raggiungibile in entrambi i sensi).
    await expect(page.getByRole("link", { name: /Dashboard SLA e volumi/ })).toBeVisible();
  });

  test("tendenza per operatore: attribuzione e confronti riletti dal DB", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tickets/dashboard?days=30");

    // Le stesse definizioni della lib, sul DB condiviso: risposte = messaggi
    // operatore per autore (displayName), chiusi = closed_by (FK su operators,
    // incontrato sul first_name) su closed_at.
    const { rows } = await dbExec(
      `select
         coalesce(r.author, k.closed_by) as author,
         coalesce(r.n, 0)::int as risposte,
         coalesce(r.prev_n, 0)::int as prev_risposte,
         coalesce(k.n, 0)::int as chiusi,
         coalesce(k.prev_n, 0)::int as prev_chiusi
       from
         (select m.author,
                 count(*) filter (where m.created_at >= now() - interval '30 days')::int as n,
                 count(*) filter (where m.created_at >= now() - interval '60 days' and m.created_at < now() - interval '30 days')::int as prev_n
            from messages m where m.sender = 'operator' and m.author is not null
           group by m.author) r
       full outer join
         (select o.first_name as closed_by,
                 count(*) filter (where c.closed_at >= now() - interval '30 days')::int as n,
                 count(*) filter (where c.closed_at >= now() - interval '60 days' and c.closed_at < now() - interval '30 days')::int as prev_n
            from conversations c join operators o on o.id = c.closed_by
           where c.closed_by is not null
           group by 1) k
         on k.closed_by = r.author`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const perAutore = new Map(rows.map((r) => [r.author, r]));

    // La sezione esiste ed elenca ESATTAMENTE gli autori del DB (attribuzione
    // = la riga non è una aggregazione impastata, ha il nome di chi ha fatto).
    const sezione = page.locator("div.glass-solid", { has: page.getByRole("heading", { name: /Tendenza per operatore/ }) });
    await expect(sezione).toBeVisible();
    const righe = sezione.locator('[data-testid="trend-row"]');
    const etichette = await righe.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-name") ?? ""),
    );
    // Ogni autore con attività (ora o prima) ha la sua riga; i casi del seed
    // garantiscono Davide (risposte+chiusi) e Sara (pausa: solo attività nel
    // periodo precedente → la riga deve ESISTERE comunque).
    for (const [autore, r] of perAutore) {
      if (r.risposte + r.chiusi + r.prev_risposte + r.prev_chiusi === 0) continue;
      const riga = etichette.find((t) => t === autore);
      expect(riga, `riga per ${autore}`).toBeTruthy();
    }

    // I numeri perDavide corrispondono al DB (confronti inclusi: «vs N»
    // del periodo precedente è nel testo della riga).
    const davide = perAutore.get("Davide E2E");
    if (davide) {
      const testoDavide = await righe
        .filter({ hasText: "Davide E2E" })
        .first()
        .textContent();
      expect(testoDavide ?? "").toContain(`${davide.risposte} risposte`);
      expect(testoDavide ?? "").toContain(`vs ${davide.prev_risposte} risposte`);
      expect(testoDavide ?? "").toContain(`${davide.chiusi} chiusi`);
      expect(testoDavide ?? "").toContain(`vs ${davide.prev_chiusi} chiusi`);
      // Il ghost del periodo precedente: la barra fantasma esiste solo se il
      // prev aveva risposte (il seed dà a Davide prev_risposte ≥ 1).
      if (davide.prev_risposte > 0) {
        const barra = righe.filter({ hasText: "Davide E2E" }).first().locator("div.relative");
        await expect(barra.locator("div.absolute")).toHaveCount(1);
      }
    }

    // Confronti sotto i grafici: riletti dal DB, non hardcodati. Volume
    // (tutti i canali) e bucket della finestra 30gg con i loro prev.
    const { rows: prev } = await dbExec(
      `select
         (select count(*) from conversations c where c.created_at >= now() - interval '60 days'
            and c.created_at < now() - interval '30 days' and c.channel = any(array['web','email','whatsapp']))::int as vol_prev,
         (select count(*) from conversations c where c.created_at >= now() - interval '30 days'
            and c.channel = any(array['web','email','whatsapp']))::int as vol_now`,
    );
    const cardVolume = page.locator("div.glass-solid", { has: page.getByRole("heading", { name: "Volume per giorno" }) });
    await expect(cardVolume.getByText(new RegExp(`vs ${prev[0].vol_prev} ticket del periodo prec`))).toBeVisible();
  });
});
