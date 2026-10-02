import { test, expect } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * PROVA DI PRODUZIONE DELLA NAVIGAZIONE ADMIN dopo l'ADR-005 esteso
 * (da lanciare contro un server BUILD con `next start`, non il dev):
 * il loading skeleton (loading.tsx + wac-pulse) non deve rompere login,
 * hub né flussi di salvataggio, e le cache nuove non devono sporcare
 * i dati: il salvataggio resta visibile subito, la pagina si rilegge
 * il DB entro il TTL dichiarato.
 *
 *  1. LOGIN: widget Turnstile di test montato, accesso riuscito su build;
 *     la sessione viene salvata e condivisa (UN solo login per run: il
 *     rate limit dell'login è 8/ora per IP anche in prodlike).
 *  2. HUB: Panoramica, Impostazioni, Tools rendono le schede reali (nessun
 *     skeleton appeso, nulla di «Caricamento»).
 *  3. SKELETON NON INVASIVO: aria-busy nel file, la pagina reale NON è un
 *     skeleton (nessun [data-skeleton] nella pagina renderizzata).
 *  4. SALVATAGGIO: «Risposte rapide» → toast → DB → hub aggiornato (pill
 *     «Personalizzate») senza aspettare la scadenza del TTL.
 *  5. SALVATAGGIO TEMA: l'etichetta onesta «Le modifiche sono solo in
 *     anteprima finché non salvi.» e il bottone disabilitato a riposo non
 *     devono cambiare con il nuovo loading.
 *  6. NAVIGAZIONE: la card «Emoji della chat» vive nella sezione Canali
 *     (spostata da Ticketing il 2026-10-02): card → scheda → back-link
 *     → palette ⌘K, sul build reale.
 */

/**
 * Il DB E2E arriva da .env.e2e (fonte unica del repo) o dall'override
 * E2E_DATABASE_URL: nessun default cablato — i gemelli usano database
 * diversi (wac_e2e / was_e2e) e un default sbagliato sarebbe un seed
 * nel repo sbagliato, con login «Credenziali non valide» inspiegabili.
 */
function resolveDsn(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  try {
    const m = readFileSync(path.join(process.cwd(), ".env.e2e"), "utf8").match(/^DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    // file assente: si cade sul rigetto esplicito sotto.
  }
  throw new Error("DB E2E non risolto: serve .env.e2e con DATABASE_URL (o E2E_DATABASE_URL)");
}

const DSN = resolveDsn();

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

const UTENTE = { email: "adminperf@e2e.local", password: "AdminPerf!2026" };
const RISPOSTA_E2E = "E2E skeleton perf — risposta rapida";
const STATE_FILE = path.join(process.cwd(), "test-results", "admin-prodlike-state.json");

test.describe.configure({ mode: "serial" });

test.describe("Login reale e sessione condivisa", () => {
  test("seed: admin di test e config ripulita", async () => {
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    await dbExec("delete from admin_users where email = $1", [UTENTE.email]);
    await dbExec(`insert into admin_users (email, password_hash, role) values ($1,$2,'admin')`, [
      UTENTE.email,
      hash(UTENTE.password),
    ]);
    // Il selettore hub→DB usa content_settings: riparto da nessuna chiave.
    await dbExec("delete from content_settings where key in ('ticket_quick_replies','site_theme')");
    // Storia PRIMA del taglio per la vista Velocità: righe sintetiche con
    // actor dedicato (riconoscibili in audit) e created_at due giorni fa.
    // Delete-then-insert: il seed resta idempotente tra run ripetuti.
    await dbExec("delete from audit_log where actor = 'e2e-perf-prima'");
    for (const [target, ms] of [
      ["/admin/settings", 2100],
      ["/admin/settings", 1900],
      ["/admin/settings", 2300],
      ["/admin/tools", 2400],
      ["/admin/tools", 2200],
      ["/admin/tools", 2600],
      ["/admin", 1800],
      ["/admin", 1700],
      ["/admin", 1900],
    ] as const) {
      await dbExec(
        `insert into audit_log (actor, action, target, detail, created_at)
         values ('e2e-perf-prima', 'admin.render', $1, $2, now() - interval '2 days')`,
        [target, `${ms}ms`],
      );
    }
  });

  test("LOGIN su build con skeleton di navigazione attivo: sessione salvata per i test dopo", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(UTENTE.email);
    await page.getByLabel("Password").fill(UTENTE.password);
    await page.getByRole("button", { name: /entra/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });

    // Il login gira con loading.tsx attivo: l'arrivo è la dashboard reale,
    // non un skeleton appeso.
    await expect(page.getByRole("heading", { name: "Ultimi 30 giorni" })).toBeVisible();
    await expect(page.locator("[aria-busy='true']")).toHaveCount(0);

    // UN solo login per run: i test dopo riusano i cookie di sessione.
    await page.context().storageState({ path: STATE_FILE });
  });
});

test.describe("Hub e salvataggi con la sessione del login", () => {
  test.use({ storageState: STATE_FILE });

  test("HUB: Panoramica, Impostazioni e Tools rendono le schede reali (niente skeleton appeso)", async ({ page }) => {
    // Impostazioni: le SUE card reali, testo del guscio reale.
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "Impostazioni" })).toBeVisible();
    await expect(page.getByText("Ticketing", { exact: true })).toBeVisible();
    await expect(page.getByText("Risposte rapide", { exact: true })).toBeVisible();
    await expect(page.getByText("Policy SLA per priorità", { exact: true })).toBeVisible();
    await expect(page.locator("[data-skeleton]")).toHaveCount(0);

    // Tools: schede operative + Formazione + Sistema.
    await page.goto("/admin/tools");
    await expect(page.getByRole("heading", { name: "Tools", exact: true })).toBeVisible();
    await expect(page.getByText("Strumenti operativi", { exact: true })).toBeVisible();
    await expect(page.getByText("Formazione", { exact: true })).toBeVisible();
    await expect(page.getByText("Sistema", { exact: true })).toBeVisible();
    await expect(page.locator("[data-skeleton]")).toHaveCount(0);
  });

  test("NAVIGAZIONE emoji chat: card nella sezione Canali → scheda → back-link → ⌘K", async ({ page }) => {
    // 1. HUB: la card vive nella sezione Canali (spostata da Ticketing
    //    il 2026-10-02: la chat pubblica è un canale con cui parla
    //    l'agenzia, non una regola del team). Ogni sezione dell'hub è
    //    un GlassCard (div.glass-solid) col proprio h2.
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "Impostazioni", level: 1 })).toBeVisible();
    const canali = page
      .locator("div.glass-solid")
      .filter({ has: page.getByRole("heading", { name: "Canali", exact: true }) });
    const card = canali.getByRole("link", { name: /Emoji della chat/ });
    await expect(card).toBeVisible();
    // Non è più in Ticketing: la sezione degli agenti non la contiene.
    const ticketing = page
      .locator("div.glass-solid")
      .filter({ has: page.getByRole("heading", { name: "Ticketing", exact: true }) });
    await expect(ticketing.getByRole("link", { name: /Emoji della chat/ })).toHaveCount(0);

    // 2. SCHEDA: la card apre la scheda dedicata.
    await card.click();
    await expect(page).toHaveURL("/admin/settings/emoji-chat");
    await expect(page.getByRole("heading", { name: "Emoji della chat pubblica", level: 1 })).toBeVisible();

    // 3. BACK-LINK: l'header della scheda (SubPageHeader) riporta all'hub
    //    — filtrato sull'h1 per non prendere la voce «Impostazioni» della nav.
    const backLink = page
      .locator("header")
      .filter({ has: page.getByRole("heading", { name: "Emoji della chat pubblica", level: 1 }) })
      .getByRole("link", { name: "Impostazioni", exact: true });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL("/admin/settings");
    await expect(page.getByRole("heading", { name: "Impostazioni", level: 1 })).toBeVisible();

    // 4. PALETTE ⌘K: la destinazione «Emoji della chat» apre la scheda.
    //    Gate di attivazione (stessa ricetta della spec canali-sociali-nav):
    //    il primo evento da tastiera subito dopo goto viene perso, si apre
    //    e chiude la palette col trigger, poi la scorciatoia arriva.
    const dialog = page.getByRole("dialog", { name: "Vai a una scheda dell'admin" });
    await page.getByRole("button", { name: "Vai a… ⌘K" }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(dialog).toBeVisible();
    await page.getByRole("combobox").fill("emoji");
    const opzione = page.getByRole("option", { name: "Emoji della chat", exact: true });
    await expect(opzione).toBeVisible();
    await opzione.click();
    await expect(page).toHaveURL("/admin/settings/emoji-chat");
    await expect(page.getByRole("heading", { name: "Emoji della chat pubblica", level: 1 })).toBeVisible();
  });

  test("SKELETON NON INVASIVO: il markup è aria-busy, la pagina renderizzata non resta mai skeleton", async ({ page }) => {
    const loading = readFileSync(path.join(process.cwd(), "src", "app", "admin", "loading.tsx"), "utf8");
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("data-skeleton");

    for (const hub of ["/admin", "/admin/settings", "/admin/tools"]) {
      await page.goto(hub);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("[data-skeleton]")).toHaveCount(0);
      await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
    }
  });

  test("SALVATAGGIO risposte rapide: toast → DB → hub aggiornato entro il TTL (60s)", async ({ page }) => {
    await page.goto("/admin/settings/risposte-rapide");
    await expect(page.getByRole("heading", { name: "Risposte rapide del ticketing" })).toBeVisible();

    const campo = page.locator("textarea").first();
    await campo.fill(RISPOSTA_E2E);
    await page.getByRole("button", { name: "Salva risposte" }).click();

    // Il toast del salvataggio (admin-toaster, aria-live polite).
    await expect(page.getByText("Risposte rapide salvate")).toBeVisible({ timeout: 15_000 });

    // La verità sta nel DB, non nella UI.
    const { rows } = await dbExec(
      "select value from content_settings where key = 'ticket_quick_replies'",
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].value)).toContain(RISPOSTA_E2E);

    // L'hub rilegge con TTL 60s: la navigazione DOPO il salvataggio deve
    // mostrare le pill vere («Personalizzate», «1 salvata») senza aspettare
    // la scadenza della cache.
    await page.goto("/admin/settings");
    await expect(page.getByText("Ticketing", { exact: true })).toBeVisible();
    await expect(page.getByText("Personalizzate", { exact: true })).toBeVisible({ timeout: 15_000 });
    // HubCount compone la pill con DUE span («1» + «salvate»: l'etichetta
    // non declina al singolare): si asserva lo span dell'etichetta.
    await expect(page.getByText("salvate", { exact: true })).toBeVisible();
  });

  test("SALVATAGGIO tema: il bottone si abilita solo a tocco avvenuto (loading non cambia il flusso)", async ({ page }) => {
    await page.goto("/admin/tools/theme");
    await expect(page.getByRole("heading", { name: "Tema grafico" })).toBeVisible();

    const salva = page.getByRole("button", { name: "Salva tema" });
    await expect(salva).toBeDisabled();
    // La card-anteprima Zendesk: bottone con dentro «Attivo» (se attivo) +
    // «Zendesk · Glossy». Regex non ancorata: il badge Attivo può esserci o no.
    await page.getByRole("button", { name: /Zendesk\s+·\s+Glossy/ }).click();
    await expect(page.getByText("Le modifiche sono solo in anteprima finché non salvi.")).toBeVisible();
    await expect(salva).toBeEnabled();
  });

  test("TELEMETRIA: la vista Velocità legge admin.render e mostra il confronto prima/dopo", async ({ page }) => {
    await page.goto("/admin/tools/perf");
    await expect(page.getByRole("heading", { name: "Velocità dell'admin" })).toBeVisible();

    // Le navigazioni dei test precedenti sono nell'audit (tempi veri, DOPO
    // il taglio); il seed ha scritto anche storia PRIMA sintetica (actor
    // e2e-perf-prima, 2 giorni fa): entrambe le colonne devono esistere.
    // Su build locale il path risolve al bucket /admin (nessun edge header:
    // vedi risolviPath).
    await expect(page.getByText("/admin", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/^prima/).first()).toBeVisible();
    await expect(page.getByText(/^dopo/).first()).toBeVisible();
    // Il confronto numerico c'è: il Δ percentuale della riga è negativo
    // (l'ottimizzazione mostra l'effetto) — la Cell PRIMA porta 1,8s mediana.
    await expect(page.getByText("1,8s")).toBeVisible();

    // Il guscio del confronto: intestazione del taglio + footer della fonte.
    await expect(page.getByText(/Prima \/ dopo le ottimizzazioni/)).toBeVisible();
    await expect(page.getByText(/migration 044/)).toBeVisible();
  });
});
