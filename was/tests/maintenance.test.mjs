/**
 * TEST MODALITÀ MANUTENZIONE — le decisioni del cancello vivono in moduli
 * puri (maintenance-shared) e in testi dichiarati: si verificano senza DB e
 * senza server, con lo stesso metodo del repo (leggere le decisioni dove
 * vivono + eseguire le funzioni pure).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");

// Le funzioni pure di maintenance-shared sono importabili senza DB (il proxy
// le usa: non deve mai tirarsi dietro pg). Eseguiamo davvero parse e default.
const shared = await import(path.join(ROOT, "src", "lib", "maintenance-shared.ts"));
const { sanitizeMaintenanceConfig, MAINTENANCE_KEY, MAINTENANCE_TITLE, MAINTENANCE_DEFAULT_SUB } = shared;

const proxySrc = readFileSync(path.join(ROOT, "src", "proxy.ts"), "utf8");
const pageSrc = readFileSync(path.join(ROOT, "src", "app", "maintenance", "page.tsx"), "utf8");
const actionSrc = readFileSync(path.join(ROOT, "src", "app", "admin", "actions.ts"), "utf8");
const publicOnlySrc = readFileSync(path.join(ROOT, "src", "components", "public-only.tsx"), "utf8");
const destinationsSrc = readFileSync(path.join(ROOT, "src", "lib", "admin-destinations.ts"), "utf8");

/* ── logica pura: sanitize + default ─────────────────────────────── */

test("sanitize: default spento quando la config è assente o corrotta", () => {
  for (const raw of [null, undefined, "garbage", 42, {}, []]) {
    const c = sanitizeMaintenanceConfig(raw);
    assert.equal(c.active, false, `active deve ricadere su false con ${JSON.stringify(raw)}`);
    assert.equal(c.message, "");
    assert.equal(c.backOnline, "");
  }
});

test("sanitize: input corretto passa, input sbagliato ricade senza lanciare", () => {
  const ok = sanitizeMaintenanceConfig({ active: true, message: "  Siamo in opera  ", backOnline: "entro le 18" });
  assert.deepEqual(ok, { active: true, message: "Siamo in opera", backOnline: "entro le 18" });
  const corr = sanitizeMaintenanceConfig({ active: "sì", message: 7, backOnline: {} });
  assert.equal(corr.active, false);
  assert.equal(corr.message, "");
  assert.equal(corr.backOnline, "");
});

test("sanitize: i limiti di lunghezza proteggono pagina e DB", () => {
  const c = sanitizeMaintenanceConfig({ active: true, message: "x".repeat(500), backOnline: "y".repeat(200) });
  assert.ok(c.message.length <= 280);
  assert.ok(c.backOnline.length <= 60);
});

/* ── proxy: il cancello serve 503 e HTML autonomo ───────────────── */

test("il proxy intercetta con priorità 0 e serve 503 + retry-after (SEO)", () => {
  const gateIdx = proxySrc.indexOf("snap.active");
  const redirectIdx = proxySrc.indexOf("NextResponse.redirect");
  assert.ok(gateIdx !== -1 && redirectIdx !== -1);
  assert.ok(gateIdx < redirectIdx, "la manutenzione deve valere PRIMA dei redirect SEO");
  const gateBranch = proxySrc.slice(gateIdx, proxySrc.indexOf("}", proxySrc.indexOf("retry-after")));
  assert.match(gateBranch, /status: 503/);
  assert.match(gateBranch, /retry-after/);
  assert.match(gateBranch, /no-store/);
});

