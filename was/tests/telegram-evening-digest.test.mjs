/**
 * FORMATO DEL DIGEST SERALE TELEGRAM — le regole verificate dove vivono.
 * Import diretto del .ts (Node ≥22.6 type stripping), come il test del
 * digest mattutino: nessuna costante duplicata, la regressione si vede qui.
 * Le query e l'invio stanno nel layer server (telegram-digest.ts): non
 * girano nei test di node.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const m = await import("../src/lib/telegram-digest-format.ts");
const { isEveningDigestTime, EVENING_DIGEST_WINDOW, eveningDigestLines, eveningDigestHeadline } = m;

const piena = {
  dateLabel: "domenica 28 settembre",
  leads: 3,
  questions: 7,
  handoffs: 1,
  callbacks: [
    { slot: "Domani alle 09:00", name: "Maria Rossi" },
    { slot: "Domani alle 15:00", name: null },
  ],
  leadSources: [
    { label: "web", n: 2 },
    { label: "telegram", n: 1 },
  ],
};

test("finestra serale: 20–23 incluse, fuori finestra no", () => {
  assert.equal(EVENING_DIGEST_WINDOW.startRome, 20);
  assert.equal(EVENING_DIGEST_WINDOW.endRome, 23);
  assert.equal(isEveningDigestTime(20), true);
  assert.equal(isEveningDigestTime(23), true);
  assert.equal(isEveningDigestTime(19), false);
  assert.equal(isEveningDigestTime(0), false);
  assert.equal(isEveningDigestTime(-3), false, "input assurdo → fuori finestra");
});

test("giornata piena: headline sui lead (il numero che conta di più guida)", () => {
  assert.match(eveningDigestHeadline(piena), /3 nuovi lead/);
  assert.equal(eveningDigestLines(piena)[0], "🌅 Chiusura — giornata di Ambrosio · domenica 28 settembre");
  assert.match(eveningDigestLines(piena).join("\n"), /3 lead salvati · 7 clienti seguiti · 1 passaggi al team · 2 callback fissate/);
});

test("giornata piena: sezione callback con slot e nome, e ripartizione lead per canale", () => {
  const text = eveningDigestLines(piena).join("\n");
  assert.match(text, /Da richiamare:/);
  assert.match(text, /• Domani alle 09:00 — Maria Rossi/);
  assert.match(text, /• Domani alle 15:00 — cliente/, "lead senza nome → «cliente»");
  assert.match(text, /Lead: 2 da web, 1 da telegram/);
});

test("headline degrada sul numero più vicino: solo callback → callback; solo domande → conversazioni", () => {
  const soloCb = { ...piena, leads: 0, questions: 0, leadSources: [] };
  assert.match(eveningDigestHeadline(soloCb), /2 callback fissate/);
  const soloQ = { ...piena, leads: 0, handoffs: 0, callbacks: [], leadSources: [] };
  assert.match(eveningDigestHeadline(soloQ), /7 conversazioni seguite/);
  const soloHandoff = { ...piena, leads: 0, questions: 0, callbacks: [], leadSources: [], handoffs: 2 };
  assert.match(eveningDigestHeadline(soloHandoff), /casi passati al team/);
});

test("giornata quieta: si dice lo stesso (il silenzio sembrerebbe un digest rotto)", () => {
  const quieta = { ...piena, leads: 0, questions: 0, handoffs: 0, callbacks: [], leadSources: [] };
  const lines = eveningDigestLines(quieta);
  assert.match(lines.join("\n"), /Giornata quieta/);
  assert.match(eveningDigestHeadline(quieta), /giornata quieta/);
  assert.equal(lines.length, 2, "nessuna sezione di numeri o callback");
});

test("più di 8 callback: elenco troncato con contatore, nessuna riga persa a caso", () => {
  const tante = {
    ...piena,
    callbacks: Array.from({ length: 11 }, (_, i) => ({ slot: `Slot ${i + 1}`, name: `Cliente ${i + 1}` })),
  };
  const lines = eveningDigestLines(tante);
  const cb = lines.filter((l) => l.startsWith("•"));
  assert.equal(cb.length, 9, "8 voci + riga «…e altre»");
  assert.match(cb[cb.length - 1], /…e altre 3/);
});

test("fonti con zero non sporchano la riga lead", () => {
  const conZero = { ...piena, leadSources: [{ label: "web", n: 0 }, { label: "telegram", n: 3 }] };
  const text = eveningDigestLines(conZero).join("\n");
  assert.match(text, /Lead: 3 da telegram/);
  assert.ok(!text.includes("0 da web"));
});
