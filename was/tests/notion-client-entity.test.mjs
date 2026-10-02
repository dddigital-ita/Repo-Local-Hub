/**
 * NOTION × PORTAFOGLIO CLIENTI — entità «client» end-to-end dove vivono
 * le decisioni (2026-09-26: il vincolo scartava gli enqueue con
 * notion_sync_queue_entity_check).
 *
 * Il modulo della coda esegue all'import (apre il DB), quindi le
 * decisioni si verificano leggendo il sorgente — la tecnica del test di
 * contrasto del repo. La migration 027 e il DB reale sono verificati
 * dalla corsa `npm run db:migrate` e dalle sonde psql documentate.
 *
 *  1. il tipo Entity e il mapping fallback includono «client» (l'ambito
 *     del vincolo deve essere identico all'intenzione del motore);
 *  2. la migration 027 contiene le due ALTER (vincolo in transazione +
 *     colonna di marcatura) ed è additiva come le altre;
 *  3. il drain marca i client consegnati (idempotenza: la coda crea
 *     pagine nuove, senza marcatura ogni sync ri-accodava e il
 *     workspace si riempiva di copie);
 *  4. l'azione del portafoglio incoda SOLO le schede mai consegnate;
 *  5. la lettura del portafoglio espone notion_synced_at.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const QUEUE_SRC = readFileSync(new URL("../src/lib/notion-queue.ts", import.meta.url), "utf8");
const MIGRATION = readFileSync(
  new URL("../neon/migrations/027-notion-client-entity.sql", import.meta.url),
  "utf8",
);
const ACTIONS_SRC = readFileSync(new URL("../src/app/admin/actions.ts", import.meta.url), "utf8");
const CLIENTS_SRC = readFileSync(new URL("../src/lib/clients.ts", import.meta.url), "utf8");

test("il motore della coda conosce «client»: tipo e mapping fallback (l'ambito del vincolo = l'intenzione)", () => {
  assert.match(QUEUE_SRC, /type Entity = "lead" \| "ticket" \| "callback" \| "client"/);
  assert.match(QUEUE_SRC, /if \(entity === "client"\) \{/);
});

test("migration 027: ricrea il vincolo con client e aggiunge la marcatura, additiva", () => {
  assert.match(MIGRATION, /drop constraint if exists notion_sync_queue_entity_check/);
  assert.match(MIGRATION, /check \(entity in \('lead', 'ticket', 'callback', 'client'\)\)/);
  assert.match(MIGRATION, /begin;/);
  assert.match(MIGRATION, /commit;/);
  assert.match(MIGRATION, /alter table clients add column if not exists notion_synced_at timestamptz/);
});

test("il drain marca i client consegnati come i lead (idempotenza anti-doppioni)", () => {
  const leadIdx = QUEUE_SRC.indexOf('job.entity === "lead"');
  const clientIdx = QUEUE_SRC.indexOf('job.entity === "client"');
  assert.ok(leadIdx !== -1 && clientIdx !== -1, "entrambi i rami di marcatura devono esistere");
  assert.ok(clientIdx > leadIdx, "il ramo client segue il pattern lead");
  assert.match(
    QUEUE_SRC,
    /update clients set notion_synced_at = now\(\) where id = \$1 and notion_synced_at is null/,
  );
});

test("l'azione del portafoglio incoda solo le schede mai consegnate (niente copie in Notion)", () => {
  assert.match(ACTIONS_SRC, /c\.synced_at && c\.notion_synced_at == null/);
});

test("la lettura del portafoglio espone la marcatura (select e tipo)", () => {
  assert.match(CLIENTS_SRC, /cl\.synced_at, cl\.notion_synced_at/);
  assert.match(CLIENTS_SRC, /notion_synced_at: string \| null/);
});
