import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AUTOPILONA_SQL,
  autopilotaPlan,
  autopilotaEsito,
  AUTOPILONA_AUDIT_ON,
  AUTOPILONA_AUDIT_OFF,
  FOLLOWUP_DISABLED_SQL,
  followupPlan,
  followupEsito,
  FOLLOWUP_AUDIT_ON,
  FOLLOWUP_AUDIT_OFF,
  FOLLOWUP_NOW_AUDIT,
  followupNowConsentibile,
} from "../src/lib/desk-autopilota-shared.ts";

/**
 * Sentinella dell'AUTO-PILOTA MANUALE (pannello Ambrosio, scheda ticket):
 * la stessa ricetta di channel-registry e client-type — il piano PURO
 * (desk-autopilota-shared.ts) viene verificato qui senza DB né AI, mentre
 * i guard testuali tengono insieme i pezzi impuri (la funzione che esegue
 * il piano e il pannello che lo chiama). Cambiare il contratto del
 * take-over in un posto solo deve ROMPERE la suite, non la fiducia.
 */

const ROOT = process.cwd();

test("il piano di scrittura ha il lock anti-corsa e le impronte del cron", () => {
  // Il lock: un ticket archiviato nel frattempo non viene MAI toccato.
  assert.match(AUTOPILONA_SQL, /archived_at is null/, "manca il lock anti-corsa archived_at is null");
  assert.match(AUTOPILONA_SQL, /where id = \$2 and archived_at is null/, "il lock deve stare nel WHERE accanto all'id");
  assert.match(AUTOPILONA_SQL, /returning ai_takeover_at/, "l'esito deve leggere l'impronta dal RETURNING, non dall'intenzione");

  // Le impronte: stessa convenzione del claim SLA (attiva = now(), rilascio = null).
  const pianoOn = autopilotaPlan(true, "conv-1");
  assert.ok(pianoOn.params[0] instanceof Date, "attiva deve scrivere un timestamp (come ai_takeover_at = now() del cron)");
  const pianoOff = autopilotaPlan(false, "conv-1");
  assert.equal(pianoOff.params[0], null, "disattiva deve scrivere null (come releaseTakeoverClaim)");
  assert.equal(pianoOn.params[1], "conv-1");
  assert.equal(pianoOn.params[0], pianoOn.params[0]); // determinismo del riferimento nel singolo piano

  // Le azioni d'audit sono fisse: niente azioni improvvisate al momento.
  assert.equal(pianoOn.auditAction, "ambrosio.desk.autopilota_on");
  assert.equal(pianoOff.auditAction, "ambrosio.desk.autopilota_off");
  assert.equal(AUTOPILONA_AUDIT_ON, "ambrosio.desk.autopilota_on");
  assert.equal(AUTOPILONA_AUDIT_OFF, "ambrosio.desk.autopilota_off");
});

test("ticket archiviato: zero righe, nessun takeover, nessun audit", () => {
  // Simula la corsa: il cron archivia il ticket mentre l'operatore
  // conferma — l'UPDATE del piano torna ZERO righe perché il lock vince.
  const esito = autopilotaEsito([]);
  assert.equal(esito.ok, false, "zero righe non è mai un successo");
  assert.equal(esito.reason, "ticket_non_trovato_o_archiviato");
  if (!esito.ok) {
    // Zero righe non produce NESSUNA azione d'audit: il log non registra
    // azioni che non sono avvenute.
    assert.ok(!("auditDetail" in esito), "un esito fallito non deve portare un dettaglio d'audit");
  }
});

test("ticket vivo: l'impronta letta dal RETURNING decide audit ed esito", () => {
  const attivato = autopilotaEsito([{ ai_takeover_at: new Date("2026-09-30T18:00:00Z") }]);
  assert.deepEqual(
    { ok: attivato.ok, takeover: attivato.takeover, audit: attivato.ok ? attivato.auditAction ?? attivato.auditDetail : null },
    { ok: true, takeover: true, audit: "takeover attivo manualmente dall'operatore" },
  );

  const rilasciato = autopilotaEsito([{ ai_takeover_at: null }]);
  assert.equal(rilasciato.ok, true);
  assert.equal(rilasciato.takeover, false, "null nel RETURNING = takeover NON attivo");
  assert.equal(rilasciato.auditDetail, "takeover rilasciato manualmente dall'operatore");

  // Il pg driver può consegnare l'impronta come stringa ISO: stesso verdetto.
  const daStringa = autopilotaEsito([{ ai_takeover_at: "2026-09-30T18:00:00.000Z" }]);
  assert.equal(daStringa.takeover, true);
});

