/**
 * GUARD DI SITO (Crema) — regole pure dell'upgrade ticketing
 * (migration 046): tag, escalation, merge. Le regole vivono in
 * tickets-shared.ts (zero import, type stripping); qui le testa
 * direttamente più il wiring delle server action che le usa.
 * Il gemello (Web Agency Salento) non ha queste regole: NON
 * copiare questo file, è perimetro Crema (vedi AGENTS.md).
 * Le query su DB vivo sono coperte dall'E2E; qui le regole.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  ESCALATION_MAX,
  ESCALATION_TONE,
  TAG_TONE,
  TICKET_TAG_MAX_LEN,
  TICKET_TAGS_MAX,
  TICKET_TAG_VOCAB_MAX,
  canMerge,
  escalationLabel,
  nextEscalationLevel,
  sanitizeTags,
} from "../src/lib/tickets-shared.ts";

const ACTIONS = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/app/admin/actions.ts",
  ),
  "utf8",
);

// —— Costanti: i limiti sono regole, non numeri magici sparsi ——

test("costanti: 12 tag per ticket, 30 caratteri, 30 voci di vocabolario, escalation 0..3", () => {
  assert.equal(TICKET_TAGS_MAX, 12);
  assert.equal(TICKET_TAG_MAX_LEN, 30);
  assert.equal(TICKET_TAG_VOCAB_MAX, 30);
  assert.equal(ESCALATION_MAX, 3);
});

test("toni: ESCALATION_TONE copre i livelli 0..3, TAG_TONE è una classe chip", () => {
  assert.deepEqual(Object.keys(ESCALATION_TONE).map(Number), [0, 1, 2, 3]);
  assert.equal(typeof TAG_TONE, "string");
  assert.match(TAG_TONE, /text-slate-600/);
});

// —— sanitizeTags: un solo normalizzatore per ticket e vocabolario ——

test("sanitizeTags: trim, minuscolo e spazi interni → trattino (kebab-case)", () => {
  assert.deepEqual(sanitizeTags(["  Preventivo Immediato "]), [
    "preventivo-immediato",
  ]);
  assert.deepEqual(sanitizeTags(["BUG GRAVE"]), ["bug-grave"]);
});

test("sanitizeTags: dedup che preserva l'ordine di prima apparizione", () => {
  assert.deepEqual(sanitizeTags(["Bug", "Preventivo", "bug", "BUG"]), [
    "bug",
    "preventivo",
  ]);
});

test("sanitizeTags: tag vuoti scartati, nessun buco nell'output", () => {
  assert.deepEqual(sanitizeTags(["", "  ", "\t"]), []);
  assert.deepEqual(sanitizeTags(["a", "", "b"]), ["a", "b"]);
});

test("sanitizeTags: tag più lunghi di 30 caratteri scartati (etichette, non frasi)", () => {
  const lungo = "x".repeat(TICKET_TAG_MAX_LEN + 1);
  assert.deepEqual(sanitizeTags([lungo, "ok"]), ["ok"]);
  // Esattamente 30 caratteri: al limite, resta.
  assert.deepEqual(sanitizeTags(["x".repeat(TICKET_TAG_MAX_LEN)]), [
    "x".repeat(TICKET_TAG_MAX_LEN),
  ]);
});

test("sanitizeTags: max di default = TICKET_TAGS_MAX, max esplicito per il vocabolario", () => {
  const molti = Array.from({ length: 15 }, (_, i) => `tag-${i}`);
  assert.equal(sanitizeTags(molti).length, TICKET_TAGS_MAX);
  assert.equal(sanitizeTags(molti, TICKET_TAG_VOCAB_MAX).length, 15);
});

test("sanitizeTags: lo stesso input dà lo stesso tag nel ticket e nel vocabolario", () => {
  // Due normalizzatori che divergono romperebbero il filtro ?tag=:
  // «preventivo immediato» nel vocabolario non troverebbe il tag
  // «preventivo-immediato» applicato al ticket.
  const input = ["Preventivo Immediato", "bug grave"];
  assert.deepEqual(sanitizeTags(input), sanitizeTags(input, TICKET_TAG_VOCAB_MAX));
});

// —— nextEscalationLevel: sale 0→1→2→3, al massimo null (il pulsante sparisce) ——

test("nextEscalationLevel: scala 0→1→2→3, al massimo restituisce null", () => {
  assert.equal(nextEscalationLevel(0), 1);
  assert.equal(nextEscalationLevel(1), 2);
  assert.equal(nextEscalationLevel(2), 3);
  assert.equal(nextEscalationLevel(3), null);
});

test("nextEscalationLevel: non lancia mai — negativi, NaN e fuori scala trattati come 0", () => {
  assert.equal(nextEscalationLevel(-5), 1);
  assert.equal(nextEscalationLevel(Number.NaN), 1);
  // Non finito (Inf) è "non un numero": trattato come 0, non come max.
  assert.equal(nextEscalationLevel(Number.POSITIVE_INFINITY), 1);
  assert.equal(nextEscalationLevel(99), null); // clamp a 3, poi null
  assert.equal(nextEscalationLevel(2.7), 3); // floor
});

// —— escalationLabel: 0 è il livello base, non un fallimento ——

test("escalationLabel: 0 (e negativi) dicono «Livello 1», 1..3 salgono", () => {
  assert.equal(escalationLabel(0), "Livello 1");
  assert.equal(escalationLabel(-3), "Livello 1");
  assert.equal(escalationLabel(Number.NaN), "Livello 1");
  assert.equal(escalationLabel(1), "Livello 2");
  assert.equal(escalationLabel(2), "Livello 3");
  assert.equal(escalationLabel(3), "Livello 4");
});

// —— canMerge: solo ticket VIVI, diversi, in un destino vivo ——

test("canMerge: tutti i via libera → sì (anche ticket chiusi: il duplice si chiude nel merge)", () => {
  assert.equal(canMerge({ self: false, alreadyMerged: false, destinationMerged: false }), true);
});

test("canMerge: ogni via libera mancante → no", () => {
  assert.equal(canMerge({ self: true, alreadyMerged: false, destinationMerged: false }), false);
  assert.equal(canMerge({ self: false, alreadyMerged: true, destinationMerged: false }), false);
  assert.equal(canMerge({ self: false, alreadyMerged: false, destinationMerged: true }), false);
});

// —— Wiring: le server action usano le regole (non riscrivono la logica) ——

test("actions.ts: importa le regole pure dal layer condiviso, non le reimplementa", () => {
  assert.match(ACTIONS, /canMerge,\n?\s*getChatEmojis/);
  assert.match(ACTIONS, /nextEscalationLevel,/);
  assert.match(ACTIONS, /sanitizeTags,/);
});

test("actions.ts: le cinque azioni dell'upgrade esistono e sono esportate", () => {
  for (const fn of [
    "setTicketTags",
    "escalateTicket",
    "mergeTickets",
    "lookupTicketForMerge",
    "saveTicketTagVocabulary",
  ]) {
    assert.match(ACTIONS, new RegExp(`export async function ${fn}\\(`), `${fn} mancante`);
  }
});

test("actions.ts: il merge controlla canMerge PRIMA di scrivere merged_into", () => {
  const guardia = ACTIONS.indexOf("canMerge(");
  const scrittura = ACTIONS.indexOf("merged_into = $");
  assert.ok(guardia !== -1, "canMerge non usata in actions.ts");
  assert.ok(scrittura !== -1, "update merged_into non trovato");
  assert.ok(guardia < scrittura, "la guardia del merge deve precedere la scrittura");
});

test("actions.ts: l'escalation passa per nextEscalationLevel (il livello non lo decide la UI)", () => {
  assert.match(ACTIONS, /escalateTicket[\s\S]{0,600}nextEscalationLevel/);
});

test("actions.ts: il vocabolario riscrive solo se diverso (disciplina di saveQuickReplies)", () => {
  assert.match(ACTIONS, /saveTicketTagVocabulary[\s\S]{0,900}JSON\.stringify\(list\) === JSON\.stringify\(current\)/);
});
