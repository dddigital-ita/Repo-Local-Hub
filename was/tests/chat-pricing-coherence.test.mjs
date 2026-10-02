/**
 * COERENZA LISTINO ↔ CHAT — il ramo scriptato «quanto costa» (chat-script.ts,
 * usato in turno quando Ambrosio AI è spenta) deve citare le STESSE fasce del
 * listino: landing, home, FAQ e prompt di Ambrosio leggono i pacchetti dal DB
 * (seed 006 + migration 036), la chat diurna scrive le cifre nel testo. Se il
 * listino cambia e il testo no, nasce la discordanza vista a fine 2026 —
 * qui la sentinella la ferma PRIMA.
 *
 * Due livelli:
 *  1. coerenza interna: le cifre nel testo del ramo `preventivo_subito`
 *     coincidono con quelle attese (cambio consapevole, non per sbaglio);
 *  2. coerenza col seed: i price_text della migration 036 e del seed 006
 *     citano le stesse cifre che la chat mostra.
 *
 * Esecuzione: `npm test` (node --test).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = readFileSync(join(ROOT, "src/lib/chat-script.ts"), "utf8");

/* ── estrazione del ramo preventivo_subito ────────────────────────── */

function ramoPreventivo() {
  const start = script.indexOf("id: 'preventivo_subito'");
  assert.ok(start > 0, "il ramo preventivo_subito deve esistere in chat-script.ts");
  const body = script.slice(start, start + 900);
  const end = body.indexOf("markHot");
  assert.ok(end > 0, "markHot trovato nel ramo");
  return body.slice(0, end);
}

/* ── 1. il testo della chat cita le fasce del listino ─────────────── */

test("la chat diurna «quanto costa» cita vetrina 1.000, e-commerce 3.000 e SEO 350", () => {
  const ramo = ramoPreventivo();
  assert.match(ramo, /vetrina da 1\.000\s*€/, "manca la fascia vetrina 1.000 €");
  assert.match(ramo, /e-commerce da 3\.000\s*€/, "manca la fascia e-commerce 3.000 €");
  assert.match(ramo, /SEO locale da 350\s*€\/mese/, "manca la fascia SEO 350 €/mese");
});

test("il ramo chat non cita più le cifre Crema (800 / 2.500 / 400)", () => {
  const ramo = ramoPreventivo();
  assert.doesNotMatch(ramo, /\b800\s*€/, "residuo Crema: vetrina 800 €");
  assert.doesNotMatch(ramo, /\b2\.500\s*€/, "residuo Crema: e-commerce 2.500 €");
  assert.doesNotMatch(ramo, /\b400\s*€\/mese/, "residuo Crema: SEO 400 €/mese");
});

test("il ramo avvia comunque la qualifica (il numero esatto arriva dopo il funnel)", () => {
  // La strategia non cambia: prima le fasce, poi il funnel da 10 secondi.
  const ramo = ramoPreventivo();
  assert.match(ramo, /rispondimi a queste domande/, "il funnel di qualifica è scomparso?");
});

/* ── 2. seed e migration citano le stesse cifre ───────────────────── */

test("migration 036 e seed 006 portano le stesse fasce della chat", () => {
  const m36 = readFileSync(join(ROOT, "neon/migrations/036-salento-pricing.sql"), "utf8");
  const m06 = readFileSync(join(ROOT, "neon/migrations/006-packages.sql"), "utf8");
  for (const source of [m36, m06]) {
    assert.match(source, /da 1\.000 € una tantum/, "vetrina 1.000 mancante nel seed/migration");
    assert.match(source, /da 3\.000 € una tantum/, "e-commerce 3.000 mancante nel seed/migration");
    assert.match(source, /da 350 €\/mese/, "SEO 350 mancante nel seed/migration");
  }
});
