/**
 * LINK WHATSAPP CONTESTUALE AL TICKET — la regola pura (tickets-shared.ts)
 * condivisa da scheda cliente (pill) e inbox (icona, variante C del
 * assessment docs/tickets-redesign-assessment.md): un solo costruttore,
 * mai due che divergono. Il testo precompilato CITA il numero del ticket:
 * il cliente non deve spiegare chi è.
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { waTicketHref } = await import("../src/lib/tickets-shared.ts");

test("waTicketHref: wa.me col testo che CITA il numero del ticket", () => {
  const href = waTicketHref("393339990001", 743);
  assert.match(href, /^https:\/\/wa\.me\/393339990001\?text=/);
  const text = decodeURIComponent(href.split("?text=")[1]);
  assert.match(text, /ticket #743/);
  assert.match(text, /Web Agency Crema/);
});

test("waTicketHref: le cifre passano intatte (la normalizzazione è a monte)", () => {
  // La estrazione cifre (replace(/\D/g)) la fa la pagina: qui arrivano pulite.
  assert.match(waTicketHref("393471234567", 1), /^https:\/\/wa\.me\/393471234567\?/);
});

test("waTicketHref: il testo è URL-encoded (spazi e accenti sicuri nell'href)", () => {
  const href = waTicketHref("393339990001", 12);
  assert.doesNotMatch(href, / /); // niente spazi grezzi in un href
  assert.ok(href.split("?text=")[1].length > 0);
});

test("waTicketHref: numeri diversi → testi diversi (mai un testo condiviso)", () => {
  const a = waTicketHref("393339990001", 743);
  const b = waTicketHref("393339990001", 744);
  assert.notEqual(a, b);
});
