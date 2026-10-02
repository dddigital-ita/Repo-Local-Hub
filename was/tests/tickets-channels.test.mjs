/**
 * Regole pure dei canali permanenti della inbox (KNOWN_CHANNELS +
 * mergeChannelCounts, in tickets-shared.ts): i canali con tab permanente
 * esistono anche a 0 conversazioni — la stessa regola che rende valido il
 * ?channel su canale vuoto (bug del 30/09/2026: collassava in «tutti»
 * mostrando le ALTRE chat sotto l'URL del canale). Il merge con righe vive
 * del DB è coperto dall'E2E inbox; qui le regole, direttamente (type
 * stripping, zero import — convenzione del repo per i layer puri).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { KNOWN_CHANNELS, mergeChannelCounts, likeContains } from "../src/lib/tickets-shared.ts";

test("KNOWN_CHANNELS: la banda permanente è web, email, whatsapp — senza duplicati", () => {
  assert.deepEqual([...KNOWN_CHANNELS], ["web", "email", "whatsapp"]);
  assert.equal(new Set(KNOWN_CHANNELS).size, KNOWN_CHANNELS.length);
});

test("zero righe: i canali permanenti esistono a 0, nell'ordine della UI", () => {
  assert.deepEqual(mergeChannelCounts([]), { web: 0, email: 0, whatsapp: 0 });
});

test("canali non noti: nessuno si perde, i permanenti restano a 0", () => {
  const out = mergeChannelCounts([
    { channel: "telegram", n: 4 },
    { channel: "ig_dm", n: 2 },
  ]);
  assert.equal(out.telegram, 4);
  assert.equal(out.ig_dm, 2);
  assert.deepEqual(
    KNOWN_CHANNELS.map((c) => out[c]),
    [0, 0, 0],
  );
});

test("righe sui canali permanenti: i conteggi del DB sovrascrivono lo 0", () => {
  const out = mergeChannelCounts([
    { channel: "whatsapp", n: 7 },
    { channel: "email", n: 1 },
  ]);
  assert.equal(out.whatsapp, 7);
  assert.equal(out.email, 1);
  assert.equal(out.web, 0);
});

test("channel NULL (righe storiche senza canale): conta come web", () => {
  const out = mergeChannelCounts([{ channel: null, n: 3 }]);
  assert.equal(out.web, 3);
  assert.equal(out.email, 0);
});

test("mescolati: permanenti, non noti e NULL in un solo merge coerente", () => {
  const out = mergeChannelCounts([
    { channel: "web", n: 5 },
    { channel: null, n: 2 },
    { channel: "telegram", n: 4 },
  ]);
  assert.deepEqual(out, { web: 7, email: 0, whatsapp: 0, telegram: 4 });
});

test("unità: mergiare l'output di un merge non cambia nulla (nessun doppio conteggio)", () => {
  const prima = mergeChannelCounts([{ channel: "web", n: 5 }, { channel: null, n: 2 }]);
  const seconda = mergeChannelCounts(Object.entries(prima).map(([channel, n]) => ({ channel, n })));
  assert.deepEqual(seconda, prima);
});

// —— likeContains: la ricerca non reinterpreta l'utente ——

test("likeContains: chiude in %...% e non tocca i termini normali", () => {
  assert.equal(likeContains("led salerno"), "%led salerno%");
  assert.equal(likeContains(""), "%%");
});

test("likeContains: % e _ dell'utente vengono LETTERALIZZATI, non interpretati", () => {
  assert.equal(likeContains("100%"), "%100\\%%");
  assert.equal(likeContains("tavolo_legno"), "%tavolo\\_legno%");
  assert.equal(likeContains("a%b_c"), "%a\\%b\\_c%");
  // Il backslash stesso (carattere di escape di ILIKE) va escape a sua volta.
  assert.equal(likeContains("a\\b"), "%a\\\\b%");
});

test("likeContains: ogni occorrenza, non solo la prima", () => {
  assert.equal(likeContains("%_%"), "%\\%\\_\\%%");
});
