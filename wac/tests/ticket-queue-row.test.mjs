/**
 * RIGA DELLA CODA TICKET (TicketQueueRow) — portata dal gemello: il
 * refactoring che estrae la riga della inbox in una componente riusabile
 * dalla scheda cliente. Server component di proposito (zero stato): le
 * interazioni vivono nei client component propri (TicketCardActions,
 * TicketBulkToggle via evento window). Il test qui è il guard statico
 * della convenzione del repo: le decisioni restano verificabili dove
 * vivono davvero, anche quando sono markup.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const row = () => readFileSync(path.join(ROOT, "src", "components", "tickets", "TicketQueueRow.tsx"), "utf8");
/** Il sorgente SENZA commenti: i guard devono beccare il CODICE, non il
 *  docstring che racconta la storia (contiene <Link> e wa.me a titolo di
 *  esempio). */
function code() {
  return row()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const inbox = () => readFileSync(path.join(ROOT, "src", "app", "admin", "tickets", "page.tsx"), "utf8");
const scheda = () => readFileSync(path.join(ROOT, "src", "app", "admin", "clients", "[id]", "page.tsx"), "utf8");

test("la riga è un server component senza stato: niente hook, niente useEffect", () => {
  const src = row();
  assert.ok(!/"use client"/.test(src), "la riga NON è un client component: nessuno stato");
  assert.ok(!/use(State|Effect|Callback|Memo)\(/.test(src), "nessun hook: la riga rende, non decide");
});

test("il link è il TITOLO, le azioni stanno fuori: nessun interattivo annidato", () => {
  const src = code();
  assert.match(src, /href=\{`\/admin\/tickets\/\$\{tk\.id\}`\}/, "il gesto primario (aprire) è il link-titolo");
  // TicketCardActions fuori dal <Link>: il markup non annida bottoni in link.
  const linkStart = src.indexOf("<Link");
  const linkEnd = src.indexOf("</Link>", linkStart);
  const dentroLink = src.slice(linkStart, linkEnd);
  assert.ok(!/TicketCardActions|TicketBulkToggle/.test(dentroLink), "nessuna azione dentro il link-titolo");
});

test("le impronte AI passano dalla specifica pura takeover-shared", () => {
  const src = code();
  assert.match(src, /takeoverChip\(/, "la chip vive nella riga, ma la regola è nella lib");
  assert.match(src, /followupEsclusoBadge\(/, "il badge di esclusione pure");
  assert.match(src, /BellOff/, "l'icona di esclusione è BellOff");
});

test("WhatsApp contestuale: due varianti (pill scheda, icona inbox), un solo href", () => {
  const src = code();
  assert.match(src, /waStyle === "pill"/, "la scheda cliente mostra la pill");
  assert.match(src, /waStyle === "icon"/, "la inbox mostra solo l'icona");
  assert.ok(!/wa\.me/.test(src), "l'href NON si costruisce nella vista: arriva da waTicketHref (dominio)");
});

test("identità CRM: la chip-link è opzionale e non sta nella riga senza sync", () => {
  const src = code();
  assert.match(src, /\{crm && \(/, "la chip CRM si monta solo con la prop crm");
});

test("la inbox monta la riga con bulk + impronte AI + WhatsApp icona", () => {
  const src = inbox();
  assert.match(src, /<TicketQueueRow/, "la coda non duplica più il markup: monta la riga");
  assert.match(src, /bulkSelect/, "l'inbox ha la colonna checkbox");
  assert.match(src, /whatsappStyle="icon"/, "variante C: solo icona in inbox");
  assert.match(src, /ambrosio=\{\{/, "le impronte AI arrivano come prop");
  assert.match(src, /crm=\{/, "l'identità CRM arriva come prop");
});

test("la scheda cliente riusa la STESSA riga (pill, niente bulk)", () => {
  const src = scheda();
  assert.match(src, /<TicketQueueRow/, "la scheda non duplica più il markup: monta la riga");
  assert.ok(!/bulkSelect/.test(src), "il bulk non ha senso in scheda: la prop non si passa");
  assert.match(src, /waTicketHref\(/, "il link contestuale usa il costruttore del dominio");
  assert.ok(!/function waTicketHref/.test(src), "il costruttore NON si duplica in pagina: viene dal dominio");
});
