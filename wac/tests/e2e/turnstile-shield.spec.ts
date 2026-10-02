import { test, expect } from "@playwright/test";

// Il seed ripulisce all'inizio (per i rerun); senza afterAll ogni run lasciava
// 4 shield_events «e2e-filtro» nel DB condiviso — scoperchiato dal leak guard
// (scripts/e2e-leak-guard.mjs, globalTeardown). La stesa copre anche le righe
// di content_settings create dai test; audit_log è append-only per design
// (rule no_delete in DB) e NON viene ripulito: gli attori unici per run non
// sono un leak, sono la storia.
test.afterAll(async () => {
  await dbExec("delete from shield_events where detail = 'e2e-filtro'");
  await dbExec("delete from content_settings where key = 'turnstile_tools'");
  await dbExec("delete from admin_users where email like '%@e2e.local'");
});
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * E2E del captcha invisibile (Turnstile) configurabile dalla scheda
 * Cloudflare dell'hub Impostazioni.
 *
 * In E2E girano le chiavi di TEST ufficiali Cloudflare via env (sempre valide,
 * widget invisibile che risolve subito): il login reale DEVE funzionare anche
 * col captcha attivo — è la prova che il flusso lazy (aspetta il token prima
 * del submit) non blocca le persone vere.
 *
 * Poi si verifica la gestione dalla scheda Impostazioni → Cloudflare:
 * salvataggio chiavi (cifrata la secret, solo hint al client), stato «chiavi
 * da Cloudflare (DB)», rimozione. Shield resta diagnostica di sola lettura.
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

const CAPO = { email: "capo@e2e.local", password: "CapoSicuro!1" };
const UTENTE = { email: "dentro@e2e.local", password: "DentroSicura!1" };

test.describe.configure({ mode: "serial" });

