import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * E2E del TIPO CLIENTE (038) su /admin/clients — il filtro, l'export e il
 * segmento di qualità come flusso reale nel browser:
 *  - FILTRO ?tipo=: i chips mostrano i conteggi del DB e il clic lascia in
 *    lista SOLO le schede del tipo scelto («Da classificare» = client_type
 *    is null — NULL è «non ancora classificato», mai un tipo);
 *  - CSV SEGMENTATO: /api/admin/clients.csv esporta STESSI filtri della
 *    vista (intestazione, colonna Tipo col dizionario UI, nome file col
 *    segmento) — quello che vedi è quello che scarichi;
 *  - AZIENDE SENZA DITTA: il segmento di qualità conta le schede
 *    client_type='azienda' E company_name is null e il filtro porta in
 *    vista esattamente quelle — mai le aziende con ditta, mai i privati.
 *  - FILTRI LISTA: «con ticket aperti» (?aperti=1) guarda lo STATO dei
 *    ticket collegati (il chiuso non basta) e ?ordina=budget ordina sul
 *    budget DERIVATO dai lead (withBudgetTotal), non su una colonna.
 *  - NOTA IN SCHEDA: il form della scheda salva, si rilegge dopo la
 *    revalidate e lascia l'audit client.nota col target giusto.
 *  - SYNC REALE: il bottone «Sincronizza ora» (stesso motore del cron)
 *    trasforma un ticket email nuovo in scheda cliente (identità da
 *    contact_email + header email_ingest), collega il ticket e audita;
 *    il secondo giro non duplica (claim client_conversations).
 *
 * Seed SOLO su wac_e2e (DB disposable): clienti marcati
 * email_norm '%@e2e-clients.test', admin @e2e.local, tutto rimosso in
 * afterAll (rete di sicurezza: e2e-leak-guard.mjs).
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

const ADMIN = { email: "clients@e2e.local", password: "ClientsSicura!22" };
const EMAIL_SUFFIX = "@e2e-clients.test";

/** Un cliente di prova (marcato dall'email: mai toccare i veri). */
async function seedClient(opts: { name: string; tipo: string | null; company?: string | null }) {
  await dbExec(
    // Telefono a 8 cifre random (prima cifra 1-9: mai nello spazio dei
    // seed espliciti '+3902000…'): il vecchio spazio da 90 valori con i
    // seed aggiunti oggi collidesi a ogni run sull'unique clients_phone_key.
    `insert into clients (name, phone_e164, email_norm, company_name, client_type, last_seen_at)
     values ($1, '+3902' || lpad((floor(random()*90000000+10000000))::text, 8, '0'), $2, $3, $4, now())`,
    [opts.name, `${opts.name.toLowerCase().replace(/\s+/g, ".")}${EMAIL_SUFFIX}`, opts.company ?? null, opts.tipo],
  );
}

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

/** Le schede cliente visibili in lista (i nomi seedati, non altro). */
async function visibleCards(page: Page, names: string[]): Promise<string[]> {
  const presenti: string[] = [];
  for (const n of names) {
    if (await page.locator("a", { hasText: n }).first().isVisible().catch(() => false)) presenti.push(n);
  }
  return presenti;
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  // Ordine FK: messages → client_conversations → leads → conversations →
  // clients (client_meta cascade con il cliente).
  await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = '/e2e-clients')");
  await dbExec("delete from client_conversations where conversation_id in (select id from conversations where source_page = '/e2e-clients')");
  await dbExec("delete from leads where source_page = '/e2e-clients'");
  await dbExec("delete from conversations where source_page = '/e2e-clients'");
  await dbExec("delete from email_ingest where message_id like 'e2e-sync-%'");
  await dbExec("delete from clients where phone_e164 = '+39020000501'"); // il cliente WhatsApp non ha email: pulizia per telefono
  await dbExec("delete from clients where phone_e164 = '+39020000502'"); // idem il cliente del sync via cron
  await dbExec("delete from clients where email_norm = 'cite.sicurezza@e2e-clients.test'"); // il cliente del cited_email non ha né telefono né lead
  await dbExec("delete from clients where email_norm like $1", [`%${EMAIL_SUFFIX}`]);
  await dbExec("delete from admin_users where email = $1", [ADMIN.email]);
});