test("la pagina del cancello è HTML AUTONOMO: niente chat, niente banner, niente dipendenze", () => {
  const fn = proxySrc.slice(proxySrc.indexOf("function maintenanceHtml"), proxySrc.indexOf("export async function proxy"));
  assert.match(fn, /<!doctype html>/);
  assert.doesNotMatch(fn, /import |await |fetch\(/, "la pagina non deve fare I/O né importare nulla a runtime");
  // I requisiti del cliente, tutti nell'HTML generato dal cancello (i link
  // arrivano dagli identificatori condivisi di site.ts, non da stringhe sparse):
  for (const needle of [
    "contacts.whatsapp", // CTA WhatsApp
    "contacts.telHref", // CTA Chiama
    "contacts.phoneDisplay", // numero leggibile sulla CTA
    "mailto:", // info di contatto: email
    "a branch by DDDigital", // mini footer
    "backOnline", // promessa «torna online» opzionale
    "prefers-reduced-motion", // a11y: animazione rispettosa
    "noindex", // mai in indice
  ]) {
    assert.ok(fn.includes(needle), `manca ${needle} nella pagina del cancello`);
  }
  // Contrasto AA: brand 600 su bianco, testo slate su fondo chiaro
  assert.ok(fn.includes("#2653df") && fn.includes("#0f172a"));
});

test("il fallback del cancello è APERTO: API giù o config rotta non chiudono il sito", () => {
  const fn = proxySrc.slice(proxySrc.indexOf("async function loadMaintenance"), proxySrc.indexOf("async function loadSeo"));
  assert.match(fn, /AbortSignal\.timeout/);
  assert.match(fn, /return sanitizeMaintenanceConfig\(null\)/, "errore lettura → default spento");
  assert.match(fn, /MAINTENANCE_TTL_MS/, "cache breve: il toggle diventa pubblico quasi subito");
  // la costante vale 15 secondi (non 60 come la SEO)
  assert.match(proxySrc, /MAINTENANCE_TTL_MS = 15_000/);
});

test("il matcher lascia fuori /maintenance (anteprima React) e /api (nessun loop)", () => {
  const matcher = proxySrc.slice(proxySrc.indexOf("matcher:"), proxySrc.indexOf("};", proxySrc.indexOf("matcher:")));
  // Alternatives del negative-lookahead: le prime due sono api e admin, e
  // /maintenance è esclusa (è l'anteprima React, non deve ricevere il 503).
  assert.match(matcher, /\(\?!api\|admin\|/);
  assert.ok(matcher.includes("|maintenance|"), "l'anteprima React resta fuori dal cancello");
});

test("la rotta config resta dinamica ma usa cache CDN pubblica", () => {
  const routeSrc = readFileSync(path.join(ROOT, "src", "app", "api", "maintenance", "config", "route.ts"), "utf8");
  assert.match(routeSrc, /force-dynamic/);
  assert.match(routeSrc, /vercel-cdn-cache-control/);
  assert.match(routeSrc, /max-age=600/);
  assert.match(routeSrc, /readMaintenanceConfig/);
});

/* ── pagina React: pulita e senza tracciamento ───────────────────── */

test("/maintenance è pulita: niente chat, niente banner, mini footer richiesto", () => {
  // La pagina NON importa widget di layout (chat, consenso, analytics):
  // il controllo è sulle import, non sul testo (il commento può nominarli).
  assert.doesNotMatch(pageSrc, /import .*(Chat|ConsentBanner|Analytics|SiteHeader|Footer)/);
  assert.match(pageSrc, /a branch by DDDigital/);
  assert.match(pageSrc, /contacts\.whatsapp/);
  assert.match(pageSrc, /contacts\.telHref/);
  assert.match(pageSrc, /robots: \{ index: false/);
});

test("PublicOnly esclude /maintenance da footer e CTA sticky", () => {
  assert.match(publicOnlySrc, /\/maintenance/);
});

/* ── admin: audit obbligatorio e wiring completo ─────────────────── */

test("l'action richiede admin, salva su content_settings e registra l'audit", () => {
  const idx = actionSrc.indexOf("export async function saveMaintenanceSettings");
  assert.ok(idx !== -1, "l'action della manutenzione non esiste");
  const block = actionSrc.slice(idx, actionSrc.indexOf("}", actionSrc.indexOf("revalidatePath", idx)));
  const order = (needle) => {
    const at = block.indexOf(needle);
    assert.ok(at !== -1, `manca ${needle}`);
    return at;
  };
  assert.ok(order("requireAdmin()") < order("MAINTENANCE_KEY"), "requireAdmin prima di ogni scrittura");
  assert.ok(block.indexOf("on conflict (key) do update") !== -1, "upsert additivo su content_settings");
  assert.ok(order("logAudit(") > order("MAINTENANCE_KEY"), "l'audit registra l'azione");
  assert.match(block, /maintenance\.toggle/);
});

test("wiring admin: scheda Tools, destinazione palette e pannello client collegato", () => {
  const toolsSrc = readFileSync(path.join(ROOT, "src", "app", "admin", "tools", "page.tsx"), "utf8");
  assert.match(toolsSrc, /\/admin\/tools\/manutenzione/);
  assert.match(destinationsSrc, /\/admin\/tools\/manutenzione/);
  assert.match(destinationsSrc, /Modalità manutenzione/);
  const panelSrc = readFileSync(path.join(ROOT, "src", "components", "maintenance-panel.tsx"), "utf8");
  assert.match(panelSrc, /saveMaintenanceSettings/);
  // Switch on/off tipo sveglia iOS (ruolo switch, stato su aria-checked,
  // knob animato): il click è la conferma, non esiste più la fase confirming.
  assert.match(panelSrc, /role="switch"/, "l'attivazione è uno switch tipo sveglia iOS");
  assert.match(panelSrc, /aria-checked=\{active\}/, "lo switch espone lo stato ad aria-checked");
  assert.match(panelSrc, /chain\.current/, "i click vanno in catena: a raffica vince l'ultimo");
});

test("i testi canonici sono condivisi (pagina React e cancello non divergono)", () => {
  assert.ok(MAINTENANCE_TITLE.length > 10);
  assert.ok(MAINTENANCE_DEFAULT_SUB.length > 20);
  assert.match(pageSrc, /MAINTENANCE_TITLE/);
  assert.match(proxySrc, /MAINTENANCE_TITLE/);
});

test("la chiave vive in content_settings (zero migration: nessun file nuovo in neon/)", () => {
  assert.equal(MAINTENANCE_KEY, "maintenance_mode");
  const storeSrc = readFileSync(path.join(ROOT, "src", "lib", "maintenance-store.ts"), "utf8");
  assert.match(storeSrc, /content_settings/);
  assert.doesNotMatch(storeSrc, /create table|alter table/);
});

/* ── dedup del promemoria backup (30/09) ─────────────────────────── */

const { backupReminderDecidiPure } = await import(
  path.join(ROOT, "src", "lib", "maintenance-shared.ts")
);
const DAY = 24 * 60 * 60 * 1000;
const tick = 15 * 60 * 1000; // il tick di produzione: ogni 15 minuti

const decide = (days, lastAtMs, giàSuonatoA, nowMs = 0) =>
  backupReminderDecidiPure({ days, lastAtMs, nowMs, giàSuonatoA });

test("promemoria backup: suona quando scade la soglia e ZITTISCE per la stessa finestra", () => {
  const ultimo = -9 * DAY; // ultimo backup 9 giorni fa, soglia 7
  // Primo tick oltre soglia: suona…
  assert.equal(decide(7, ultimo, null).due, true);
  // …poi, a distanza di TICK, per lo STESSO giorno: zitto (il difetto di
  // produzione era: un audit ogni 15 minuti per lo stesso avviso).
  for (const t of [tick, 2 * tick, 3 * tick, 23 * tick]) {
    assert.equal(decide(7, ultimo, 9, t).due, false, `a +${t / 60000}min deve tacere`);
  }
  // Il giorno dopo l'età cresce: riarma da sé (niente job di reset).
  assert.equal(decide(7, ultimo, 9, DAY).due, true);
  assert.equal(decide(7, ultimo, 9, DAY).etàGiorni, 10);
});

test("promemoria backup: il NUOVO backup azzera tutto senza reset esplicito", () => {
  const prima = -10 * DAY;
  assert.equal(decide(7, prima, 10, 0).due, false, "già suonato a 10: zitto");
  // Qualcuno fa il backup ADESSO: l'età torna ~0, sotto soglia.
  assert.equal(decide(7, -2 * tick, 10, 0).due, false, "backup fresco: nessun avviso");
  // E quando risupererà la soglia (7 giorni), il ciclo riparte pulito:
  assert.equal(decide(7, -8 * DAY, null, 0).due, true);
});

test("promemoria backup: mai fatto un backup → suona UNA volta sola, non un lamento eterno", () => {
  assert.equal(decide(7, null, null).due, true, "il primo avviso è giusto");
  assert.equal(decide(7, null, 999_999).due, false, "poi zitto finché non esiste un backup");
  assert.equal(decide(7, null, 999_999, 90 * DAY).due, false, "anche a 90 giorni: zitto");
});

test("promemoria backup: guardie di input e configurazione spenta", () => {
  // days = 0 o corrotto: promemoria OFF, mai suona.
  for (const d of [0, -3, NaN, undefined]) {
    assert.equal(decide(d, -30 * DAY, null).due, false);
  }
  // Età negativa (orologio indietro / backup nel futuro): mai in allarme.
  assert.equal(decide(7, +DAY, null).due, false);
  // La soglia resta quella storica in MILLISECONDI (age > 7×24h): a 7g+23h
  // l'avviso c'è GIÀ (è «oltre 7 giorni»), il dedup conta i giorni interi
  // solo per la finestra di silenzio. Non cambiare semantica per strada.
  assert.equal(decide(7, -(8 * DAY - tick), null).due, true);
  assert.equal(decide(7, -(6 * DAY + 12 * 3600 * 1000), null).due, false);
});

test("wiring dedup: il tick marca l'invio e usa la chiave di stato", () => {
  const tickSrc = readFileSync(path.join(ROOT, "src", "app", "api", "cron", "tick", "route.ts"), "utf8");
  assert.match(tickSrc, /markBackupReminderSent/, "il tick deve MARCARE l'avviso inviato (dedup)");
  assert.match(tickSrc, /backupReminderDue\(\)/);
  const maintSrc = readFileSync(path.join(ROOT, "src", "lib", "maintenance.ts"), "utf8");
  assert.match(maintSrc, /backupReminderDecidiPure/, "la regola vive nel puro condiviso, non nel server");
  assert.match(maintSrc, /markBackupReminderSent/, "la scrittura dello stato esiste");
});
