import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AUTOPILONA_ON,
  AUTOPILONA_OFF,
  TAKEOVER_ORIGIN_SQL,
  TAKEOVER_MANUALE_SQL,
  AMBROSIO_ATTIVO_SQL,
  FOLLOWUP_ESCLUSO_TITLE,
  takeoverOrigin,
  takeoverChip,
  followupEsclusoBadge,
} from "../src/lib/takeover-shared.ts";
import { AUTOPILONA_AUDIT_ON, AUTOPILONA_AUDIT_OFF } from "../src/lib/desk-autopilota-shared.ts";

/**
 * Sentinella dell'ATTRIBUZIONE DEL TAKEOVER (inbox + KPI): il toggle
 * manuale e il cron SLA scrivono la STESSA colonna (ai_takeover_at), quindi
 * l'origine vive nell'AUDIT — append-only dalla 010 — e la regola è
 * «l'ultimo evento autopilota_* del ticket». Qui si verifica la regola
 * pura, i fragmenti SQL che la inbox esegue per riga, la chip e i guard
 * sui pezzi impuri. Scrittore (desk) e lettore (inbox) devono usare le
 * STESSE stringhe d'audit: se una delle due cambia, la suite rompe qui.
 */

const ROOT = process.cwd();

test("scrittore e lettore usano le stesse azioni d'audit", () => {
  assert.equal(AUTOPILONA_ON, AUTOPILONA_AUDIT_ON, "il toggle scrive un'azione che la inbox non leggerebbe");
  assert.equal(AUTOPILONA_OFF, AUTOPILONA_AUDIT_OFF, "il rilascio scritto dal toggle non è quello letto dalla inbox");
});

test("la regola: ultimo evento autopilota_* decide l'origine", () => {
  assert.equal(takeoverOrigin(AUTOPILONA_ON), "manuale", "ultimo ON = attivato a mano");
  assert.equal(takeoverOrigin(AUTOPILONA_OFF), "cron_sla", "dopo il rilascio l'origine torna al cron");
  assert.equal(takeoverOrigin(null), "cron_sla", "senza storia d'audit il takeover è del cron (anche i pre-toggle)");
  // Il caso del riprendere il filo: on → off → il cron ri-claima.
  assert.notEqual(takeoverOrigin(AUTOPILONA_OFF), "manuale", "un OFF successivo non può lasciare l'etichetta manuale");
});

test("il fragmento SQL guarda target+azione per ticket e prende l'ultimo", () => {
  assert.match(TAKEOVER_ORIGIN_SQL, /a\.target = c\.id::text/, "la lookup deve essere per-ticket col cast a text (target è TEXT, id è UUID)");
  assert.match(TAKEOVER_ORIGIN_SQL, new RegExp(AUTOPILONA_ON.replace(/\./g, "\\.")), "deve cercare l'azione ON");
  assert.match(TAKEOVER_ORIGIN_SQL, new RegExp(AUTOPILONA_OFF.replace(/\./g, "\\.")), "deve cercare anche l'azione OFF");
  assert.match(TAKEOVER_ORIGIN_SQL, /order by a\.created_at desc limit 1/, "serve l'ULTIMO evento, non il primo");
  assert.match(TAKEOVER_MANUALE_SQL, new RegExp(`= '${AUTOPILONA_ON.replace(/\./g, "\\.")}'`), "manuale = ultimo evento è un ON");
  assert.equal(
    AMBROSIO_ATTIVO_SQL.replace(/\s+/g, " ").trim(),
    "(c.ai_takeover_at is not null or c.followup_sent_at is not null)",
    "la presenza di Ambrosio resta quella del KPI esistente",
  );
});

