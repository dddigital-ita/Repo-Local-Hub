/**
 * SENTINELLE GO-LIVE — le tre task portate dall'esperienza su altro sito
 * (Web Agency Salento, dove hanno evitato tre incidenti pre-go-live):
 *
 *   1. SLA NEL SEED: la policy SLA esiste su content_settings dal primo
 *      avvio (migration 036 idempotente) — la pagina /admin/settings/sla
 *      la mostra CONFIGURATA, mai vuota.
 *   2. RUNBOOK GO-LIVE IN ADMIN: GO-LIVE.md è leggibile dall'app
 *      (/admin/tools/golive, stesso pattern della checklist captcha) —
 *      il runbook è a portata di click nel momento in cui serve.
 *   3. PREZZI ALLINEATI: l'audit (scripts/audit-prices.mjs) e la
 *      sentinella chat-prezzi (tests/chat-prices.test.mjs) esistono e
 *      girano in suite — chat e landing non dicono cifre diverse.
 *
 * Esecuzione: `npm test` (node --test).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (...p) => readFileSync(path.join(ROOT, ...p), "utf8");

/* ── 1. SLA nel seed ─────────────────────────────────────────────── */

test("migration 036: la policy SLA è seedata su content_settings, idempotente", () => {
  const mig = read("neon", "migrations", "036-sla-seed.sql");
  assert.match(mig, /insert into content_settings/, "scrive su content_settings");
  assert.match(mig, /ticket_sla_policy/, "usa la STESSA chiave di SLA_POLICY_KEY");
  assert.match(mig, /on conflict \(key\) do nothing/, "idempotente: non sovrascrive policy personalizzate");
  // I valori del seed rispecchiano SLA_POLICY_DEFAULT del codice.
  const lib = read("src", "lib", "tickets.ts");
  assert.match(lib, /urgente:\s*\{\s*nextReplyH:\s*1,\s*resolveH:\s*4\s*\}/, "default codice: urgente 1h/4h");
  for (const v of ['"nextReplyH":1', '"resolveH":4', '"nextReplyH":2', '"resolveH":8', '"nextReplyH":4', '"resolveH":24', '"nextReplyH":8', '"resolveH":48']) {
    assert.ok(mig.includes(v), `seed contiene ${v}`);
  }
});

/* ── 2. Runbook go-live in admin ─────────────────────────────────── */

test("runbook go-live: pagina admin che legge GO-LIVE.md dal repo", () => {
  const page = read("src", "app", "admin", "tools", "golive", "page.tsx");
  assert.match(page, /GO-LIVE\.md/, "legge il documento del repo (fonte unica)");
  assert.match(page, /requireAdmin/, "protetta dalla sessione admin");
  assert.match(page, /parseMarkdownDoc/, "render del markdown (stesso pattern checklist captcha)");
  assert.ok(existsSync(path.join(ROOT, "GO-LIVE.md")), "GO-LIVE.md esiste nella root");
  // Raggiungibile: catalogata nella palette ⌘K / destinazioni.
  const dest = read("src", "lib", "admin-destinations.ts");
  assert.match(dest, /\/admin\/tools\/golive/, "destinazione in palette ⌘K");
});

/* ── 3. Prezzi allineati (chat = landing = catalogo) ─────────────── */

test("audit prezzi + sentinella chat-prezzi esistono e sono in suite", () => {
  assert.ok(existsSync(path.join(ROOT, "scripts", "audit-prices.mjs")), "scripts/audit-prices.mjs");
  assert.ok(existsSync(path.join(ROOT, "tests", "chat-prices.test.mjs")), "tests/chat-prices.test.mjs");
  // L'audit legge anche il catalogo reale da DB (--seed è il fallback).
  const audit = read("scripts", "audit-prices.mjs");
  assert.match(audit, /pricesFromDb/, "modalità DB di produzione");
});