test.describe("tipo cliente: filtro, CSV segmentato, aziende senza ditta", () => {
  test("setup: seed admin + clienti marcati (un tipo per valore + due aziende)", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Clients E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
    // Rerun-safe: nessun residuo dei run precedenti.
    await dbExec(`delete from clients where email_norm like '%${EMAIL_SUFFIX}'`);

    await seedClient({ name: "Azienda Ditta E2E", tipo: "azienda", company: "Ditta E2E SRL" });
    await seedClient({ name: "Azienda Nuda E2E", tipo: "azienda", company: null });
    await seedClient({ name: "Privato E2E", tipo: "privato" });
    await seedClient({ name: "Ente E2E", tipo: "ente_pubblico", company: "Comune E2E" });
    await seedClient({ name: "Senza Tipo E2E", tipo: null });
  });

  test("i chip contano dal DB e il filtro ?tipo= lascia solo il tipo scelto", async ({ page }) => {
    await login(page);
    await page.goto("/admin/clients");

    // Il conteggio del chip lo dice il DB, non la pagina: fonte unica. I
    // chip contano TUTTA la tabella clients (non solo i seed marcati).
    const { rows } = await dbExec(
      "select client_type, count(*)::int as n from clients group by client_type",
    );
    const perTipo = Object.fromEntries(rows.map((r) => [r.client_type ?? "nessuno", r.n]));

    for (const [tipo, n] of Object.entries(perTipo)) {
      const chipLabel = tipo === "nessuno" ? "Da classificare" : tipo === "ente_pubblico" ? "Ente pubblico" : tipo === "azienda" ? "Azienda" : "Privato";
      await expect(page.getByRole("link", { name: new RegExp(`^${chipLabel}\\s+${n}$`) })).toBeVisible();
    }

    // Filtro azienda: SOLO le due aziende (con e senza ditta).
    await page.goto("/admin/clients?tipo=azienda");
    const viste = await visibleCards(page, ["Azienda Ditta E2E", "Azienda Nuda E2E", "Privato E2E", "Ente E2E", "Senza Tipo E2E"]);
    expect(viste).toEqual(expect.arrayContaining(["Azienda Ditta E2E", "Azienda Nuda E2E"]));
    expect(viste).not.toContain("Privato E2E");
    expect(viste).not.toContain("Ente E2E");
    expect(viste).not.toContain("Senza Tipo E2E");

    // Filtro «Da classificare»: solo le schede ancora NULL.
    await page.goto("/admin/clients?tipo=nessuno");
    const classify = await visibleCards(page, ["Azienda Ditta E2E", "Azienda Nuda E2E", "Privato E2E", "Ente E2E", "Senza Tipo E2E"]);
    expect(classify).toEqual(["Senza Tipo E2E"]);
  });

  test("la classificazione in scheda arriva nel DB e muove il cliente tra i filtri", async ({ page }) => {
    await login(page);
    await page.goto("/admin/clients?tipo=nessuno");
    await page.locator("a", { hasText: "Senza Tipo E2E" }).first().click();
    await expect(page).toHaveURL(/\/admin\/clients\/[0-9a-f-]+$/);

    // «Da classificare» preselezionato; classifico PRIVATO e salvo.
    await expect(page.locator("select[name='client_type']")).toHaveValue("");
    await page.locator("select[name='client_type']").selectOption("privato");
    await page.getByRole("button", { name: /salva tipo/i }).click();
    // L'attesa vera è il DB: né il bottone (sempre visibile) né la select
    // (che conserva la scelta utente anche a transizione interrotta) dicono
    // che l'action ha committato. Il polling del dato, sì.
    await expect.poll(async () => {
      const { rows } = await dbExec(
        `select client_type from clients where email_norm like '%${EMAIL_SUFFIX}' and name = 'Senza Tipo E2E'`,
      );
      return rows[0]?.client_type;
    }, { timeout: 15_000 }).toBe("privato");

    // Il filtro segue il dato: non è più tra «Da classificare»…
    await page.goto("/admin/clients?tipo=nessuno");
    expect(await visibleCards(page, ["Senza Tipo E2E"])).toEqual([]);
    // …ed è tra i privati.
    await page.goto("/admin/clients?tipo=privato");
    expect(await visibleCards(page, ["Senza Tipo E2E"])).toEqual(["Senza Tipo E2E"]);
  });

  test("CSV segmentato: stessi filtri della vista, colonna Tipo col dizionario UI", async ({ page }) => {
    await login(page);
    // Il test porta il SUO cliente non classificato: il test 3 (serial) ha
    // già classificato «Senza Tipo E2E» — l'etichetta «Da classificare» va
    // provata su una riga che nessun altro test tocca.
    await seedClient({ name: "Csv Null E2E", tipo: null });

    // 1) Senza filtri: il file si chiama «tutti» e porta TUTTI i marcati.
    const res1 = await page.request.get("/api/admin/clients.csv");
    expect(res1.status()).toBe(200);
    expect(res1.headers()["content-type"]).toContain("text/csv");
    const all = await res1.text();
    expect(all).toContain("Azienda Ditta E2E");
    expect(all).toContain("Privato E2E");
    // La colonna Tipo parla la lingua della UI («Azienda», non «azienda»).
    expect(all).toMatch(/Azienda Ditta E2E;Azienda;/);
    expect(all).toMatch(/Csv Null E2E;Da classificare;/);

    // 2) Con ?tipo=azienda: SOLO aziende, nel nome del file pure.
    const res2 = await page.request.get("/api/admin/clients.csv?tipo=azienda");
    const azi = await res2.text();
    expect(res2.headers()["content-disposition"]).toContain("tipo-azienda");
    expect(azi).toContain("Azienda Ditta E2E");
    expect(azi).toContain("Azienda Nuda E2E");
    expect(azi).not.toContain("Privato E2E");
    expect(azi).not.toContain("Csv Null E2E");

    // 3) ?tipo=nessuno → «Da classificare» nel segmento (era NULL nel DB).
    const res3 = await page.request.get("/api/admin/clients.csv?tipo=nessuno");
    expect(res3.headers()["content-disposition"]).toContain("da-classificare");
    const ness = await res3.text();
    expect(ness).toContain("Csv Null E2E");
    expect(ness).not.toContain("Azienda Ditta E2E");
  });

  test("CSV segmentato: ?aperti=1 e ?ordina=budget entrano nel nome e nelle righe", async ({ page }) => {
    await login(page);
    // Due clienti dedicati: uno con ticket APERTO con budget lead, uno con
    // solo un ticket CHIUSO (budget sì, aperti no) — il cross dei due
    // filtri è ciò che distingue i segmenti nel nome e nelle righe.
    await seedClient({ name: "Csv Aperti E2E", tipo: "privato" });
    await seedClient({ name: "Csv Chiuso E2E", tipo: "privato" });
    for (const [nome, stato, budget] of [
      ["Csv Aperti E2E", "operator", "8000 €"],
      ["Csv Chiuso E2E", "closed", "2500 €"],
    ] as const) {
      const { rows: cl } = await dbExec(
        `select id from clients where email_norm like '%${EMAIL_SUFFIX}' and name = $1`,
        [nome],
      );
      const c = await dbExec(
        `insert into conversations (initial_query, source_page, status, channel, created_at)
         values ($1, '/e2e-clients', $2, 'web', now() - interval '2 hours') returning id`,
        [`${nome} conv`, stato],
      );
      const l = await dbExec(
        `insert into leads (conversation_id, name, phone, consent, status, source_page, initial_query, budget, created_at)
         values ($1, 'Lead Csv', '+39020000088', true, 'nuovo', '/e2e-clients', 'q', $2, now()) returning id`,
        [c.rows[0].id, budget],
      );
      await dbExec("update conversations set lead_id = $2 where id = $1", [c.rows[0].id, l.rows[0].id]);
      await dbExec("insert into client_conversations (conversation_id, client_id) values ($1, $2)", [c.rows[0].id, cl[0].id]);
    }

    // ?aperti=1: SOLO il cliente col ticket aperto, e il file lo dice.
    const resA = await page.request.get("/api/admin/clients.csv?aperti=1");
    expect(resA.status()).toBe(200);
    expect(resA.headers()["content-disposition"]).toContain("clienti-aperti-");
    const aperti = await resA.text();
    expect(aperti).toContain("Csv Aperti E2E");
    expect(aperti).not.toContain("Csv Chiuso E2E");
    expect(aperti).not.toContain("Azienda Ditta E2E");

    // ?ordina=budget: tutti, in ordine di budget derivato — e il file lo
    // dice nel nome. Csv Aperti (8000) prima di Csv Chiuso (2500).
    const resB = await page.request.get("/api/admin/clients.csv?ordina=budget");
    expect(resB.headers()["content-disposition"]).toContain("clienti-budget-");
    const budget = await resB.text();
    const iA = budget.indexOf("Csv Aperti E2E");
    const iC = budget.indexOf("Csv Chiuso E2E");
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iC).toBeGreaterThan(iA);

    // I due filtri INSIEME: il nome compone entrambe le parti
    // (clienti-aperti-budget) e le righe restano solo gli aperti.
    const resC = await page.request.get("/api/admin/clients.csv?aperti=1&ordina=budget");
    expect(resC.headers()["content-disposition"]).toContain("clienti-aperti-budget-");
    const insieme = await resC.text();
    expect(insieme).toContain("Csv Aperti E2E");
    expect(insieme).not.toContain("Csv Chiuso E2E");

    // La colonna budget_dichiarato parla il valore DERIVATO (somma lead),
    // non una colonna clients: 8000 per l'aperto, 2500 per il chiuso.
    expect(budget).toMatch(/Csv Aperti E2E;Privato;[^\n]*;8000;/);
    expect(budget).toMatch(/Csv Chiuso E2E;Privato;[^\n]*;2500;/);
  });

  test("aziende senza ditta: il segmento conta e filtra ESATTAMENTE quelle", async ({ page }) => {
    await login(page);
    await page.goto("/admin/clients");

    // Il chip esiste col numero del DB (intera tabella, non solo i seed).
    const { rows } = await dbExec(
      "select count(*)::int as n from clients where client_type = 'azienda' and company_name is null",
    );
    await expect(page.getByRole("link", { name: new RegExp(`^Aziende senza ditta\\s+${rows[0].n}$`) })).toBeVisible();

    // Il filtro porta in vista l'azienda nuda e NON la con ditta.
    await page.getByRole("link", { name: /^Aziende senza ditta\s+\d+$/ }).first().click();
    await expect(page).toHaveURL(/senza-ditta=1/);
    const viste = await visibleCards(page, ["Azienda Ditta E2E", "Azienda Nuda E2E", "Privato E2E"]);
    expect(viste).toEqual(["Azienda Nuda E2E"]);

    // Il CSV del segmento è coerente (stesso contratto della vista).
    const res = await page.request.get("/api/admin/clients.csv?senza-ditta=1");
    const csv = await res.text();
    expect(res.headers()["content-disposition"]).toContain("aziende-senza-ditta");
    expect(csv).toContain("Azienda Nuda E2E");
    expect(csv).not.toContain("Azienda Ditta E2E");
  });

  test("CSV della scheda: la storia dei SUOI ticket con le etichette dell'app", async ({ page }) => {
    await login(page);

    // Un ticket MARCATO (source_page /e2e-clients) + cliente collegato:
    // la storia esportata deve contenere SOLO i suoi.
    const conv = await dbExec(
      `insert into conversations (initial_query, source_page, status, priority, channel, created_at)
       values ('richiesta e2e per csv scheda', '/e2e-clients', 'closed', 'alta', 'web', now() - interval '2 days')
       returning id, number`,
    );
    await dbExec(
      `insert into messages (conversation_id, sender, body, created_at) values ($1, 'visitor', 'ciao', now())`,
      [conv.rows[0].id],
    );
    const { rows: cli } = await dbExec(
      `select id from clients where email_norm like '%${EMAIL_SUFFIX}' and name = 'Azienda Ditta E2E'`,
    );
    await dbExec(`insert into client_conversations (conversation_id, client_id) values ($1, $2)`, [
      conv.rows[0].id,
      cli[0].id,
    ]);

    // Il bottone della scheda punta al ramo ?id= e il file scarica.
    await page.goto(`/admin/clients/${cli[0].id}`);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: /Esporta CSV \(\d+\)/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^cliente-azienda-ditta-e2e-\d{4}-\d{2}-\d{2}\.csv$/);

    // Il contenuto: etichette UI (stato/priorità/canale), non valori grezzi.
    const res = await page.request.get(`/api/admin/clients.csv?id=${cli[0].id}`);
    expect(res.status()).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("Azienda Ditta E2E");
    expect(csv).toContain("Azienda");
    expect(csv).toMatch(new RegExp(`#${conv.rows[0].number};Chiuso;Alta;Chat web;`));
    expect(csv).toContain("richiesta e2e per csv scheda");

    // Un cliente SENZA ticket esporta comunque l'intestazione (file vuoto ma valido).
    const { rows: vuoto } = await dbExec(
      `select id from clients where email_norm like '%${EMAIL_SUFFIX}' and name = 'Csv Null E2E'`,
    );
    const resVuoto = await page.request.get(`/api/admin/clients.csv?id=${vuoto[0].id}`);
    expect(resVuoto.status()).toBe(200);
    expect(await resVuoto.text()).toContain("ticket;stato;priorita");

    // id inesistente → 404, non un file vuoto che sembra buono.
    expect((await page.request.get("/api/admin/clients.csv?id=00000000-0000-0000-0000-000000000000")).status()).toBe(404);
  });

  test("aggregato per tipo nel tempo: coorte cumulativa, coerente col portafoglio", async ({ page }) => {
    await login(page);
    const res = await page.request.get("/api/admin/clients.csv?agg=tipo-mese");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("portafoglio-per-tipo");
    const csv = await res.text();
    expect(csv).toContain("mese;azienda;privato;ente_pubblico;da_classificare;totale");

    // L'ultima riga (mese corrente) deve totale il portafoglio REALE:
    // la coorte cumulativa chiude esattamente sui clienti che ci sono.
    const { rows } = await dbExec("select count(*)::int as n from clients");
    const righe = csv.trim().split("\n");
    const ultima = righe[righe.length - 1].split(";");
    expect(Number(ultima[5])).toBe(rows[0].n);
    // Le colonne per tipo sommano al totale (invariante della coorte).
    expect(Number(ultima[1]) + Number(ultima[2]) + Number(ultima[3]) + Number(ultima[4])).toBe(rows[0].n);
  });

  test("suggerimento ditta: proposto SOLO coi due bottoni, mai scritto in automatico", async ({ page }) => {
    await login(page);

    // Cliente azienda SENZA ditta + due lead distinti che citano la STESSA
    // ditta (forza ≥2) non salvata: il sync non la scrive, la scheda propone.
    // NOTA seed: il lead si aggancia alla conversazione da ENTRAMBE le
    // colonne (leads.conversation_id e conversations.lead_id) — è così che
    // li scrive la chat reale, e l'aggregato del suggerimento usa la seconda.
    const { rows: nuda } = await dbExec(
      `select id from clients where email_norm like '%${EMAIL_SUFFIX}' and name = 'Azienda Nuda E2E'`,
    );
    const c1 = await dbExec(
      `insert into conversations (initial_query, source_page, status, channel, created_at)
       values ('suggerimento e2e 1', '/e2e-clients', 'closed', 'web', now() - interval '3 hours') returning id`,
    );
    const c2 = await dbExec(
      `insert into conversations (initial_query, source_page, status, channel, created_at)
       values ('suggerimento e2e 2', '/e2e-clients', 'closed', 'web', now() - interval '2 hours') returning id`,
    );
    const l1 = await dbExec(
      `insert into leads (conversation_id, name, phone, consent, status, source_page, initial_query, company_name, created_at)
       values ($1, 'Lead Suggerito 1', '+390200000101', true, 'nuovo', '/e2e-clients', 'q1', 'Fornace E2E SRL', now()) returning id`,
      [c1.rows[0].id],
    );
    const l2 = await dbExec(
      `insert into leads (conversation_id, name, phone, consent, status, source_page, initial_query, company_name, created_at)
       values ($1, 'Lead Suggerito 2', '+390200000102', true, 'nuovo', '/e2e-clients', 'q2', 'fornace e2e srl', now()) returning id`,
      [c2.rows[0].id],
    );
    await dbExec("update conversations set lead_id = $2 where id = $1", [c1.rows[0].id, l1.rows[0].id]);
    await dbExec("update conversations set lead_id = $2 where id = $1", [c2.rows[0].id, l2.rows[0].id]);
    for (const cid of [c1.rows[0].id, c2.rows[0].id]) {
      await dbExec(`insert into client_conversations (conversation_id, client_id) values ($1, $2)`, [cid, nuda[0].id]);
    }

    // NIENTE auto-salvataggio: la company_name resta NULL finché l'umano non decide.
    const prima = await dbExec("select company_name from clients where id = $1", [nuda[0].id]);
    expect(prima.rows[0].company_name).toBeNull();

    await page.goto(`/admin/clients/${nuda[0].id}`);
    // Il banner ESATTO (non i suoi antenati che contengono lo stesso testo):
    // il box ambra con la classe del Suggerimento.
    const banner = page.locator("div.glass-solid.border-amber-200\\/60");
    await expect(banner).toBeVisible();
    // Determinismo del casing: le due varianti sono citate 1–1 → vince
    // l'alfabetica («Fornace…» maiuscolo). Stesso input, stessa proposta.
    await expect(banner).toContainText("Fornace E2E SRL");
    await expect(banner).toContainText("2 menzioni"); // dedup case-insensitive: due righe, un'azienda

    // Salva: la ditta entra in scheda (gesto esplicito) e il banner sparisce.
    await banner.getByRole("button", { name: /Salva/ }).click();
    await expect(page.getByText("Fornace E2E SRL").first()).toBeVisible({ timeout: 15_000 });
    const dopo = await dbExec("select company_name from clients where id = $1", [nuda[0].id]);
    expect(dopo.rows[0].company_name).toBe("Fornace E2E SRL");
  });

  test("rigetto ditta: il banner sparisce e NON riparte al ricaricamento", async ({ page }) => {
    await login(page);

    // Un altro azienda nuda + citazioni ripetute di una ditta che l'operatore NON vuole.
    await seedClient({ name: "Rigetto E2E", tipo: "azienda", company: null });
    const { rows: target } = await dbExec(
      `select id from clients where email_norm like '%${EMAIL_SUFFIX}' and name = 'Rigetto E2E'`,
    );
    for (let i = 1; i <= 2; i++) {
      const c = await dbExec(
        `insert into conversations (initial_query, source_page, status, channel, created_at)
         values ($1, '/e2e-clients', 'closed', 'web', now() - interval '1 hour') returning id`,
        [`rigetto e2e ${i}`],
      );
      const l = await dbExec(
        `insert into leads (conversation_id, name, phone, consent, status, source_page, initial_query, company_name, created_at)
         values ($1, 'Lead Rigetto', '+3902000002' || $2, true, 'nuovo', '/e2e-clients', 'q', 'Ditta Indesiderata SRL', now()) returning id`,
        [c.rows[0].id, String(i)],
      );
      await dbExec("update conversations set lead_id = $2 where id = $1", [c.rows[0].id, l.rows[0].id]);
      await dbExec(`insert into client_conversations (conversation_id, client_id) values ($1, $2)`, [c.rows[0].id, target[0].id]);
    }

    await page.goto(`/admin/clients/${target[0].id}`);
    const banner = page.locator("div.glass-solid.border-amber-200\\/60");
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: /Non è la sua ditta/i }).click();
    await expect(banner).not.toBeVisible({ timeout: 15_000 });

    // Il «no» è memoria (039): ricaricando, il banner NON riparte — e la
    // company_name resta NULL (rigettare non è accettare in silenzio).
    await page.reload();
    await expect(page.locator("div.glass-solid.border-amber-200\\/60")).not.toBeVisible();
    const { rows } = await dbExec("select company_name, value->'ditte_rigettate' as rigettate from clients left join client_meta on client_meta.client_id = clients.id where clients.id = $1", [target[0].id]);
    expect(rows[0].company_name).toBeNull();
    expect(rows[0].rigettate).toContain("Ditta Indesiderata SRL");
  });

  test("completamento rapido da LISTA: salva e rigetta senza aprire la scheda", async ({ page }) => {
    await login(page);

    // Due aziende nude con proposta: una da SALVARE da lista, una da RIGETTARE.
    await seedClient({ name: "Lista Salva E2E", tipo: "azienda", company: null });
    await seedClient({ name: "Lista Rigetta E2E", tipo: "azienda", company: null });
    for (const [nome, ditta] of [["Lista Salva E2E", "Cooperativa Lista SRL"], ["Lista Rigetta E2E", "Spooky Lista SRL"]] as const) {
      const { rows: cl } = await dbExec(`select id from clients where email_norm like '%${EMAIL_SUFFIX}' and name = $1`, [nome]);
      for (let i = 1; i <= 2; i++) {
        const c = await dbExec(
          `insert into conversations (initial_query, source_page, status, channel, created_at)
           values ($1, '/e2e-clients', 'closed', 'web', now() - interval '1 hour') returning id`,
          [`${ditta} e2e ${i}`],
        );
        const l = await dbExec(
          `insert into leads (conversation_id, name, phone, consent, status, source_page, initial_query, company_name, created_at)
           values ($1, $2, '+3902000003' || $3, true, 'nuovo', '/e2e-clients', 'q', $4, now()) returning id`,
          [c.rows[0].id, `Lead ${nome} ${i}`, String(10 + i), ditta],
        );
        await dbExec("update conversations set lead_id = $2 where id = $1", [c.rows[0].id, l.rows[0].id]);
        await dbExec(`insert into client_conversations (conversation_id, client_id) values ($1, $2)`, [c.rows[0].id, cl[0].id]);
      }
    }

    // In LISTA (filtro qualità), ogni azienda nuda mostra il SUO punto azione.
    await page.goto("/admin/clients?senza-ditta=1");
    const cardSalva = page.locator("div.glass-solid.rounded-3xl").filter({ hasText: "Lista Salva E2E" });
    const boxSalva = cardSalva.locator("div.border-amber-200\\/60");
    await expect(boxSalva).toContainText("Cooperativa Lista SRL");

    // SALVA da lista: la ditta entra in scheda senza averla aperta.
    await boxSalva.getByRole("button", { name: /Salva in scheda/ }).click();
    await expect.poll(async () => {
      const { rows } = await dbExec(
        `select company_name from clients where email_norm like '%${EMAIL_SUFFIX}' and name = 'Lista Salva E2E'`,
      );
      return rows[0]?.company_name;
    }, { timeout: 15_000 }).toBe("Cooperativa Lista SRL");
    // Il punto azione sparisce dalla lista (non c'è più nulla da proporre).
    await expect(boxSalva).not.toBeVisible({ timeout: 15_000 });

    // RIGETTA da lista: niente scrittura, il «no» resta (039) e il punto sparisce.
    const cardRigetta = page.locator("div.glass-solid.rounded-3xl").filter({ hasText: "Lista Rigetta E2E" });
    const boxRigetta = cardRigetta.locator("div.border-amber-200\\/60");
    await expect(boxRigetta).toContainText("Spooky Lista SRL");
    await boxRigetta.getByRole("button", { name: /Non è la sua/ }).click();
    await expect(boxRigetta).not.toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => {
      const { rows } = await dbExec(
        `select company_name from clients where email_norm like '%${EMAIL_SUFFIX}' and name = 'Lista Rigetta E2E'`,
      );
      return rows[0]?.company_name;
    }).toBeNull();
    const { rows: meta } = await dbExec(
      `select cm.value->'ditte_rigettate' as r from client_meta cm join clients c on c.id = cm.client_id where c.email_norm like '%${EMAIL_SUFFIX}' and c.name = 'Lista Rigetta E2E'`,
    );
    expect(meta[0]?.r).toContain("Spooky Lista SRL");

    // Ricarica: il punto azione rigettato NON riparte in lista.
    await page.reload();
    await expect(page.locator("div.glass-solid.rounded-3xl").filter({ hasText: "Lista Rigetta E2E" }).locator("div.border-amber-200\\/60")).not.toBeVisible();
  });

  test("filtri lista: «con ticket aperti» guarda lo stato, ordina=budget usa il budget derivato", async ({ page }) => {
    // Tre clienti: due con ticket (e budget lead diversi), uno senza
    // ticket. Solo ha un ticket aperto E uno chiuso: il chiuso porta
    // budget ma non conta per «aperti».
    await seedClient({ name: "Aperti Alto E2E", tipo: "privato" });
    await seedClient({ name: "Aperti Solo E2E", tipo: "privato" });
    await seedClient({ name: "Aperti Zero E2E", tipo: "privato" });
    const idOf = async (name: string) =>
      (await dbExec(`select id from clients where email_norm like '%${EMAIL_SUFFIX}' and name = $1`, [name])).rows[0].id as string;
    async function convConLead(opts: { query: string; status: string; budget: string; clientId: string }) {
      const c = await dbExec(
        `insert into conversations (initial_query, source_page, status, channel, created_at)
         values ($1, '/e2e-clients', $2, 'web', now() - interval '2 hours') returning id`,
        [opts.query, opts.status],
      );
      // Il lead aggancia ENTRAMBE le colonne: leads.conversation_id E
      // conversations.lead_id (l'aggregato budget usa conversations.lead_id).
      const l = await dbExec(
        `insert into leads (conversation_id, name, phone, consent, status, source_page, initial_query, budget, created_at)
         values ($1, 'Lead Aperti', '+39020000077', true, 'nuovo', '/e2e-clients', 'q', $2, now()) returning id`,
        [c.rows[0].id, opts.budget],
      );
      await dbExec("update conversations set lead_id = $2 where id = $1", [c.rows[0].id, l.rows[0].id]);
      await dbExec("insert into client_conversations (conversation_id, client_id) values ($1, $2)", [c.rows[0].id, opts.clientId]);
    }
    await convConLead({ query: "budget alto e2e", status: "operator", budget: "12000 €", clientId: await idOf("Aperti Alto E2E") });
    await convConLead({ query: "budget medio aperto", status: "operator", budget: "5000 € più IVA", clientId: await idOf("Aperti Solo E2E") });
    await convConLead({ query: "budget medio chiuso", status: "closed", budget: "1.200 €", clientId: await idOf("Aperti Solo E2E") });

    await login(page);

    // Filtro «con ticket aperti»: entrano i due con un aperto, non lo zero.
    await page.goto("/admin/clients?aperti=1");
    const viste = await visibleCards(page, ["Aperti Alto E2E", "Aperti Solo E2E", "Aperti Zero E2E"]);
    expect(viste).toContain("Aperti Alto E2E");
    expect(viste).toContain("Aperti Solo E2E");
    expect(viste).not.toContain("Aperti Zero E2E");

    // ordina=budget: 12000 → 6200 (5000 + 1.200) → null (in fondo).
    await page.goto("/admin/clients?ordina=budget");
    const y = async (n: string) => (await page.locator("a", { hasText: n }).first().boundingBox())!.y;
    expect(await y("Aperti Alto E2E")).toBeLessThan(await y("Aperti Solo E2E"));
    expect(await y("Aperti Solo E2E")).toBeLessThan(await y("Aperti Zero E2E"));

    // La verità nel DB: «aperti» è lo stato del ticket, il budget è la
    // somma dei lead (derivato, mai una colonna clients).
    const { rows } = await dbExec(
      `select c.name,
              (select count(*)::int from client_conversations cc
                join conversations cv on cv.id = cc.conversation_id
                where cc.client_id = c.id and cv.status not in ('closed','on_hold','bot')) as aperti,
              (select array_agg(l.budget order by l.budget) from client_conversations cc3
                join conversations cv3 on cv3.id = cc3.conversation_id
                join leads l on l.id = cv3.lead_id
                where cc3.client_id = c.id and l.budget is not null) as budgets
       from clients c where c.email_norm like '%${EMAIL_SUFFIX}' and c.name like 'Aperti %' order by c.name`,
    );
    const perNome = Object.fromEntries(rows.map((r) => [r.name as string, r]));
    expect(perNome["Aperti Alto E2E"].aperti).toBe(1);
    expect(perNome["Aperti Solo E2E"].aperti).toBe(1);
    expect(perNome["Aperti Zero E2E"].aperti).toBe(0);
    expect(perNome["Aperti Solo E2E"].budgets).toEqual(expect.arrayContaining(["1.200 €", "5000 € più IVA"]));
  });

  test("nota dalla scheda: si salva, si rilegge dopo la revalidate e finisce in audit", async ({ page }) => {
    await seedClient({ name: "Nota Viva E2E", tipo: "privato" });
    await login(page);
    await page.goto("/admin/clients");
    await page.locator("a", { hasText: "Nota Viva E2E" }).first().click();
    await expect(page).toHaveURL(/\/admin\/clients\/[0-9a-f-]{36}$/);

    const testo = "Preferisce email al pomeriggio. Contratto annuale rinnovato a settembre.";
    await page.locator('textarea[name="notes"]').fill(testo);
    await page.getByRole("button", { name: /Salva nota/ }).click();

    // La verità è nel DB (poll: la action è asincrona; la textarea NON
    // controllata resterebbe col valore digitato anche se il salvataggio
    // andasse perso — il solo toHaveValue non prova niente).
    await expect
      .poll(async () => {
        const { rows } = await dbExec(
          `select notes from clients where email_norm like '%${EMAIL_SUFFIX}' and name = 'Nota Viva E2E'`,
        );
        return rows[0]?.notes ?? null;
      }, { timeout: 15_000 })
      .toBe(testo);
    const { rows: target } = await dbExec(
      `select id from clients where email_norm like '%${EMAIL_SUFFIX}' and name = 'Nota Viva E2E'`,
    );
    const idNota = target[0].id as string;

    // La revalidate ripresenta la scheda col valore salvato: ricarico e
    // leggo quello che il server render, non ciò che avevo digitato.
    await page.reload();
    await expect(page.locator('textarea[name="notes"]')).toHaveValue(testo, { timeout: 15_000 });

    // Audit col target = scheda giusta.
    const audit = await dbExec("select actor from audit_log where action = 'client.nota' and target = $1", [idNota]);
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  test("sync dal bottone: il ticket nuovo diventa scheda cliente, il secondo giro non duplica", async ({ page }) => {
    // Ticket email con contact_email (maiuscole/minuscole volute: il sync
    // normalizza) e header from_name in email_ingest: il nome della scheda
    // viene dall'header, non dall'indirizzo.
    const c = await dbExec(
      `insert into conversations (initial_query, source_page, status, channel, contact_email, created_at)
       values ('preventivo vetrina e-commerce', '/e2e-clients', 'operator', 'email', 'Sync.Nuovo@E2E-Clients.test', now()) returning id`,
    );
    const convId = c.rows[0].id as string;
    await dbExec("insert into messages (conversation_id, sender, body) values ($1, 'visitor', 'Buongiorno, vorrei un preventivo.')", [convId]);
    await dbExec(
      `insert into email_ingest (message_id, from_address, from_name, subject, body_text, received_at)
       values ($1, 'sync.nuovo@e2e-clients.test', 'Sig.ra Sync Nuovo', 'preventivo', 'corpo di prova', now())`,
      [`e2e-sync-${convId}@test`],
    );
    const pre = await dbExec("select count(*)::int as n from clients where email_norm = 'sync.nuovo@e2e-clients.test'");
    expect(pre.rows[0].n).toBe(0);

    await login(page);
    await page.goto("/admin/clients");
    await page.getByRole("button", { name: /Sincronizza ora/ }).click();
    await expect(page).toHaveURL(/\/admin\/clients\?sync=/, { timeout: 15_000 });
    await expect(page.getByText(/riconciliat/i)).toBeVisible();

    // La scheda esiste, col nome dell'header, il ticket collegato e il
    // marchio synced_at del giro di sync.
    await expect.poll(async () => {
      const { rows } = await dbExec(
        `select cl.name, cl.synced_at,
                (select count(*)::int from client_conversations cc where cc.client_id = cl.id) as ticket
         from clients cl where cl.email_norm = 'sync.nuovo@e2e-clients.test'`,
      );
      return rows[0]?.synced_at ? `${rows[0].name}|${rows[0].ticket}` : null;
    }, { timeout: 15_000 }).toBe("Sig.ra Sync Nuovo|1");

    // L'audit del sync porta l'actor = admin che ha premuto il bottone.
    const audit = await dbExec(
      `select actor from audit_log where action = 'client.sync' and detail like '%riconciliat%' order by created_at desc limit 1`,
    );
    expect(audit.rows[0].actor).toBe(ADMIN.email);

    // Secondo giro: il claim (client_conversations) rende il sync
    // idempotente — nessuna scheda doppia, nessun collegamento doppio.
    await page.getByRole("button", { name: /Sincronizza ora/ }).click();
    await expect(page).toHaveURL(/\/admin\/clients\?sync=/, { timeout: 15_000 });
    const dopo = await dbExec("select count(*)::int as n from clients where email_norm = 'sync.nuovo@e2e-clients.test'");
    expect(dopo.rows[0].n).toBe(1);
    const link = await dbExec("select count(*)::int as n from client_conversations where conversation_id = $1", [convId]);
    expect(link.rows[0].n).toBe(1);
  });

  test("sync canale WhatsApp: il telefono E.164 è l'identità (nessuna email), il secondo ticket si fonde per numero", async ({ page }) => {
    // Ticket WhatsApp: il lead porta wa_phone (E.164) e il nome — niente
    // contact_email, e il messaggio non cita email (la rete di sicurezza
    // del cited_email non deve inventarsi un indirizzo).
    //
    // ORDINE: il sync processa `order by updated_at desc`, ma il trigger
    // conversations_touch rimette updated_at = now() a ogni UPDATE (anche
    // al nostro `set lead_id` di aggancio). L'ordine reale è quindi
    // «chi è stato aggiornato per ultimo»: per avere il WA come PRIMO
    // processato (è lui che CREA la scheda col suo nome, senza email),
    // il suo `set lead_id` deve essere l'ULTIMO gesto del seed — dopo,
    // nessun tocco al ticket web.
    const web = await dbExec(
      `insert into conversations (initial_query, source_page, status, channel, created_at)
       values ('ritorno su chat web', '/e2e-clients', 'operator', 'web', now() - interval '5 minutes') returning id`,
    );
    const webConv = web.rows[0].id as string;
    await dbExec(
      `insert into leads (conversation_id, name, phone, consent, status, source_page, initial_query, created_at)
       values ($1, 'Variante Nome', '+39 020 000 501', true, 'nuovo', '/e2e-clients', 'q', now()) returning id`,
      [webConv],
    );
    await dbExec("update conversations set lead_id = (select id from leads where conversation_id = $1) where id = $1", [webConv]);
    await dbExec("insert into messages (conversation_id, sender, body) values ($1, 'visitor', 'Sono sempre io, dal browser.')", [webConv]);

    // Secondo ticket, canale CHAT WEB: stesso numero ma scritto col
    // prefisso +39 e con spazi (la normalizzazione E.164 deve ricondurlo
    // all'identità del WA). Nome diverso: il merge per phone_e164 NON deve
    // sovrascrivere il nome della scheda («completa ma non distrugge”).
    // Anche qui nessuna email.
    const wa = await dbExec(
      `insert into conversations (initial_query, source_page, status, channel, created_at)
       values ('richiesta da whatsapp', '/e2e-clients', 'operator', 'whatsapp', now()) returning id`,
    );
    const waConv = wa.rows[0].id as string;
    await dbExec(
      // leads.phone è NOT NULL: il lead porta il telefono raw (come arriva
      // dal canale) e wa_phone è la versione E.164 già normalizzata.
      `insert into leads (conversation_id, name, phone, wa_phone, consent, status, source_page, initial_query, created_at)
       values ($1, 'WA Solo Telefono', '+39 020 000 501', '+39020000501', true, 'nuovo', '/e2e-clients', 'q', now()) returning id`,
      [waConv],
    );
    await dbExec("update conversations set lead_id = (select id from leads where conversation_id = $1) where id = $1", [waConv]);
    await dbExec("insert into messages (conversation_id, sender, body) values ($1, 'visitor', 'Ciao, scrivo da WhatsApp.')", [waConv]);

    const pre = await dbExec("select count(*)::int as n from clients where phone_e164 = '+39020000501'");
    expect(pre.rows[0].n).toBe(0);

    await login(page);
    await page.goto("/admin/clients");
    await page.getByRole("button", { name: /Sincronizza ora/ }).click();
    await expect(page).toHaveURL(/\/admin\/clients\?sync=/, { timeout: 15_000 });

    // UNA scheda sola: il telefono normalizzato è la chiave di dedup —
    // senza email (mai citata, mai nel canale), nome dal primo lead.
    await expect.poll(async () => {
      const { rows } = await dbExec(
        `select count(*)::int as schede from clients where phone_e164 = '+39020000501'`,
      );
      return rows[0].schede;
    }, { timeout: 15_000 }).toBe(1);
    const { rows: scheda } = await dbExec(
      `select name, email_norm, contact_email, synced_at from clients where phone_e164 = '+39020000501'`,
    );
    expect(scheda[0].name).toBe("WA Solo Telefono");
    expect(scheda[0].email_norm).toBeNull();
    expect(scheda[0].contact_email).toBeNull();
    expect(scheda[0].synced_at).not.toBeNull();

    // Entrambi i ticket collegati alla STESSA scheda (il secondo ticket ha
    // trovato il cliente per telefono, non ha creato un doppione).
    const link = await dbExec(
      `select conversation_id, client_id from client_conversations where conversation_id in ($1, $2)`,
      [waConv, webConv],
    );
    expect(link.rows.length).toBe(2);
    expect(new Set(link.rows.map((r) => r.client_id)).size).toBe(1);
  });

  test("sync AUTOMATICA via cron tick: user-agent vercel-cron, nessuna sessione admin, actor ambrosio@ai", async ({ request }) => {
    // Il tick del cron (stesso motore del bottone, punto 9 del tick) gira
    // SENZA sessione admin: qui non c'è nessun login — la request è nuda.
    // In E2E non esiste CRON_SECRET: l'unica chiave è lo user-agent
    // «vercel-cron/1.0» di Vercel Cron, e il test lo dimostra anche al
    // contrario (senza quell'header → 401).
    const senzaChiave = await request.get("/api/cron/tick");
    expect(senzaChiave.status()).toBe(401);

    // Ticket WhatsApp NUOVO (non reclamato dai sync dei test precedenti,
    // che girano prima in modalità serial): il cron deve processarlo.
    const wa = await dbExec(
      `insert into conversations (initial_query, source_page, status, channel, created_at)
       values ('richiesta whatsapp via cron', '/e2e-clients', 'operator', 'whatsapp', now()) returning id`,
    );
    const waConv = wa.rows[0].id as string;
    await dbExec(
      `insert into leads (conversation_id, name, phone, wa_phone, consent, status, source_page, initial_query, created_at)
       values ($1, 'WA Via Cron', '+39 020 000 502', '+39020000502', true, 'nuovo', '/e2e-clients', 'q', now()) returning id`,
      [waConv],
    );
    await dbExec("update conversations set lead_id = (select id from leads where conversation_id = $1) where id = $1", [waConv]);
    await dbExec("insert into messages (conversation_id, sender, body) values ($1, 'visitor', 'Scrivo da WhatsApp, turno del cron.')", [waConv]);

    // GET (la route è GET, non POST) con lo user-agent di Vercel Cron.
    const tick = await request.get("/api/cron/tick", {
      headers: { "user-agent": "vercel-cron/1.0" },
      timeout: 40_000, // il tick fa TUTTI gli automatismi in sequenza (best-effort)
    });
    expect(tick.status()).toBe(200);
    const sommario = (await tick.json()) as { ok: boolean; clientsSynced: number };
    expect(sommario.ok).toBe(true);
    expect(sommario.clientsSynced).toBeGreaterThanOrEqual(1);

    // La scheda nasce senza che nessun admin abbia aperto /admin/clients:
    // identità dal telefono, nome dal lead, nessuna email.
    await expect.poll(async () => {
      const { rows } = await dbExec(
        `select count(*)::int as n from clients where phone_e164 = '+39020000502'`,
      );
      return rows[0].n;
    }, { timeout: 10_000 }).toBe(1);
    const { rows: scheda } = await dbExec(
      `select name, email_norm, contact_email from clients where phone_e164 = '+39020000502'`,
    );
    expect(scheda[0].name).toBe("WA Via Cron");
    expect(scheda[0].email_norm).toBeNull();
    expect(scheda[0].contact_email).toBeNull();

    // Il collegamento ticket→scheda è firmato dal giro del cron.
    const link = await dbExec(
      "select client_id from client_conversations where conversation_id = $1",
      [waConv],
    );
    expect(link.rows[0].client_id).toBeTruthy();

    // E l'audit distingue la macchina dall'uomo: actor 'ambrosio@ai',
    // non l'email di un admin (il bottone audita con l'admin, il cron no).
    const audit = await dbExec(
      "select actor from audit_log where action = 'client.sync' order by created_at desc limit 1",
    );
    expect(audit.rows[0].actor).toBe("ambrosio@ai");
  });

  test("sync canale email: contact_email batte il citato, e il citato da solo basta (rete di sicurezza)", async ({ page }) => {
    // PRIMO ticket: contact_email E email citata nel testo, DIVERSE. La
    // precedenza della route di identità (contact_email > cited_email)
    // decide chi vince: l'indirizzo del canale, non il primo citato.
    const mail = await dbExec(
      `insert into conversations (initial_query, source_page, status, channel, contact_email, created_at)
       values ('preventivo con allegato', '/e2e-clients', 'operator', 'email', 'cite.canale@e2e-clients.test', now()) returning id`,
    );
    const mailConv = mail.rows[0].id as string;
    await dbExec(
      "insert into messages (conversation_id, sender, body) values ($1, 'visitor', $2)",
      [mailConv, "Buongiorno, in allegato il vecchio contratto. Mi scriva pure su cite.sicurezza@e2e-clients.test."],
    );

    // SECONDO ticket: NESSUN contact_email, NESSUN lead — solo l'email
    // citata nei messaggi (il caso reale del cliente che scrive l'indirizzo
    // nel testo). La rete di sicurezza cited_email lo salva: identità =
    // indirizzo, nome = parte locale («cite.sicurezza»). L'ordine segue
    // l'ultimo tocco (trigger conversations_touch): questo è l'ultimo gesto
    // del seed e crea la scheda; il primo ticket si fonde con contact_email
    // = l'indirizzo del canale, che è DIVERSO (nessuna fusione, due schede).
    const cit = await dbExec(
      `insert into conversations (initial_query, source_page, status, channel, created_at)
       values ('solo email nel testo', '/e2e-clients', 'operator', 'web', now()) returning id`,
    );
    const citConv = cit.rows[0].id as string;
    await dbExec(
      "insert into messages (conversation_id, sender, body) values ($1, 'visitor', $2)",
      [citConv, "Il mio recapito è cite.sicurezza@e2e-clients.test, grazie."],
    );

    const pre = await dbExec("select count(*)::int as n from clients where email_norm in ('cite.canale@e2e-clients.test', 'cite.sicurezza@e2e-clients.test')");
    expect(pre.rows[0].n).toBe(0);

    await login(page);
    await page.goto("/admin/clients");
    await page.getByRole("button", { name: /Sincronizza ora/ }).click();
    await expect(page).toHaveURL(/\/admin\/clients\?sync=/, { timeout: 15_000 });

    // DUE schede: il ticket con contact_email porta l'indirizzo del canale
    // (l'indirizzo citato nel testo NON vince), il ticket solo-citato crea
    // la sua. La scheda del citato: nome dalla parte locale, zero telefono.
    await expect.poll(async () => {
      const { rows } = await dbExec(
        `select email_norm, name, phone_e164 from clients where email_norm in ('cite.canale@e2e-clients.test', 'cite.sicurezza@e2e-clients.test')`,
      );
      return rows.length;
    }, { timeout: 15_000 }).toBe(2);
    const { rows: schede } = await dbExec(
      `select email_norm, name, phone_e164 from clients where email_norm in ('cite.canale@e2e-clients.test', 'cite.sicurezza@e2e-clients.test') order by email_norm`,
    );
    const canale = schede.find((r) => r.email_norm === "cite.canale@e2e-clients.test");
    const citato = schede.find((r) => r.email_norm === "cite.sicurezza@e2e-clients.test");
    expect(canale).toBeTruthy();
    expect(citato).toBeTruthy();
    // Il nome della scheda del citato viene dalla parte locale dell'indirizzo
    // (resolveClientNamePure): punti/trattini diventano spazi.
    expect(citato!.name).toBe("cite sicurezza");
    expect(citato!.phone_e164).toBeNull();

    // Ogni ticket è collegato alla SUA scheda: il canale con contact_email
    // non finisce sull'identità del citato (e viceversa).
    const link = await dbExec(
      `select cc.conversation_id, cl.email_norm from client_conversations cc
       join clients cl on cl.id = cc.client_id
       where cc.conversation_id in ($1, $2)`,
      [mailConv, citConv],
    );
    expect(link.rows.length).toBe(2);
    const perConv = Object.fromEntries(link.rows.map((r) => [r.conversation_id, r.email_norm]));
    expect(perConv[mailConv]).toBe("cite.canale@e2e-clients.test");
    expect(perConv[citConv]).toBe("cite.sicurezza@e2e-clients.test");
  });

  test("l'export CSV è negato senza sessione (guardia dell'endpoint)", async ({ request }) => {
    expect((await request.get("/api/admin/clients.csv")).status()).toBe(401);
    expect((await request.get("/api/admin/clients.csv?agg=tipo-mese")).status()).toBe(401);
    expect((await request.get("/api/admin/clients.csv?id=00000000-0000-0000-0000-000000000000")).status()).toBe(401);
  });
});
