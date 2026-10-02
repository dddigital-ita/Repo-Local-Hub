import { test, expect, type Page, type Locator } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { portaE2ERepo } from "../../scripts/e2e-port.cjs";

/**
 * E2E FLUSSO OAUTH REALE — Meta (Facebook pagine + Instagram
 * Business) e LinkedIn (organizzazioni): «Collega con Meta» →
 * dialog provider (parametri OAuth verificati) → consenso →
 * callback con code+state → redirect `/admin/settings/social?
 * meta=collegato` → badge verde «N pagine collegate» + righe
 * NUOVE in channel_accounts con secret/token CIFRATI.
 *
 * LA SPEC È PREPARATA, NON ATTIVA: finché le app sandbox non
 * esistono (META_APP_ID/META_APP_SECRET e LINKEDIN_CLIENT_ID/
 * LINKEDIN_CLIENT_SECRET vuote in .env.e2e) i test del flusso
 * vanno in SKIP — solo il gate admin e il CSRF corrono sempre
 * (nessun contatto coi provider). Per attivarla:
 *   1. crea le app: developers.facebook.com/apps (product
 *      «Facebook Login») e linkedin.com/developers/apps
 *      (Auth 2.0, scope w_identity);
 *   2. registra i redirect URI:
 *        http://localhost:3166/api/auth/meta/callback
 *        http://localhost:3166/api/auth/linkedin/callback
 *      (la porta è derivata dal percorso: scripts/e2e-port.cjs);
 *   3. incolla le credenziali in .env.e2e e riavvia l'E2E;
 *   4. l'account Meta deve amministrare una Pagina Facebook
 *      (compare in /me/accounts) e l'account LinkedIn deve
 *      essere amministratore di un'organizzazione.
 *
 * IL CONSENSO È UMANO: il dialog provider chiede il login (se
 * la sessione non c'è) e l'autorizzazione. La spec gira COL
 * BROWSER APERTO (`npx playwright test --headed
 * tests/e2e/social-oauth-flow.spec.ts`): se la sessione c'è,
 * i pulsanti di consenso (Continua come…/OK/Accetta) vengono
 * premuti in automatico (best-effort — i label cambiano per
 * locale/esperimento); altrimenti l'operatore completa
 * login+autorizzazione dentro la finestra Playwright e la spec
 * aspetta fino a 4 minuti. I assert contrattuali (parametri del
 * dialog, redirect_uri, query di ritorno, badge, DB cifrato)
 * corrono dopo, sempre.
 *
 * Guard di sito: la feature esiste solo in Crema (social-oauth),
 * nel gemello non c'è né il pannello né questa spec — niente
 * twin-sync, niente cmp.
 */

/* ── Ambiente E2E (lo stesso parser del dev-server) ─────── */

const PORTA_E2E = Number(process.env.E2E_PORT ?? portaE2ERepo());

