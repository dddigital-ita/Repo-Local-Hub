/**
 * TEST CHAT PREZZI — sentinella del disallineamento prezzi (visto sul vivo:
 * Ambrosio citava «da 800 €» dal seed mentre la home diceva «da 1.000 €»).
 *
 * Su altro sito (Web Agency Salento) l'audit prezzi ha beccato 3 scarti
 * prima del go-live: questa sentinella rende la lezione permanente. Tre
 * garanzie, tutte leggendo i SORGENTI (niente DB nei test Node):
 *   1. Il prompt di Ambrosio include il catalogo e VIETA cifre inventate
 *      (istruzione esplicita «cita il prezzo esatto, senza inventare»).
 *   2. Le cifre del catalogo (seed SQL) e quelle delle FAQ landing
 *      (site.ts) coincidono per le fasce chiave (vetrina, e-commerce,
 *      SEO): una cifra landing deve avere una corrispondente in catalogo.
 *   3. L'audit esiste ed è eseguibile (scripts/audit-prices.mjs): la
 *      diagnosi resta a portata di comando.
 *
 * Esecuzione: `npm test` (node --test).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (...p) => readFileSync(path.join(ROOT, ...p), "utf8");

/** Cifre in € da un testo (stesso pattern di scripts/audit-prices.mjs). */
function euroFigures(text) {
  return [...text.matchAll(/(\d{1,3}(?:\.\d{3})+|\d{2,6})(?:\s*[–-]\s*(\d{1,3}(?:\.\d{3})+|\d{2,6}))?\s*€/g)]
    .flatMap((m) => [m[1], m[2]].filter(Boolean))
    .map((n) => Number(n.replace(/\./g, "")));
}

test("il prompt di Ambrosio cita il catalogo con il divieto esplicito di inventare cifre", () => {
  const shared = read("src", "lib", "packages-shared.ts");
  assert.match(
    shared,
    /cita il NOME ESATTO/i,
    "istruzione «cita il prezzo esatto» presente nel prompt",
  );
  assert.match(
    shared,
    /senza inventare cifre/i,
    "divieto esplicito «senza inventare cifre» nel prompt",
  );
  // Il blocco porta price_text riga per riga: la cifra arriva dal DB, non dal modello.
  assert.match(shared, /p\.price_text/, "riga del prompt include price_text del DB");
  // I due cataloghi sono separati e usati per scopi diversi (035).
  assert.match(shared, /PACCHETTI DA PROPORRE/, "sezione pacchetti");
  assert.match(shared, /SERVIZI DA PROPORRE/, "sezione servizi (migration 035)");
});

test("fasce chiave: ogni cifra dichiarata nelle landing ha un riscontro nel catalogo seed", () => {
  const seed = read("neon", "migrations", "006-packages.sql");
  const seed35 = (() => {
    try { return read("neon", "migrations", "035-service-kind.sql"); } catch { return ""; }
  })();
  const seedPrices = euroFigures(seed + "\n" + seed35);

  const site = read("src", "lib", "site.ts");
  // Le cifre delle FAQ/contenuti pubblico. ESCONO dal confronto:
  //  - sotto 300 €: annotazioni di costo terzi (foto oraria, hosting, dominio),
  //    non prezzi dei pacchetti;
  //  - 3.000/8.000 € e le fasce «da X a Y»: intervalli dichiarati come
  //    ORIENTAMENTO sulle landing («fino a 8.000 per configurazioni B2B»),
  //    intenzionalmente sopra il prezzo d'ingresso del catalogo. Quello che
  //    la sentinella protegge è il PREZZO D'INGRESSO: la cifra «da …» che
  //    Ambrosio cita in chat deve coincidere con la stessa cifra pubblica.
  const landingFigures = [...new Set(euroFigures(site))].filter((n) => n >= 300 && n < 3000);
  const tolerance = 0.06; // 6%: 1.000 vs 1.500 NON passano, 1.500 vs 1.500 sì
  const orphans = landingFigures.filter(
    (f) => !seedPrices.some((c) => Math.abs(c - f) / Math.max(c, f) <= tolerance),
  );
  assert.deepEqual(
    orphans,
    [],
    `Cifre di prezzo d'ingresso citate nelle landing senza corrispondenza nel catalogo: ${orphans.join(", ")} €.\n` +
      `Ogni «da … €» pubblico deve esistere nel catalogo (packages): il cliente vede due verità` +
      ` diverse tra home e chat (difetto visto sul vivo). Allinea il seed, le FAQ, o aggiungi la voce.`,
  );
});

test("l'audit prezzi esiste, è documentato e copre DB e seed", () => {
  const script = read("scripts", "audit-prices.mjs");
  assert.match(script, /--seed/, "modalità seed (senza DB)");
  assert.match(script, /price_text|priceText/, "legge price_text del catalogo");
  assert.match(script, /TOLERANCE_PCT/, "soglia di tolleranza configurabile");
  assert.match(
    script,
    /--tolerance/,
    "flag --tolerance per allentare quando le fasce sono una scelta consapevole",
  );
});