test("guard impuri: la funzione esegue il piano e l'audit SOLO sul successo", () => {
  const lib = readFileSync(path.join(ROOT, "src", "lib", "desk-ambrosio.ts"), "utf8");
  const blocco = lib.match(/export async function deskSetAutopilota[\s\S]*?\n\}/);
  assert.ok(blocco, "deskSetAutopilota non trovata in desk-ambrosio.ts");
  const fn = blocco[0];
  assert.match(fn, /autopilotaPlan\(/, "la funzione deve usare il piano puro, non riscrivere l'SQL");
  assert.match(fn, /autopilotaEsito\(/, "l'esito deve passare dal lettore puro");
  // L'audit arriva DOPO il controllo dell'esito: logAudit dentro il ramo ok.
  assert.match(fn, /if \(!esito\.ok\) return[\s\S]*?await logAudit\(/, "logAudit deve venire solo dopo il gate dell'esito");
  assert.match(fn, /reason: esito\.reason/, "il motivo del fallimento arriva intatto al pannello");
});

test("guard UI: il pannello chiede conferma e non è mai silenzioso", () => {
  const pannello = readFileSync(path.join(ROOT, "src", "components", "ticket-desk-ambrosio.tsx"), "utf8");
  assert.match(pannello, /confirm\(/, "il toggle deve chiedere conferma esplicita");
  assert.match(pannello, /action: "autopilota"/, "il pannello deve chiamare l'azione autopilota");
  assert.match(pannello, /action: "autopilota", attiva \}/, "il pannello deve passare il booleano attiva");
  assert.match(pannello, /router\.refresh\(\)/, "dopo il successo la verità torna dal DB");
});

test("guard route: attiva: boolean obbligatorio, 401 prima di tutto", () => {
  const route = readFileSync(path.join(ROOT, "src", "app", "api", "admin", "tickets", "[id]", "ambrosio", "route.ts"), "utf8");
  const indiceAuth = route.indexOf("getAdminUser()");
  const indiceAutopilota = route.indexOf('action === "autopilota"');
  assert.ok(indiceAuth > -1 && indiceAutopilota > -1, "route incompleta");
  assert.ok(indiceAuth < indiceAutopilota, "l'auth deve precedere qualunque validazione d'azione");
  assert.match(route, /typeof body\.attiva === "boolean"/, "attiva deve essere validata come booleano");
  assert.match(route, /richiede attiva: boolean/, "senza attiva la route deve dire cosa manca (autopilota e followup)");
  assert.match(route, /deskSetAutopilota\(/, "la route deve delegare alla funzione della lib");
});

test("il piano follow-up: il flag decide, l'impronta non si tocca", () => {
  const off = followupPlan(false, "conv-1"); // attiva=false → ESCLUDI
  assert.ok(off.params[0] instanceof Date, "escludere deve settare followup_disabled_at (now)");
  assert.equal(off.auditAction, "ambrosio.desk.followup_off");
  assert.match(FOLLOWUP_DISABLED_SQL, /set followup_disabled_at = \$1/, "si scrive il FLAG, non l'impronta");
  assert.ok(!/followup_sent_at/.test(FOLLOWUP_DISABLED_SQL), "l'impronta followup_sent_at non va toccata: cancellarla RIARMEREBBE il cron (dedup)");
  const on = followupPlan(true, "conv-1"); // attiva=true → RIATTIVA
  assert.equal(on.params[0], null, "riattivare rimette il flag a null; la dedup standard torna a decidere");
  assert.equal(on.auditAction, "ambrosio.desk.followup_on");
  assert.equal(FOLLOWUP_AUDIT_ON, "ambrosio.desk.followup_on");
  assert.equal(FOLLOWUP_AUDIT_OFF, "ambrosio.desk.followup_off");
});

test("follow-up su ticket archiviato: zero righe, nessun audit", () => {
  assert.match(FOLLOWUP_DISABLED_SQL, /archived_at is null/, "stesso lock anti-corsa dell'auto-pilota");
  const esito = followupEsito([]);
  assert.equal(esito.ok, false);
  assert.equal(esito.reason, "ticket_non_trovato_o_archiviato");
  if (!esito.ok) assert.ok(!("auditDetail" in esito), "nessun audit su un'azione non avvenuta");
  const escluso = followupEsito([{ followup_disabled_at: new Date() }]);
  assert.equal(escluso.ok, true);
  assert.equal(escluso.followupDisabled, true);
  const riattivato = followupEsito([{ followup_disabled_at: null }]);
  assert.equal(riattivato.followupDisabled, false);
});

test("il cron rispetta l'esclusione (guard su candidati e claim)", () => {
  const cron = readFileSync(path.join(ROOT, "src", "app", "api", "cron", "tick", "route.ts"), "utf8");
  assert.match(cron, /followup_sent_at is null\s*\n\s*and c\.followup_disabled_at is null/, "la selezione candidati deve escludere i ticket esclusi");
  const ai = readFileSync(path.join(ROOT, "src", "lib", "ai-tools.ts"), "utf8");
  assert.match(ai, /opts\.manuale \? "" : " and followup_disabled_at is null"/, "di default (cron) il claim esige il flag a null: doppia difesa anti-corsa col toggle");
  assert.match(ai, /followup_sent_at is null\$\{soloCron\}/, "il claim compone dedup + guard del flag (che il ramo manuale toglie, mai la dedup)");
});

test("guard UI follow-up: conferma e azione dedicata", () => {
  const pannello = readFileSync(path.join(ROOT, "src", "components", "ticket-desk-ambrosio.tsx"), "utf8");
  assert.match(pannello, /action: "followup", attiva \}/, "il pannello deve chiamare l'azione followup col booleano");
  assert.match(pannello, /Escludere questo ticket dal follow-up/, "la conferma dell'esclusione deve dire cosa succede");
  assert.match(pannello, /BellOff/, "il toggle follow-up ha la sua icona");
});

test("la migration 042 aggiunge solo il flag", () => {
  const sql = readFileSync(path.join(ROOT, "neon", "migrations", "042-followup-disabled.sql"), "utf8");
  assert.match(sql, /add column if not exists followup_disabled_at timestamptz/);
  assert.ok(!/drop |update |create table/i.test(sql), "additiva: solo la colonna, idempotente");
});

test("follow-up ora: i blocchi di regola e l'audit col nome dell'operatore", () => {
  assert.equal(FOLLOWUP_NOW_AUDIT, "ambrosio.desk.followup_now");
  const casi = [
    [{ followupSent: true, lastSender: "visitor", status: "operator" }, "dedup"],
    [{ followupSent: false, lastSender: "visitor", status: "closed" }, "chiuso"],
    [{ followupSent: false, lastSender: "visitor", status: "bot" }, "bot"],
    [{ followupSent: false, lastSender: "operator", status: "operator" }, "ultima parola"],
    [{ followupSent: false, lastSender: null, status: "operator" }, "ultima parola"],
  ];
  for (const [input, parola] of casi) {
    const v = followupNowConsentibile(input);
    assert.equal(v.consentito, false, `${parola}: doveva bloccare`);
  }
  const ok = followupNowConsentibile({ followupSent: false, lastSender: "visitor", status: "lead_captured" });
  assert.deepEqual(ok, { consentito: true });
  const okAnche = followupNowConsentibile({ followupSent: false, lastSender: "visitor", status: "waiting_customer" });
  assert.deepEqual(okAnche, { consentito: true });
});

test("follow-up ora: scavalca il flag, MAI la dedup (guard su ai-tools)", () => {
  const ai = readFileSync(path.join(ROOT, "src", "lib", "ai-tools.ts"), "utf8");
  const blocco = ai.match(/export async function sendLeadFollowup[\s\S]*?\n\}/);
  assert.ok(blocco, "sendLeadFollowup non trovata");
  const fn = blocco[0];
  assert.match(fn, /opts\.manuale \? "" : " and followup_disabled_at is null"/, "il ramo manuale deve togliere SOLO il guard del flag");
  assert.match(fn, /followup_sent_at is null\$\{soloCron\}/, "la dedup followup_sent_at vale sempre, da chiunque parta");
  assert.match(fn, /opts\.manuale \? FOLLOWUP_NOW_AUDIT|FOLLOWUP_NOW_AUDIT : "cron\.lead-followup"/, "l'audit manuale usa l'azione dedicata");
});

test("guard UI follow-up ora: conferma che dica UNO solo, nascosto se già partito", () => {
  const pannello = readFileSync(path.join(ROOT, "src", "components", "ticket-desk-ambrosio.tsx"), "utf8");
  assert.match(pannello, /action: "followup_now"/, "il pannello deve chiamare followup_now");
  assert.match(pannello, /UN follow-up per ticket/, "la conferma deve dire la regola UNO solo");
  assert.match(pannello, /\{!followup && \(/, "se il follow-up è già partito il bottone non si mostra");
  assert.match(pannello, /BellRing/, "icona dedicata BellRing");
});

test("guard route: followup_now con 409 per i blocchi di regola", () => {
  const route = readFileSync(path.join(ROOT, "src", "app", "api", "admin", "tickets", "[id]", "ambrosio", "route.ts"), "utf8");
  assert.match(route, /deskFollowupNow\(/, "la route deve delegare a deskFollowupNow");
  assert.match(route, /res\.bloccato \? 409 : 503/, "blocco di regola = 409, guasto = 503");
});

test("coerenza col cron: stessa colonna, stessa convenzione di rilascio", () => {
  const cron = readFileSync(path.join(ROOT, "src", "lib", "ai-tools.ts"), "utf8");
  assert.match(cron, /set ai_takeover_at = now\(\)/, "il claim SLA deve restare sulla stessa impronta del toggle manuale");
  assert.match(cron, /update conversations set ai_takeover_at = null where id = \$1/, "releaseTakeoverClaim è la convenzione di rilascio");
  assert.match(AUTOPILONA_SQL, /ai_takeover_at/, "toggle e cron devono scrivere la STESSA colonna");
});