/** .env.e2e come lo carica scripts/e2e-dev-server.mjs. */
function envE2e(key: string): string {
  const diretto = process.env[key];
  if (diretto !== undefined) return diretto;
  for (const line of readFileSync(path.resolve(process.cwd(), ".env.e2e"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2];
  }
  return "";
}

const META_APP_ID = envE2e("META_APP_ID").trim();
const META_APP_SECRET = envE2e("META_APP_SECRET").trim();
const LINKEDIN_CLIENT_ID = envE2e("LINKEDIN_CLIENT_ID").trim();
const LINKEDIN_CLIENT_SECRET = envE2e("LINKEDIN_CLIENT_SECRET").trim();

const META_OK = Boolean(META_APP_ID && META_APP_SECRET);
const LINKEDIN_OK = Boolean(LINKEDIN_CLIENT_ID && LINKEDIN_CLIENT_SECRET);
/** CSRF-test sul primo provider configurato (Meta preferito). */
const CSRF_PROVIDER = META_OK ? "meta" : LINKEDIN_OK ? "linkedin" : null;

/** URL base del sito E2E: è il redirect_uri registrato nell'app. */
const SITE_URL = (
  envE2e("NEXT_PUBLIC_SITE_URL").trim().replace(/\/+$/, "") ||
  `http://localhost:${PORTA_E2E}`
);

/* ── DB disposable wac_e2e (stessa ricetta di canali-sociali-nav) ── */

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

const ADMIN = { email: "social-oauth@e2e.local", password: "SocialOauth!22" };

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

/** external_id degli account social già presenti (baseline anti-falsi-positivi). */
async function externalIds(): Promise<string[]> {
  const { rows } = await dbExec(
    `select external_id from channel_accounts
     where channel in ('facebook','instagram','linkedin')
     order by external_id`,
  );
  return rows.map((r) => r.external_id);
}

/** Righe scritte da questa run: pulite in afterAll (DB disposable). */
const externalIdCreati = new Set<string>();

/**
 * Click best-effort sui pulsanti di consenso del dialog provider
 * (label noti; cambiano per locale/esperimento — se non li trova,
 * completa l'operatore nella finestra aperta).
 */
async function clickSePresente(locator: Locator, timeoutMs = 4_000): Promise<void> {
  try {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    await locator.click();
  } catch {
    // Nessun pulsante riconosciuto: consenso manuale dell'operatore.
  }
}

async function consentiProvider(page: Page): Promise<void> {
  await clickSePresente(page.getByRole("button", { name: /continua come/i }));
  await clickSePresente(
    page.getByRole("button", { name: /^(ok|autorizza|accetta|consenti|conferma)$/i }),
  );
}

test.describe.configure({ mode: "serial" });

test.describe("flusso OAuth social reale", () => {
  test("setup: seed admin e2e (per i rerun)", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Social OAuth E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
  });

  test("gate: senza sessione admin l'OAuth non parte mai", async ({ page }) => {
    // GET: metodo non consentito (solo il form POST avvia il flusso).
    const getMeta = await page.request.get("/api/auth/meta/start");
    expect(getMeta.status()).toBe(405);
    const getLinkedin = await page.request.get("/api/auth/linkedin/start");
    expect(getLinkedin.status()).toBe(405);
    // POST senza sessione: redirect al login, MAI al dialog provider.
    for (const provider of ["meta", "linkedin"]) {
      const res = await page.request.post(`/api/auth/${provider}/start`, { maxRedirects: 0 });
      expect(res.status(), `${provider}/start senza sessione`).toBeGreaterThanOrEqual(300);
      expect(res.status()).toBeLessThan(400);
      expect(res.headers().location ?? "").toContain("/admin/login");
    }
  });

  test("flusso Meta REALE: Collega → dialog → consenso → callback → badge verde", async ({ page }) => {
    test.skip(!META_OK, "app Meta non configurate: META_APP_ID/META_APP_SECRET vuote in .env.e2e");
    test.setTimeout(420_000); // il consenso umano (login provider incluso) può durare minuti

    const prima = new Set(await externalIds());
    await login(page);
    await page.goto("/admin/settings/social");
    await expect(page.getByRole("heading", { name: "Canali social", level: 1 })).toBeVisible();

    // App configurata: pulsante attivo e avviso credenziali assente.
    const collega = page.getByRole("button", { name: "Collega con Meta", exact: true }).first();
    await expect(collega).toBeEnabled();
    expect(await page.getByText("Credenziali app non trovate").count()).toBe(0);

    // 1) avvio: POST /api/auth/meta/start → state in cookie httpOnly
    //    → 302 al dialog Meta con i parametri OAuth attesi.
    await collega.click();
    await expect(page).toHaveURL(/facebook\.com\/v\d+(?:\.\d+)*\/dialog\/oauth\?/, { timeout: 240_000 });
    const dialog = new URL(page.url());
    expect(dialog.searchParams.get("client_id")).toBe(META_APP_ID);
    expect(dialog.searchParams.get("redirect_uri")).toBe(`${SITE_URL}/api/auth/meta/callback`);
    expect(dialog.searchParams.get("state"), "state CSRF nel dialog").toBeTruthy();
    expect(dialog.searchParams.get("scope") ?? "").toContain("pages_show_list");

    // 2) consenso (automatico se la sessione c'è, umano altrimenti).
    await consentiProvider(page);

    // 3) callback: code+state → scambio token → upsert → redirect qui.
    await expect(page).toHaveURL(/\/admin\/settings\/social\?/, { timeout: 240_000 });
    const arrivo = new URL(page.url());
    expect(arrivo.searchParams.get("meta")).toBe("collegato");
    expect(Number(arrivo.searchParams.get("pagine") ?? 0)).toBeGreaterThanOrEqual(1);

    // 4) pannello: banner ok + badge verde «N pagine collegate».
    await expect(page.getByText(/Meta collegato: \d+ pagin[ae] Facebook/)).toBeVisible();
    await expect(page.getByText(/^\d+ (pagina|pagine) collegat[ae]$/).first()).toBeVisible();

    // 5) DB: righe NUOVE in channel_accounts, secret + token CIFRATI.
    const nuovi = (await externalIds()).filter((id) => !prima.has(id));
    expect(nuovi.length, "almeno un account facebook/instagram scritto").toBeGreaterThanOrEqual(1);
    const { rows } = await dbExec(
      `select channel, external_id, credentials from channel_accounts where external_id = any($1)`,
      [nuovi],
    );
    for (const r of rows) {
      expect(typeof r.credentials.secretEnc === "string", `secretEnc cifrato (${r.channel} ${r.external_id})`).toBe(true);
      expect(typeof r.credentials.accessTokenEnc === "string", `accessTokenEnc cifrato (${r.channel})`).toBe(true);
      if (r.channel === "facebook") {
        expect(typeof r.credentials.userTokenEnc === "string", "userTokenEnc (token utente 60gg)").toBe(true);
        expect(typeof r.credentials.expiresAt === "string", "scadenza token utente").toBe(true);
      }
    }
    nuovi.forEach((id) => externalIdCreati.add(id));
  });

  test("flusso LinkedIn REALE: Collega → dialog → consenso → callback → badge verde", async ({ page }) => {
    test.skip(!LINKEDIN_OK, "app LinkedIn non configurate: LINKEDIN_CLIENT_ID/LINKEDIN_CLIENT_SECRET vuote in .env.e2e");
    test.setTimeout(420_000);

    const prima = new Set(await externalIds());
    await login(page);
    await page.goto("/admin/settings/social");
    await expect(page.getByRole("heading", { name: "Canali social", level: 1 })).toBeVisible();

    const collega = page.getByRole("button", { name: "Collega con LinkedIn", exact: true });
    await expect(collega).toBeEnabled();
    expect(await page.getByText("Credenziali app non trovate").count()).toBe(0);

    await collega.click();
    await expect(page).toHaveURL(/linkedin\.com\/oauth\/v2\/authorization\?/, { timeout: 240_000 });
    const dialog = new URL(page.url());
    expect(dialog.searchParams.get("response_type")).toBe("code");
    expect(dialog.searchParams.get("client_id")).toBe(LINKEDIN_CLIENT_ID);
    expect(dialog.searchParams.get("redirect_uri")).toBe(`${SITE_URL}/api/auth/linkedin/callback`);
    expect(dialog.searchParams.get("state"), "state CSRF nel dialog").toBeTruthy();
    expect(dialog.searchParams.get("scope")).toBe("w_identity");

    await consentiProvider(page);

    await expect(page).toHaveURL(/\/admin\/settings\/social\?/, { timeout: 240_000 });
    const arrivo = new URL(page.url());
    expect(arrivo.searchParams.get("linkedin")).toBe("collegato");
    expect(Number(arrivo.searchParams.get("organizzazioni") ?? 0)).toBeGreaterThanOrEqual(1);

    await expect(page.getByText(/LinkedIn collegato: \d+ organizzazion[ie]/)).toBeVisible();
    await expect(page.getByText(/^\d+ organizzazion[ie] collegat[ae]$/).first()).toBeVisible();

    const nuovi = (await externalIds()).filter((id) => !prima.has(id));
    expect(nuovi.length, "almeno un'organizzazione linkedin scritta").toBeGreaterThanOrEqual(1);
    const { rows } = await dbExec(
      `select channel, external_id, credentials from channel_accounts where external_id = any($1)`,
      [nuovi],
    );
    for (const r of rows) {
      expect(r.channel).toBe("linkedin");
      expect(r.external_id).toMatch(/^urn:li:organization:/);
      expect(typeof r.credentials.secretEnc === "string", "secretEnc cifrato").toBe(true);
      expect(typeof r.credentials.accessTokenEnc === "string", "accessTokenEnc cifrato").toBe(true);
    }
    nuovi.forEach((id) => externalIdCreati.add(id));
  });

  test("CSRF: callback senza state valido non scrive nulla", async ({ page }) => {
    test.skip(!CSRF_PROVIDER, "nessuna app configurata in .env.e2e");
    await login(page);
    const prima = await externalIds();
    // code+state inventati, nessun cookie di state: la callback
    // deve respingere PRIMA di qualsiasi chiamata al provider.
    await page.goto(`/api/auth/${CSRF_PROVIDER}/callback?code=e2e-attacco&state=e2e-attacco`);
    const chiave = CSRF_PROVIDER === "meta" ? "meta" : "linkedin";
    await expect(page).toHaveURL(new RegExp(`/admin/settings/social\\?.*${chiave}=state_non_valido`));
    await expect(page.getByText("State anti-CSRF non valido o scaduto")).toBeVisible();
    expect(await externalIds(), "nessun upsert dal tentativo").toEqual(prima);
  });

  test.afterAll(async () => {
    await dbExec("delete from admin_users where email = $1", [ADMIN.email]);
    if (externalIdCreati.size > 0) {
      await dbExec("delete from channel_accounts where external_id = any($1)", [[...externalIdCreati]]);
    }
  });
});
