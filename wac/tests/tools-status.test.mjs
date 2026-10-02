/**
 * STATI DELL'HUB TOOLS — regole dei badge verificate dove vivono.
 * Come `settings-status.test.mjs`: import diretto del .ts puro, nessuna
 * costante duplicata. Le date del backup sono iniettate per test
 * deterministici (niente sleep, niente mock di Date.now).
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  themeStatus,
  backupStatus,
  googleKitStatus,
} = await import("../src/lib/tools-status.ts");

const NOW = Date.parse("2026-09-26T12:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();

test("tema: personalizzato solo con almeno un colore dell'agenzia", () => {
  const def = themeStatus(null);
  assert.equal(def.label, "Predefinito");
  assert.equal(def.warn, false, "default non è un problema");

  const withPrimary = themeStatus({ primary: "#0ea5e9" });
  assert.equal(withPrimary.label, "Personalizzato");
  assert.equal(withPrimary.ok, true);

  const accentOnly = themeStatus({ accent: "#f97316" });
  assert.equal(accentOnly.label, "Personalizzato");

  const empty = themeStatus({ primary: "", accent: null });
  assert.equal(empty.label, "Predefinito");
});

test("backup: mai eseguito e errore recente sono ambra, il successo è verde", () => {
  const never = backupStatus({ available: true, lastCreated: null, lastError: null });
  assert.equal(never.label, "Mai eseguito");
  assert.equal(never.warn, true, "nessun backup = azione attesa");

  const errored = backupStatus({
    available: true,
    lastCreated: daysAgo(9),
    lastError: daysAgo(1),
  });
  assert.equal(errored.label, "Errore ultimo");
  assert.equal(errored.warn, true, "errore più recente del successo");

  const healed = backupStatus({
    available: true,
    lastCreated: daysAgo(1),
    lastError: daysAgo(3),
  });
  assert.equal(healed.ok, true, "un successo dopo l'errore guarisce lo stato");

  const fresh = backupStatus({ available: true, lastCreated: daysAgo(0), lastError: null, now: NOW });
  assert.equal(fresh.label, "Ultimo: oggi");

  const old = backupStatus({ available: true, lastCreated: daysAgo(5), lastError: null, now: NOW });
  assert.equal(old.label, "Ultimo: 5 gg");
  assert.equal(old.warn, false, "vecchio ma valido: verde, la soglia non è definita");
});

test("backup: date malformate ignorate, ambiente senza DB resta neutro", () => {
  const broken = backupStatus({ available: true, lastCreated: "non-una-data", lastError: null });
  assert.equal(broken.label, "Mai eseguito", "data illeggibile = nessun backup dimostrabile");
  assert.equal(broken.warn, true);

  const noDb = backupStatus({ available: false, lastCreated: null, lastError: null });
  assert.equal(noDb.label, "Non disponibile");
  assert.equal(noDb.warn, false, "non è una mancanza di backup: è un ambiente senza DB");
});

test("google kit: regola unica (collegato = credenziali GSC) condivisa col registro", () => {
  const off = googleKitStatus(false, 0);
  assert.equal(off.label, "Da collegare");
  assert.equal(off.warn, true);
  assert.deepEqual(off.counts, []);

  const on = googleKitStatus(true, 2);
  assert.equal(on.label, "Collegato");
  assert.deepEqual(on.counts, [{ n: 2, label: "snippet attivi" }]);
});

test("contratto chiavi stabili per l'hub Tools", () => {
  assert.equal(themeStatus(null).key, "theme");
  assert.equal(backupStatus({ available: false, lastCreated: null, lastError: null }).key, "backup");
  assert.equal(googleKitStatus(false, 0).key, "google-kit");
});

/* ── GOOGLE CALENDAR: regole pure della sync callback → evento ───── */

const gcal = await import("../src/lib/gcal-shared.ts");

test("gcal: il titolo dichiara SEMPRE chi prende l'impegno (il bot si firma)", () => {
  assert.equal(gcal.gcalEventTitle("Rossi", "Michele", false), "Appuntamento con Rossi — Michele");
  assert.equal(gcal.gcalEventTitle("Rossi", null, true), "Appuntamento con Rossi — Ambrosio AI");
  assert.equal(gcal.gcalEventTitle(null, "Daniele", false), "Appuntamento con cliente — Daniele");
  assert.equal(gcal.gcalEventTitle(null, null, false), "Appuntamento con cliente — Team");
  // Titolo entro 120 caratteri anche con nomi lunghissimi.
  assert.ok(gcal.gcalEventTitle("X".repeat(200), null, false).length <= 120);
});

test("gcal: descrizione con contesto utile e niente righe vuote", () => {
  const full = gcal.gcalEventDescription({
    phone: "+39 333 1234567",
    service: "E-commerce",
    slot: "Domani alle 09:00",
    conversationId: "conv-123",
  });
  assert.ok(full.includes("Telefono: +39 333 1234567"));
  assert.ok(full.includes("Servizio: E-commerce"));
  assert.ok(full.includes("Conversazione: conv-123"));
  const empty = gcal.gcalEventDescription({ phone: null, service: null, slot: null, conversationId: null });
  assert.equal(empty, "Appuntamento registrato dal gestionale dell'agenzia.");
  assert.ok(!empty.includes("null"), "mai la stringa «null» nell'evento");
});

test("gcal: finestra evento di 30 minuti a partire dall'inizio", () => {
  const start = new Date("2026-09-28T07:30:00.000Z");
  const win = gcal.gcalEventWindow(start);
  assert.equal(win.start.getTime(), start.getTime());
  assert.equal(win.end.getTime(), start.getTime() + 30 * 60_000);
});