test("la chip dice l'origine: a mano, SLA o solo follow-up", () => {
  const aMano = takeoverChip({ takeover: true, followup: false, manuale: true });
  assert.ok(aMano && aMano.label.includes("a mano"), "takeover manuale = chip «a mano»");

  const daSla = takeoverChip({ takeover: true, followup: true, manuale: false });
  assert.ok(daSla && daSla.label.includes("SLA"), "takeover del cron = chip «SLA» anche col follow-up attivo");

  const soloFollow = takeoverChip({ takeover: false, followup: true, manuale: false });
  assert.ok(soloFollow && !soloFollow.label.includes("SLA") && !soloFollow.label.includes("a mano"), "solo follow-up: niente origine");

  assert.equal(takeoverChip({ takeover: false, followup: false, manuale: false }), null, "senza impronte niente chip");
});

test("la inbox e il KPI usano la regola (guard su tickets.ts e page.tsx)", () => {
  const tickets = readFileSync(path.join(ROOT, "src", "lib", "tickets.ts"), "utf8");
  assert.match(tickets, /ambrosio_manuale/, "TICKET_SELECT deve portare l'origine alla inbox");
  assert.match(tickets, /TAKEOVER_MANUALE_SQL/, "la select deve usare il fragment della regola");
  assert.match(tickets, /ambrosioManuale/, "countTickets deve contare i takeover manuali");
  assert.match(tickets, /ambrosioManuale: 0/, "il default senza DB deve restare coerente");

  const inbox = readFileSync(path.join(ROOT, "src", "app", "admin", "tickets", "page.tsx"), "utf8");
  assert.match(inbox, /a mano ·/, "il KPI Ambrosio deve mostrare la ripartizione manuale/SLA");
  // Variante con riga estratta: la chip vive nella riga condivisa
  // (TicketQueueRow), la inbox le passa le impronte AI come prop.
  const row = readFileSync(path.join(ROOT, "src", "components", "tickets", "TicketQueueRow.tsx"), "utf8");
  assert.match(row, /takeoverChip\(/, "la chip della riga deve passare dalla specifica pura");
});

test("il badge di esclusione vive anche SENZA chip (promessa sul futuro, non presente)", () => {
  assert.ok(followupEsclusoBadge({ followupDisabled: true }), "ticket escluso → badge");
  assert.equal(followupEsclusoBadge({ followupDisabled: false }), null, "non escluso → niente badge");
  assert.ok(FOLLOWUP_ESCLUSO_TITLE.includes("riattivabile"), "il tooltip deve dire che è riattivabile in scheda");

  const tickets = readFileSync(path.join(ROOT, "src", "lib", "tickets.ts"), "utf8");
  assert.match(tickets, /followup_disabled_at is not null as followup_disabled/, "TICKET_SELECT deve portare il flag alla inbox");
  const inbox = readFileSync(path.join(ROOT, "src", "app", "admin", "tickets", "page.tsx"), "utf8");
  assert.match(inbox, /ambrosio=\{\{/, "la inbox passa le impronte AI alla riga");
  // Variante con riga estratta: il badge vive LÌ (la pagina monta la riga).
  const row = readFileSync(path.join(ROOT, "src", "components", "tickets", "TicketQueueRow.tsx"), "utf8");
  assert.match(row, /followupEsclusoBadge\(/, "il badge passa dalla specifica pura");
  assert.match(row, /BellOff/, "l'icona di esclusione è BellOff");
  assert.match(row, /takeoverChip\(/, "la chip di attribuzione vive nella riga");
});

test("la migration 041 dà l'indice che la lookup per riga esige", () => {
  const sql = readFileSync(path.join(ROOT, "neon", "migrations", "041-audit-autopilota-index.sql"), "utf8");
  assert.match(sql, /create index if not exists audit_log_target_action_idx/, "manca l'indice");
  assert.match(sql, /on audit_log \(target, action, created_at desc\)/, "l'indice deve partire da (target, action) con created_at desc");
  assert.ok(!/drop |alter table|update /i.test(sql), "la migration deve restare additiva: solo l'indice");
});