test.describe("captcha invisibile su scheda Cloudflare", () => {
  test("seed: super admin + utente semplice", async () => {
    await dbExec("delete from admin_users where email like '%@e2e.local'");
    await dbExec(
      `insert into admin_users (email, password_hash, role) values ($1,$2,'super_admin')
       on conflict (email) do update set password_hash = excluded.password_hash, active = true, role = 'super_admin'`,
      [CAPO.email, hash(CAPO.password)],
    );
    await dbExec(
      `insert into admin_users (email, password_hash, role) values ($1,$2,'admin')
       on conflict (email) do update set password_hash = excluded.password_hash, active = true, role = 'admin'`,
      [UTENTE.email, hash(UTENTE.password)],
    );
    await dbExec("delete from content_settings where key = 'turnstile_tools'");
  });

  test("login con captcha ATTIVO: il flusso lazy non blocca le persone vere", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(UTENTE.email);
    await page.getByLabel("Password").fill(UTENTE.password);
    await page.getByRole("button", { name: /entra/i }).click();
    // Il widget invisibile di test risolve in fretta: il campo token viene
    // allegato (o il submit aspetta finché non è pronto) e il login passa.
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  });

  test("Shield: salvo le chiavi DB → stato, hint cifrato, audit", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(CAPO.email);
    await page.getByLabel("Password").fill(CAPO.password);
    await page.getByRole("button", { name: /entra/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });

    await page.goto("/admin/settings/cloudflare");
    await expect(page.getByRole("heading", { name: /captcha invisibile/i })).toBeVisible();
    // Le env di test sono attive: la scheda lo dichiara.
    await expect(page.getByText("chiavi da environment (prioritaria)")).toBeVisible();

    // Salvo una coppia DB (site di test + secret di test).
    await page.getByLabel("Site key (pubblica)").fill("1x00000000000000000000AA");
    await page.getByLabel(/Secret key/).fill("1x0000000000000000000000000000000AA");
    await page.getByRole("button", { name: /salva chiavi captcha/i }).click();
    await expect(page.getByText(/Chiavi captcha salvate/)).toBeVisible();

    // La SECRET non torna mai al client (né in chiaro nel DB).
    const body = await page.content();
    expect(body).not.toContain("1x0000000000000000000000000000000AA");
    // Con le env di test ancora presenti, la priorità resta all'env: la pagina
    // lo dichiara (la config DB diventerà la fonte attiva solo senza env).
    await expect(page.getByText("chiavi da environment (prioritaria)")).toBeVisible();

    // Audit (azioni della scheda Cloudflare; quelle storiche di Shield restano nel log append-only).
    const audit = await dbExec(
      "select action from audit_log where action like 'cloudflare.turnstile%' order by created_at desc limit 2",
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toContain("cloudflare.turnstile_save");

    // Il valore nel DB è cifrato: niente secret in chiaro.
    const stored = await dbExec("select value from content_settings where key = 'turnstile_tools'");
    expect(JSON.stringify(stored.rows[0].value)).not.toContain("1x0000000000000000000000000000000AA");
    expect(JSON.stringify(stored.rows[0].value)).toContain("secretEnc");
  });

  test("Prova verifica: siteverify reale col token fittizio → verde e indicatore ultimo test", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(CAPO.email);
    await page.getByLabel("Password").fill(CAPO.password);
    await page.getByRole("button", { name: /entra/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });

    await page.goto("/admin/settings/cloudflare");
    // Il test usa la secret attiva: in E2E le env di test sono sempre valide.
    await page.getByRole("button", { name: /prova verifica/i }).click();
    await expect(page.getByText(/^OK — /)).toBeVisible();
    // L'indicatore nell'header legge l'audit (append-only: mai riscritto).
    await expect(page.getByText(/ultimo test:/)).toBeVisible();
    // La catena reale → siteverify di Cloudflare è stata percorsa (audit).
    const audit = await dbExec(
      "select detail from audit_log where action = 'cloudflare.test' order by created_at desc limit 1",
    );
    expect(audit.rows[0]?.detail ?? "").toMatch(/^OK — /);

    // L'hub Impostazioni mostra l'esito come meta accanto alla pill della card.
    await page.goto("/admin/settings");
    await expect(page.getByText(/Ultimo test OK · \d{1,2} /)).toBeVisible();
    await expect(page.getByText("Attivo (env)")).toBeVisible();

    // La checklist di attivazione è leggibile in admin: è lo STESSO documento
    // del repo (letto dal disco), con «Prova verifica» come passo #2.
    await page.goto("/admin/settings/cloudflare/checklist");
    await expect(page.getByText("Attivazione captcha Turnstile in produzione")).toBeVisible();
    await expect(page.getByText("Prova verifica").first()).toBeVisible();
    await expect(page.getByText("Salva chiavi captcha").first()).toBeVisible();
  });

  test("rimuovo la config DB: le env tornano la fonte attiva", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(CAPO.email);
    await page.getByLabel("Password").fill(CAPO.password);
    await page.getByRole("button", { name: /entra/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });

    await page.goto("/admin/settings/cloudflare");
    // Il bottone esiste perché la config DB ESISTE (anche se oscurata dalle env):
    // l'admin deve sempre poterla pulire.
    await page.getByRole("button", { name: /rimuovi config db/i }).click();
    await expect(page.getByText("chiavi da environment (prioritaria)")).toBeVisible();
    const stored = await dbExec("select value from content_settings where key = 'turnstile_tools'");
    expect(stored.rows).toHaveLength(0);
  });

  test("pannello eventi: conteggi 7 giorni e filtro per tipo", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(CAPO.email);
    await page.getByLabel("Password").fill(CAPO.password);
    await page.getByRole("button", { name: /entra/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });

    // Seed di eventi deterministici (ulti 7 giorni, tipi misti). Auto-pulente:
    // i rerun senza reset DB non devono duplicare i conteggi.
    await dbExec("delete from shield_events where detail = 'e2e-filtro'");
    await dbExec(
      `insert into shield_events (ip, kind, endpoint, detail, created_at) values
       ('203.0.113.10', 'rate_limit', '/api/chat/init', 'e2e-filtro', now() - interval '2 days'),
       ('203.0.113.10', 'rate_limit', '/api/lead', 'e2e-filtro', now() - interval '1 hour'),
       ('203.0.113.11', 'honeypot', '/api/callback', 'e2e-filtro', now() - interval '3 days'),
       ('198.51.100.7', 'bad_payload', '/api/lead', 'e2e-filtro', now() - interval '8 days')`,
    );

    await page.goto("/admin/shield");
    // I conteggi 7gg escludono l'evento di 8 giorni fa (bad_payload: 0, non 1).
    const rl = page.locator("a", { hasText: "Rate limit" });
    await expect(rl.locator("span")).toHaveText("2");
    await expect(page.locator("a", { hasText: "Honeypot" }).locator("span")).toHaveText("1");
    await expect(page.locator("a", { hasText: "Payload sospetto" }).locator("span")).toHaveText("0");
    // La lista (25 recenti) mostra eventi di ogni tipo, incluso il vecchio.
    await expect(page.getByText("198.51.100.7")).toBeVisible();

    // Filtro rate_limit: la lista contiene SOLO eventi di quel tipo (entrambi).
    await rl.click();
    await expect(page).toHaveURL(/kind=rate_limit/);
    await expect(page.getByText("203.0.113.10")).toHaveCount(2); // entrambi gli eventi
    await expect(page.getByText("203.0.113.11")).toHaveCount(0); // honeypot fuori
    await expect(page.getByText("198.51.100.7")).toHaveCount(0); // 8gg fa e altro tipo
    // Il filtro attivo è evidenziato e disattivabile con «Tutti».
    await page.getByRole("link", { name: "Tutti" }).click();
    await expect(page).not.toHaveURL(/kind=/);
    await expect(page.getByText("203.0.113.11")).toBeVisible();

    // Filtro su un tipo senza eventi recenti: lista vuota con messaggio dedicato.
    // (dal registry icone il glifo 🚫 è un <UiIcon>, il messaggio porta solo il testo)
    await page.goto("/admin/shield?kind=ban");
    await expect(page.getByText(/Nessun evento di tipo «Ban»/)).toBeVisible();

    // Un filtro sconosciuto non deve rompere nulla (torna «tutti»).
    await page.goto("/admin/shield?kind=tipo_inventato");
    await expect(page.getByText("Eventi recenti", { exact: true })).toBeVisible();
  });

  test("pannello reset password: esiti classificati e conteggi 24h", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(CAPO.email);
    await page.getByLabel("Password").fill(CAPO.password);
    await page.getByRole("button", { name: /entra/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });

    // L'audit è APPEND-ONLY (rule no_delete): il seed non può pulire i run
    // precedenti. Attori UNICI per run + asserzioni relative: i rerun non
    // falsano i controlli e le righe storiche restano nel log per design.
    const run = Date.now();
    await dbExec(
      `insert into audit_log (actor, action, detail, created_at) values
       ($1, 'password.reset_request', 'email inviata', now() - interval '2 hours'),
       ($2, 'password.reset_request', 'invio fallito: Email non configurata: completa server e credenziali.', now() - interval '3 hours'),
       ($3, 'password.reset_request', 'invio fallito: SMTP timeout', now() - interval '4 hours'),
       ($4, 'password.reset_done', 'self-service', now() - interval '5 hours'),
       ($5, 'password.reset_request', 'email inviata', now() - interval '30 hours')`,
      [
        `run${run}-ok@e2e.local`,
        `run${run}-smtp@e2e.local`,
        `run${run}-timeout@e2e.local`,
        `run${run}-done@e2e.local`,
        `run${run}-vecchio@e2e.local`,
      ],
    );

    await page.goto("/admin/shield");
    await expect(page.getByRole("heading", { name: /reset password — tentativi recenti/i })).toBeVisible();
    // Conteggi 24h relativi: le 3 richieste nostre entro 24h + eventuali run
    // precedenti; i 2 falliti nostri devono comparire nel contatore.
    const richieste = await page.getByText(/\d+ richieste \(24h\)/).textContent();
    const falliti = await page.getByText(/\d+ invii falliti \(24h\)/).textContent();
    expect(parseInt(richieste ?? "0", 10)).toBeGreaterThanOrEqual(3);
    expect(parseInt(falliti ?? "0", 10)).toBeGreaterThanOrEqual(2);
    // Le classificazioni compaiono (first(): l'audit è append-only e la
    // finestra è 48h/limit 12 — con la suite che accumula righe reali della
    // spec password-reset, le POSIZIONI non sono il contratto del pannello;
    // la classificazione e la leggibilità dei dettagli sì, in ogni scenario:
    // DB fresco → i seed coprono tutti gli esiti; suite accumulata → le righe
    // reali di password-reset li copiano comunque).
    await expect(page.getByText(/email inviata/).first()).toBeVisible();
    await expect(page.getByText(/invio fallito/).first()).toBeVisible();
    await expect(page.getByText(/password cambiata/).first()).toBeVisible();
    // Almeno un attore è renderizzato (colonna leggibile).
    await expect(page.getByText(/@e2e\.local/).first()).toBeVisible();
  });
});