test("gcal: scope dedicato e durata come costanti condivise (mai cablate)", () => {
  assert.equal(gcal.GCAL_SCOPE, "https://www.googleapis.com/auth/calendar");
  assert.equal(gcal.GCAL_EVENT_DURATION_MIN, 30);
  // Il modulo server usa il layer puro: nessuna definizione parallela.
});

test("gcal wiring: hook agganciati a TUTTI i percorsi callback (nessun buco)", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  // 1. Widget pubblico (API callback).
  assert.match(read("../src/app/api/callback/route.ts"), /queueGCalSyncForCallback/);
  // 2. Tool di Ambrosio (fissa_callback).
  assert.match(read("../src/lib/ai-tools.ts"), /queueGCalSyncForCallback\(pool, ins\.rows\[0\]\.id/);
  // 3. Azioni admin: fissata da ticket, conclusa, richiama-ora, eliminata.
  const actions = read("../src/app/admin/actions.ts");
  assert.match(actions, /queueGCalSyncForCallback\(pool, ins\.rows\[0\]\.id, "create"\)/);
  assert.match(actions, /queueGCalSyncForCallback\(pool, id, "delete"\)/);
  assert.match(actions, /rescheduleGCalEvent\(pool, id, new Date\(\)\)/);
  // 4. Via EMAIL: la conferma con orario del cliente nel ticket diventa
  //    callback e parte con lo stesso hook degli altri canali.
  assert.match(read("../src/lib/email-tools.ts"), /queueGCalSyncForCallback\(pool, cb\.rows\[0\]\.id, "create"\)/);
  // 5. Il modulo esporta l'hook e il backfill (garantie UI).
  const lib = read("../src/lib/google-calendar.ts");
  assert.match(lib, /export async function queueGCalSyncForCallback/);
  assert.match(lib, /export async function backfillGCalEvents/);
});

test("gcal diagnostica: lib, azione e UI agganciate (nessun bottone morto)", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const lib = read("../src/lib/google-calendar.ts");
  // La lib espone la tripla diagnostica: lettura, retry, tipi.
  assert.match(lib, /export async function getGCalDiagnostics/);
  assert.match(lib, /export async function retryFailedGCalSync/);
  assert.match(lib, /interface GCalDiagnostics/);
  // L'azione admin c'è, è protetta e scrive in audit.
  const actions = read("../src/app/admin/actions.ts");
  assert.match(actions, /export async function retryGCalAction/);
  assert.match(actions, /retryFailedGCalSync\(10\)/);
  assert.match(actions, /logAudit\(user\.email, "gcal\.retry"/);
  // La scheda usa la diagnostica e ha il bottone collegato all'azione.
  const page = read("../src/app/admin/settings/google-calendar/page.tsx");
  assert.match(page, /getGCalDiagnostics\(\)/);
  assert.match(page, /retryGCalAction/);
});

/* ── EMAIL → CALENDARIO: conferme cliente = callback = evento ────── */

const emailShared = await import("../src/lib/email-tools-shared.ts");

test("email: conferma con orario rilevata e etichetta leggibile", () => {
  const d = emailShared.detectEmailAppointment("Perfetto, domani alle 10 va benissimo, la aspetto.");
  assert.equal(d.confirmed, true);
  assert.equal(d.slotLabel, "domani alle 10:00");
});

test("email: niente orario = niente appuntamento", () => {
  assert.equal(emailShared.detectEmailAppointment("Grazie, sentiamoci la prossima settimana.").confirmed, false);
});

test("email: annullamento esplicito MAI trattato come conferma", () => {
  const d = emailShared.detectEmailAppointment("Mi dispiace, non riesco domani alle 10, possiamo spostare?");
  assert.equal(d.confirmed, false);
  assert.equal(d.negated, true);
  assert.ok(d.slotLabel !== null); // lo slot c'è: è la negazione a decidere
});

test("email: anche le cancellazioni nette senza orario restano neutre", () => {
  assert.equal(emailShared.detectEmailAppointment("Devo annullare l'appuntamento di oggi.").confirmed, false);
});

test("email: la callback nata da email parte a 2 ore (costante, non cablata)", () => {
  assert.equal(emailShared.EMAIL_APPT_HOURS, 2);
});

test("gcal: l'evento dice se il contatto è cliente noto e quanti ticket ha", () => {
  const withClient = gcal.gcalEventDescription({
    phone: "+39 333 1234567",
    service: null,
    slot: "domani alle 10:00",
    conversationId: null,
    clientName: "Rossi SRL",
    clientTickets: 3,
  });
  assert.match(withClient, /Cliente noto: Rossi SRL \(ticket: 3\)/);
  // Anche senza telefono il cliente noto compare: è lui l'informazione chiave.
  assert.match(
    gcal.gcalEventDescription({ phone: null, service: null, slot: null, conversationId: null, clientName: "Bianchi", clientTickets: 0 }),
    /Cliente noto: Bianchi \(ticket: 0\)/,
  );
});

test("gcal: senza info portafoglio la descrizione resta esattamente com'era", () => {
  const d = gcal.gcalEventDescription({ phone: "+39 333 1234567", service: "Sito web", slot: null, conversationId: "abc" });
  assert.ok(!d.includes("Cliente noto"));
  assert.match(d, /Telefono: \+39 333 1234567/);
  assert.match(d, /Servizio: Sito web/);
  assert.match(d, /Conversazione: abc/);
});
