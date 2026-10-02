/**
 * TARGET NOTION DELLA CODA — il database di destinazione deve accettare
 * i payload che il motore costruisce (2026-09-26: database unificato
 * «Web Agency — Lead & Clienti» nell'hub 01 · Clienti & Prospect).
 *
 * Un database Notion ha UNA sola proprietà title: i client (mapping
 * fallback) la condividono con i lead («Nome»), e «Telefono» è
 * rich_text come nel mapping lead — la verifica vive nel sorgente,
 * la consegna reale è documentata nella verifica browser.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const QUEUE_SRC = readFileSync(new URL("../src/lib/notion-queue.ts", import.meta.url), "utf8");

test("mapping client: title «Nome» condiviso coi lead (un DB = una title)", () => {
  const clientIdx = QUEUE_SRC.indexOf('entity === "client"');
  const block = QUEUE_SRC.slice(clientIdx, QUEUE_SRC.indexOf("]", clientIdx));
  assert.match(block, /from: "name", to: "Nome", type: "title"/);
  assert.doesNotMatch(block, /to: "Cliente"/, "la proprietà title è una sola: «Nome»");
});

test("mapping client: Telefono rich_text (tipo coerente col mapping lead, phone_number rifiutato dal DB)", () => {
  const clientIdx = QUEUE_SRC.indexOf('entity === "client"');
  const block = QUEUE_SRC.slice(clientIdx, QUEUE_SRC.indexOf("]", clientIdx));
  assert.match(block, /from: "phone_e164", to: "Telefono", type: "rich_text"/);
});

test("le colonne client esistono nel DB unificato: Email, Azienda, Ticket, Canali, Ultimo contatto", () => {
  const clientIdx = QUEUE_SRC.indexOf('entity === "client"');
  const block = QUEUE_SRC.slice(clientIdx, QUEUE_SRC.indexOf("]", clientIdx));
  for (const to of ["Email", "Azienda", "Ticket", "Canali", "Ultimo contatto"]) {
    assert.ok(block.includes(`to: "${to}"`), `manca la proprietà ${to}`);
  }
});
