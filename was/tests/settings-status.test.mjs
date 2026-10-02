/**
 * STATI DELL'HUB IMPOSTAZIONI — le regole dei badge, verificate dove vivono.
 *
 * Il test importa DIRETTAMENTE `src/lib/settings-status.ts` (type stripping
 * di Node ≥22.6): nessuna costante duplicata, come il test di contrasto
 * parsa i file reali invece di copiare i colori.
 *
 * Copre le decisioni che la UI stampava inline prima dell'estrazione:
 * tre toni (verde = completo, ambra = incompleto con azione attesa,
 * grigio = default/spento di proposito) + conteggi live.
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const m = await import("../src/lib/settings-status.ts");
const {
  quickRepliesStatus,
  slaStatus,
  autoCloseStatus,
  emailStatus,
  whatsappStatus,
  leadFollowupStatus,
  cloudflareStatus,
  EMPTY_WHATSAPP_CONFIG,
  LEAD_FOLLOWUP_DEFAULT_HOURS,
  trainingStatus,
  aiConfigStatus,
  providerStatus,
  hubSummary,
  pendingOf,
  dedupeByKey,
  slaAgendaStatus,
  recallsAgendaStatus,
} = m;

const DEFAULT_REPLIES = ["Frase A", "Frase B"];

test("risposte rapide: predefinite vs personalizzate (l'ordine conta)", () => {
  const def = quickRepliesStatus(DEFAULT_REPLIES, DEFAULT_REPLIES);
  assert.equal(def.label, "Predefinite");
  assert.equal(def.ok, false);
  assert.equal(def.warn, false, "default non è un problema: neutro, non ambra");
  assert.deepEqual(def.counts, [{ n: 2, label: "salvate" }]);

  const custom = quickRepliesStatus(["Frase B", "Frase A"], DEFAULT_REPLIES);
  assert.equal(custom.label, "Personalizzate");
  assert.equal(custom.ok, true);

  const sameButReordered = quickRepliesStatus(["Frase B", "Frase A"], ["Frase B", "Frase A"]);
  assert.equal(sameButReordered.label, "Predefinite", "testo identico → predefinite anche se confrontato con se stesso");
});

test("SLA: attiva solo se almeno una priorità ha ore > 0 (nextReplyH/resolveH)", () => {
  const empty = slaStatus({});
  assert.equal(empty.label, "Predefinita");
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.counts, [{ n: 0, label: "priorità" }]);

  const zeroed = slaStatus({
    alta: { nextReplyH: 0, resolveH: 0 },
    media: { nextReplyH: 0, resolveH: 0 },
  });
  assert.equal(zeroed.label, "Predefinita", "righe a zero non sono configurate");
  assert.equal(zeroed.counts[0].n, 0);

  const mixed = slaStatus({
    alta: { nextReplyH: 1, resolveH: 4 },
    bassa: { nextReplyH: 0, resolveH: 0 },
  });
  assert.equal(mixed.label, "Attiva");
  assert.equal(mixed.ok, true);
  assert.equal(mixed.counts[0].n, 1, "conta solo le priorità con ore > 0");

  // Input non-oggetto (riga DB corrotta): degrade, non lancia.
  assert.equal(slaStatus(null).label, "Predefinita");
  assert.equal(slaStatus("x").label, "Predefinita");
});

test("chiusura automatica: spenta di proposito → neutro, mai ambra", () => {
  const off = autoCloseStatus(0);
  assert.equal(off.label, "Disattivata");
  assert.equal(off.warn, false);
  const on = autoCloseStatus(7);
  assert.equal(on.label, "Ogni 7 gg");
  assert.equal(on.ok, true);
});

test("email: collegata solo con host+utente+password, altrimenti ambra", () => {
  const full = emailStatus({ smtpHost: "smtp.x.it", user: "a@b.it", hasPassword: true });
  assert.equal(full.label, "Collegata");
  assert.equal(full.ok, true);
  assert.equal(full.warn, false);

  for (const partial of [
    { smtpHost: "", user: "a@b.it", hasPassword: true },
    { smtpHost: "smtp.x.it", user: "", hasPassword: true },
    { smtpHost: "smtp.x.it", user: "a@b.it", hasPassword: false },
  ]) {
    const s = emailStatus(partial);
    assert.equal(s.label, "Da collegare");
    assert.equal(s.warn, true, "incompleto = azione attesa → ambra");
    assert.equal(s.ok, false);
  }
});

test("whatsapp: predisposto neutro, credenziali+off ambra, attivo verde", () => {
  const bare = whatsappStatus(EMPTY_WHATSAPP_CONFIG);
  assert.equal(bare.label, "Predisposto");
  assert.equal(bare.warn, false, "Fase 4 spenta di proposito: NON è un problema");

  const configuredOff = whatsappStatus({ phoneNumberId: "123", wabaTokenEnc: "enc", enabled: false });
  assert.equal(configuredOff.label, "Da attivare");
  assert.equal(configuredOff.warn, true, "credenziali presenti ma canale spento: azione attesa");

  const active = whatsappStatus({ phoneNumberId: "123", wabaTokenEnc: "enc", enabled: true });
  assert.equal(active.label, "Attivo");
  assert.equal(active.ok, true);
});

test("follow-up lead: assenza = default 48h attivo, null = OFF esplicito ambra", () => {
  const absent = leadFollowupStatus(undefined);
  assert.equal(absent.label, `Ogni ${LEAD_FOLLOWUP_DEFAULT_HOURS} h`);
  assert.equal(absent.ok, true);
  assert.equal(absent.warn, false);

  const custom = leadFollowupStatus(72);
  assert.equal(custom.label, "Ogni 72 h");

  const off = leadFollowupStatus(null);
  assert.equal(off.label, "Disattivato");
  assert.equal(off.warn, true, "spento esplicitamente: merita un colpo d'occhio");
  assert.equal(off.ok, false);
});

test("addestramento: conteggio FAQ e copertura, ambra solo con domande scoperte", () => {
  const empty = trainingStatus(0, 0);
  assert.equal(empty.label, "Copertura ok");
  assert.equal(empty.ok, true, "zero FAQ con zero domande: nessuna azione attesa");
  assert.deepEqual(empty.counts, [{ n: 0, label: "risposte" }]);

  const gaps = trainingStatus(5, 3);
  assert.equal(gaps.label, "3 da coprire");
  assert.equal(gaps.warn, true);
  assert.equal(gaps.ok, false);
  assert.deepEqual(gaps.counts, [{ n: 5, label: "risposte" }]);

  const single = trainingStatus(1, 0);
  assert.equal(single.counts[0].label, "risposta", "singolare con una sola FAQ");

  const negative = trainingStatus(-2, -5);
  assert.equal(negative.counts[0].n, 0, "input negativo normalizzato");
  assert.equal(negative.label, "Copertura ok");
});

test("configurazione Ambrosio: ambra solo se spento MA con chiave", () => {
  const on = aiConfigStatus(true, true);
  assert.equal(on.label, "Attiva");
  assert.equal(on.ok, true);

  const offWithKey = aiConfigStatus(false, true);
  assert.equal(offWithKey.label, "Da attivare");
  assert.equal(offWithKey.warn, true, "riaccenderlo è possibile: azione attesa");

  const offNoKey = aiConfigStatus(false, false);
  assert.equal(offNoKey.label, "Disattivata");
  assert.equal(offNoKey.warn, false, "attivarlo ora non si può: grigio, il badge giusto è sulla scheda Provider");

  const onNoKey = aiConfigStatus(true, false);
  assert.equal(onNoKey.ok, true, "stato incoerente (attivo senza chiave): l'hub non finge il guasto, lo cattura il Provider");
});

test("provider: senza nessuna chiave ambra, una chiave basta per il verde", () => {
  const missing = providerStatus(false);
  assert.equal(missing.label, "Chiave mancante");
  assert.equal(missing.warn, true);

  const saved = providerStatus(true);
  assert.equal(saved.label, "Chiave salvata");
  assert.equal(saved.ok, true, "fallback opzionale: una sola chiave è una scelta legittima");
});

test("riepilogo hub: conta solo le ambre, le grigie non sono azioni attese", () => {
  const allGood = hubSummary([
    { ok: true, warn: false },
    { ok: false, warn: false },
  ]);
  assert.equal(allGood.ok, true);
  assert.equal(allGood.label, "Nessuna azione attesa", "grigio = default/spento di proposito: nessuna azione dovuta");

  const one = hubSummary([
    { ok: true, warn: false },
    { ok: false, warn: true },
    { ok: false, warn: false },
  ]);
  assert.equal(one.label, "1 scheda da completare");
  assert.equal(one.warn, true);

  const many = hubSummary([
    { ok: false, warn: true },
    { ok: false, warn: true },
    { ok: false, warn: true },
  ]);
  assert.equal(many.label, "3 schede da completare");

  assert.equal(hubSummary([]).label, "Nessuna azione attesa", "hub senza stati valutabili = tutto ok");
});

test("pendingOf: restituisce le chiavi delle sole schede ambra, in ordine", () => {
  const pending = pendingOf([
    { key: "email", warn: true },
    { key: "whatsapp", warn: false },
    { key: "provider", warn: true },
    { warn: true },
  ]);
  assert.deepEqual(pending, ["email", "provider"], "grigie escluse, senza chiave esclusa");
  assert.deepEqual(pendingOf([]), [], "nessuno stato → nessuna scheda in attesa");
});

test("dedupeByKey: gli stati con la stessa chiave contano una volta sola", () => {
  const out = dedupeByKey([
    { key: "provider", warn: true },
    { key: "chiave", warn: true },
    { key: "provider", warn: true },
    { warn: true },
    { key: "chiave", warn: false },
  ]);
  assert.equal(out.length, 3, "cadono i duplicati di provider e chiave; il senza-chiave resta");
  assert.deepEqual(out.map((s) => s.key), ["provider", "chiave", undefined]);
});

test("agenda SLA: rosso per la scadenza violata, ambra per il carico entro SLA", () => {
  const breach = slaAgendaStatus(2, 42);
  assert.equal(breach.label, "2 ticket in ritardo");
  assert.equal(breach.warn, false, "scadenza violata: più grave dell'ambra, non è «incompleto»");
  assert.equal(breach.ok, false);

  const inTime = slaAgendaStatus(0, 3);
  assert.equal(inTime.label, "3 aperti, entro SLA");
  assert.equal(inTime.warn, true, "carico in arrivo: azione attesa oggi");

  const free = slaAgendaStatus(0, 0);
  assert.equal(free.label, "Nessun ticket aperto");
  assert.equal(free.ok, true);

  const negative = slaAgendaStatus(-2, -3);
  assert.equal(negative.label, "Nessun ticket aperto", "input negativo normalizzato");
});

test("agenda richiami: verde solo senza promesse, ambra quando ce ne sono", () => {
  const free = recallsAgendaStatus(0, 0);
  assert.equal(free.label, "Giornata libera");
  assert.equal(free.ok, true);

  const due = recallsAgendaStatus(3, 0);
  assert.equal(due.label, "3 promesse da mantenere");
  assert.equal(due.warn, true);

  const overdue = recallsAgendaStatus(3, 1);
  assert.equal(overdue.label, "1 in ritardo su 3", "la qualifica del lato scaduto vince sul conteggio");
  assert.equal(overdue.warn, false, "scaduto: tono rosso, come il blocco dashboard che assorbe");

  const single = recallsAgendaStatus(1, 1);
  assert.equal(single.label, "1 in ritardo su 1");

  const negative = recallsAgendaStatus(-1, -1);
  assert.equal(negative.label, "Giornata libera");
});

test("cloudflare: attivo solo con entrambe le chiavi, la pill dichiara la fonte", () => {
  const off = cloudflareStatus({ active: false, fromDb: false });
  assert.equal(off.label, "Da configurare");
  assert.equal(off.warn, true, "senza chiavi il captcha è spento: azione attesa (collegarlo è a un click di distanza)");
  assert.equal(off.ok, false);

  const db = cloudflareStatus({ active: true, fromDb: true });
  assert.equal(db.label, "Attivo (DB)");
  assert.equal(db.ok, true);

  const env = cloudflareStatus({ active: true, fromDb: false });
  assert.equal(env.label, "Attivo (env)");
  assert.equal(env.ok, true);
});

test("cloudflare: l'ultimo «Prova verifica» diventa meta della card (mai ambra extra)", () => {
  const noTest = cloudflareStatus({ active: true, fromDb: true });
  assert.deepEqual(noTest.meta, [], "mai eseguito: nessuna meta, la pill non finge una prova");

  const okTest = cloudflareStatus({ active: true, fromDb: true, lastTestOk: true, lastTestAt: "2026-09-28T09:53:52.671Z" });
  assert.match(okTest.meta[0], /^Ultimo test OK · \d{1,2} /, "data corta IT accanto all'esito");
  assert.equal(okTest.warn, false, "la meta non aggiunge ambra: il colore resta alla pill");

  const failed = cloudflareStatus({ active: true, fromDb: false, lastTestOk: false, lastTestAt: "2026-09-28T09:53:52.671Z" });
  assert.match(failed.meta[0], /^Ultimo test fallito · /, "l'esito negativo si vede anche dall'hub: aprire la scheda è la mossa successiva");

  // Date malformate: nessuna meta, mai un «Invalid Date» a video.
  const bad = cloudflareStatus({ active: true, fromDb: true, lastTestOk: true, lastTestAt: "non-una-data" });
  assert.deepEqual(bad.meta, []);
});

test("ogni stato ha una chiave stabile (contratto con l'hub)", () => {
  const keys = [
    quickRepliesStatus([], []).key,
    slaStatus({}).key,
    autoCloseStatus(0).key,
    emailStatus({}).key,
    whatsappStatus(EMPTY_WHATSAPP_CONFIG).key,
    leadFollowupStatus(undefined).key,
    cloudflareStatus({ active: true, fromDb: true }).key,
    trainingStatus(0, 0).key,
    aiConfigStatus(true, true).key,
    providerStatus(true).key,
  ];
  assert.deepEqual(keys, [
    "risposte-rapide",
    "sla",
    "chiusura-automatica",
    "email",
    "whatsapp",
    "lead-followup",
    "cloudflare",
    "addestramento",
    "configurazione",
    "provider",
  ]);
});
