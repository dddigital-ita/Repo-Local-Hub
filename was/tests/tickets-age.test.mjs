/**
 * ETÀ RELATIVA DELLA CODA TICKET — Fase 2 del redesign (assessment
 * docs/tickets-redesign-assessment.md): la riga mostra «3gg» accanto alla
 * data assoluta. La forma breve risponde a «quanto è vecchio», la lunga a
 * «quando è successo»: due domande diverse, una sola fonte di verità
 * (relativeAge in src/lib/tickets.ts, dominio puro testato qui).
 *
 * Il test importa DIRETTAMENTE src/lib/tickets.ts, come la convenzione dei
 * test del progetto (chat-emoji.test.mjs importa settings-status.ts): Node
 * 25 esegue il type stripping, db.ts è importabile perché senza env non ha
 * side effect.
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { relativeAge } = await import("../src/lib/tickets-shared.ts");

/** Base fissa: il test non può dipendere dall'ora della macchina. */
const NOW = new Date("2026-09-30T12:00:00Z");
const minsAgo = (n) => new Date(NOW.getTime() - n * 60_000);

test("relativeAge: minuti sotto l'ora → «Nm»", () => {
  assert.equal(relativeAge(minsAgo(0), NOW), "0m");
  assert.equal(relativeAge(minsAgo(5), NOW), "5m");
  assert.equal(relativeAge(minsAgo(59), NOW), "59m");
});

test("relativeAge: ore sotto il giorno → «Nh»", () => {
  assert.equal(relativeAge(minsAgo(60), NOW), "1h");
  assert.equal(relativeAge(minsAgo(90), NOW), "1h");
  assert.equal(relativeAge(minsAgo(23 * 60 + 59), NOW), "23h");
});

test("relativeAge: giorni sotto le due settimane → «Ngg»", () => {
  assert.equal(relativeAge(minsAgo(24 * 60), NOW), "1gg");
  assert.equal(relativeAge(minsAgo(3 * 24 * 60), NOW), "3gg");
  assert.equal(relativeAge(minsAgo(13 * 24 * 60 + 23 * 60 + 59), NOW), "13gg");
});

test("relativeAge: due settimane e oltre → settimane «Nsett» (mai mesi vaghi)", () => {
  assert.equal(relativeAge(minsAgo(14 * 24 * 60), NOW), "2sett");
  assert.equal(relativeAge(minsAgo(20 * 24 * 60), NOW), "2sett");
  assert.equal(relativeAge(minsAgo(27 * 24 * 60), NOW), "3sett");
});

test("relativeAge: date future (skew o orologi) → mai negativo, «0m»", () => {
  const future = new Date(NOW.getTime() + 30 * 60_000);
  assert.equal(relativeAge(future, NOW), "0m");
  assert.equal(relativeAge(new Date(NOW.getTime() + 5 * 24 * 60 * 60_000), NOW), "0m");
});

test("relativeAge: accetta stringhe ISO e Date (default now = adesso)", () => {
  // Con il default la chiamata usa l'ora reale: forme stabili a distanza fissa.
  const iso = new Date(Date.now() - 3 * 60_000).toISOString();
  assert.equal(relativeAge(iso), "3m");
  assert.equal(relativeAge(new Date(Date.now() - 90 * 60_000)), "1h");
});
