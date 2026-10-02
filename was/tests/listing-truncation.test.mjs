/**
 * ONESTÀ SUL TRONCAMENTO DELLE LISTE ADMIN — guard di SITO
 * (variante Salento della famiglia gemello-pari; la gemella
 * Crema è tests/listing-truncation.test.mjs, STESSO nome,
 * NON byte-identica: le pagine divergono).
 * Decisione condivisa: leads e clients hanno `limit 200` fisso
 * mentre i KPI contano con count(*) GLOBALE — con 201+ righe
 * l'utente vedeva «Tutti 201» e 200 card senza spiegazione.
 * La regola qui (pura): la notice esce SOLO quando il totale
 * supera il limite e la lista NON è filtrata (con ?q o
 * ?aperti=1 il conteggio è dei risultati: il troncamento
 * globale non è pertinente).
 *
 * DIVERGENZE DEL GEMELLO (dichiarate, non drift):
 *  - leads: qui il conteggio è SEGMENTATO (?company=…) e la
 *    notice convive col banner «Segmento filtrato» (i conteggi
 *    delle tab restano globali per design): il predicato è
 *    `counts.totale > leads.length`. Crema: `totale > leads.length`
 *    su count(*) globale, leads senza filtri;
 *  - clients: qui la via d'uscita COMPLETA è Notion/CSV (il
 *    sync portafoglio); Crema ha la route /api/admin/clients.csv
 *    (il guard gemello asserisce clients.csv).
 * Le due pagine implementano la STESSA decisione: qui la
 * verifichiamo una volta sola, come fonte (le pagine non si
 * copiano a vicenda, citano la stessa semantica).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** La decisione, estratta dalle due pagine: fonte della verità del test. */
function noticeTroncamento(totale, mostrati, filtrata) {
  if (filtrata) return null;
  return totale > mostrati ? { totale, mostrati } : null;
}

test("regola: oltre il limite la notice esce coi numeri veri", () => {
  const n = noticeTroncamento(257, 200, false);
  assert.ok(n, "con 257 lead e 200 card la notice deve uscire");
  assert.equal(n.totale, 257);
  assert.equal(n.mostrati, 200);
});

test("regola: sotto il limite silenzio (nessun allarme falso)", () => {
  assert.equal(noticeTroncamento(200, 200, false), null, "esattamente al limite: tutto visibile, nessuna notice");
  assert.equal(noticeTroncamento(12, 200, false), null);
});

test("regola: lista filtrata MAI notice (il conteggio è dei risultati)", () => {
  assert.equal(noticeTroncamento(257, 37, true), null);
});

test("le due pagine implementano la stessa decisione (stesso predicato, stessa famiglia)", () => {
  const leads = readFileSync(path.join(ROOT, "src/app/admin/leads/page.tsx"), "utf8");
  const clients = readFileSync(path.join(ROOT, "src/app/admin/clients/page.tsx"), "utf8");
  // Entrambe confrontano il TOTALE globale con le righe mostrate —
  // qui leads conta anche i segmenti (counts.totale, ?company=).
  assert.match(leads, /counts\.totale > leads\.length/);
  assert.match(clients, /counts\.total > clients\.length/);
  // …e clients esclude le liste filtrate (?q / ?aperti=1).
  assert.match(clients, /!q && !openOnly/);
  // Entrambe offrono l'export COMPLETO come via d'uscita
  // (invariante del segmento): leads via CSV segmentato…
  assert.match(leads, /export CSV/);
  // …clients via Notion/CSV (divergenza: Crema ha la route clients.csv).
  assert.match(clients, /Notion\/CSV/);
});
