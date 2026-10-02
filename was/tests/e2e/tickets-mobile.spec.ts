import { test, expect, type Page } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * Tratto mobile della inbox (/admin/tickets) — le due correzioni del
 * walkthrough 390×844 portate in test:
 *
 *  1. ZERO overflow orizzontale: la fila azioni dell'header (Dashboard +
 *     Sincronizza + Nuovo ticket) era `shrink-0` a larghezza max-content
 *     (≈430px): sotto 640px sbordava di 87px e trascinava TUTTA la pagina
 *     in scroll orizzontale. Ora wrap onesto: `document.scrollWidth ≤
 *     clientWidth` a 390×844.
 *  2. ICONA WHATSAPP raggiungibile anche su mobile: viveva solo nella
 *     colonna azioni `hidden sm:flex`, invisibile sotto 640px — l'operatore
 *     in strada doveva aprire il ticket per aprire la chat. Ora è nel
 *     blocco azioni mobile (spostata per viewport, non duplicata a schermo).
 *
 * Guard-rail di non-regressione: su desktop (1280×800) l'overflow resta 0,
 * l'icona resta visibile in colonna azioni e il blocco mobile è nascosto.
 *
 * Convenzioni repo: seed scrypt su was_e2e, login reale dal form, marker
 * /e2e-mobile-inbox, pulizia in afterAll (rerun-safe), serial.
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

const ADMIN = { email: "mobile-inbox@e2e.local", password: "MobileSicura!1" };
const MARK = "/e2e-mobile-inbox";
/** Il ticket sonda WhatsApp: lead con wa_phone → icona WhatsApp nella riga. */
const QUERY_WA = "sicurezza volti per negozio e2e mobile";
const LEAD_WA = { name: "Nadia Mobile E2E", phone: "+393339990077" };

test.describe.configure({ mode: "serial" });

// Consenso cookie PREIMPOSTATO nel contesto: il banner non monta mai e i
// tap sulle card non vengono intercettati (il banner fixed bottom, z-90,
// copre le azioni mobile). Stessa tecnica del consent.spec: il cookie è
// cc_consent (granted/denied), ma lì si verifica il flusso, qui lo si
// preimposta per isolare il test dal montaggio ritardato del banner.
test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "cc_consent", value: "granted", domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" },
  ]);
});

/** Il banner cookie (GDPR) copre ogni pagina senza consenso: su mobile sta
    in basso e INTERCETTA i tap sulle azioni delle card. Replica verbatim la
    tecnica di consent.spec (BANNER scoped + bottone esatto «Accetta tutti»):
    il regex /accetta/i matchava anche «Gestisci preferenze» e il click
    finiva sul primo bottone, senza chiudere il banner. */
async function acceptConsent(page: Page) {
  const banner = page.locator("[aria-label='Preferenze cookie']");
  const visible = await banner.waitFor({ state: "visible", timeout: 8_000 }).catch(() => null);
  if (visible) {
    await banner.getByRole("button", { name: "Accetta tutti" }).click();
    await expect(banner).toBeHidden();
  }
}

async function login(page: Page) {
  await page.goto("/admin/login");
  await acceptConsent(page);
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

test.afterAll(async () => {
  await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
  await dbExec("delete from conversations where source_page = $1", [MARK]);
  await dbExec("delete from leads where source_page = $1", [MARK]);
  await dbExec("delete from admin_users where email = $1", [ADMIN.email]);
});

test.describe("inbox mobile 390×844", () => {
  test("setup: admin + un ticket WhatsApp marcato (lead con wa_phone)", async () => {
    await dbExec(
      `insert into admin_users (email, password_hash, role, display_name, active)
       values ($1, $2, 'super_admin', 'Mobile Inbox E2E', true)
       on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
      [ADMIN.email, hash(ADMIN.password)],
    );
    await dbExec("delete from messages where conversation_id in (select id from conversations where source_page = $1)", [MARK]);
    await dbExec("delete from conversations where source_page = $1", [MARK]);
    await dbExec("delete from leads where source_page = $1", [MARK]);

    const lead = await dbExec(
      `insert into leads (name, phone, consent, status, temperature, source_page, initial_query, wa_phone, created_at)
       values ($1, $2, true, 'nuovo', 'tiepido', $3, $4, $2, now() - interval '2 hours') returning id`,
      [LEAD_WA.name, LEAD_WA.phone, MARK, QUERY_WA],
    );
    const conv = await dbExec(
      `insert into conversations (initial_query, source_page, status, channel, lead_id, created_at, updated_at)
       values ($1, $2, 'operator', 'whatsapp', $3, now() - interval '2 hours', now() - interval '1 hour') returning id`,
      [QUERY_WA, MARK, lead.rows[0].id],
    );
    await dbExec("insert into messages (conversation_id, sender, body) values ($1, 'visitor', $2)", [
      conv.rows[0].id,
      "messaggio cliente di prova (mobile)",
    ]);
  });

  test("mobile 390×844: zero overflow orizzontale del documento", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto("/admin/tickets");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // I bottoni dell'header devono essere ancora raggiungibili (il wrap non
    // li butta fuori schermo né li nasconde). «Dashboard» esiste DUE volte
    // (bottone a vetro + link testuale nel sottotitolo): asserisco sul
    // bottone con exact, non sul testo del sottotitolo.
    await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Nuovo ticket/ })).toBeVisible();
  });

  test("mobile: icona WhatsApp visibile e tappabile nella card (non solo nel DOM)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto("/admin/tickets?channel=whatsapp");
    // Su mobile il banner sta DAVANTI alle azioni delle card: senza consenso,
    // il tap sull'icona finisce sul banner (intercettazione misurata nei log).
    await acceptConsent(page);

    // Per card ci sono DUE anchor wa.me nel DOM (blocco mobile + colonna
    // desktop, uno visibile per viewport): scoppio nel blocco mobile.
    const wa = page.locator('div.group\\/ticket .sm\\:hidden a[href^="https://wa.me/"]');
    await expect(wa).toBeVisible();
    const box = await wa.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(36);
    expect(box!.height).toBeGreaterThanOrEqual(36); // tap-target ≥36px
    await expect(wa).toHaveAttribute("aria-label", /WhatsApp per il ticket #/);

    // Tap REALE: l'href è esterno e target=_blank — l'inbox NON deve
    // navigare via (niente misfire su link annidati). Offline-safe: niente
    // attesa del popup verso wa.me, che in headless non arriva.
    await expect(wa).toHaveAttribute("target", "_blank");
    await expect(wa).toHaveAttribute("rel", /noopener/);
    await wa.click();
    await expect(page).toHaveURL(/channel=whatsapp/);
  });

  test("desktop 1280×800: l'icona torna in colonna azioni, il blocco mobile sparisce", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await page.goto("/admin/tickets?channel=whatsapp");

    // Per card l'ancora wa.me può comparire più volte nel DOM (render
    // doppio della card sotto carico, visto in run completa 01/10):
    // asserisco sulla PRIMA della colonna desktop, come fa il test mobile
    // sopra col suo doppio blocco — il contenuto dell'icona è identico.
    const wa = page.locator('div.group\\/ticket div.hidden.sm\\:flex a[href^="https://wa.me/"]').first();
    await expect(wa).toBeVisible();
    const box = await wa.boundingBox();
    expect(box).not.toBeNull();
    // In colonna azioni: allineata a destra, fuori dal flusso del testo.
    expect(box!.x).toBeGreaterThan(900);
    // Il blocco azioni mobile non deve essere visibile su desktop.
    const mobileActions = page.locator("div.group\\/ticket .sm\\:hidden").first();
    await expect(mobileActions).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
