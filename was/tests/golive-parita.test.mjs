/**
 * SENTINELLE GO-LIVE + PARITÀ (uniformate al gemello, 0.7.0):
 *
 *   1. RUNBOOK GO-LIVE IN ADMIN: GO-LIVE.md (variante Salento: deploy
 *      Vercel + dominio canonico www.webagencysalento.com) è leggibile
 *      dall'app (/admin/tools/golive, stesso pattern della checklist
 *      captcha) — il runbook è a portata di click nel momento in cui serve.
 *   2. SLA NEL SEED: la policy SLA esiste su content_settings dal primo
 *      avvio (migration 039 idempotente) — la pagina /admin/settings/sla
 *      la mostra CONFIGURATA, mai vuota. La cura era nata proprio da un
 *      difetto visto QUI e mai atterrata in questo repo: ora c'è.
 *
 * Esecuzione: `npm test` (node --test).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

// fileURLToPath e non .pathname: il percorso del repo contiene spazi.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p) => readFileSync(path.join(ROOT, ...p), "utf8");

/* ── 1. Runbook go-live in admin ─────────────────────────────────── */

test("runbook go-live: pagina admin che legge GO-LIVE.md dal repo", () => {
  const page = read("src", "app", "admin", "tools", "golive", "page.tsx");
  assert.match(page, /GO-LIVE\.md/, "legge il documento del repo (fonte unica)");
  assert.match(page, /requireAdmin/, "protetta dalla sessione admin");
  assert.match(page, /parseMarkdownDoc/, "render del markdown (stesso pattern checklist captcha)");
  assert.ok(existsSync(path.join(ROOT, "GO-LIVE.md")), "GO-LIVE.md esiste nella root");
  // Il runbook parla del deploy REALE di questo sito (Vercel + dominio
  // canonico), non della variante del gemello.
  const doc = read("GO-LIVE.md");
  assert.match(doc, /www\.webagencysalento\.com/, "dominio canonico nel runbook");
  assert.match(doc, /Vercel/, "deploy Vercel (variante Salento), non cPanel");
  assert.ok(!/webagencycrema/i.test(doc), "nessun riferimento al gemello nel runbook");
  // Raggiungibile: catalogata nella palette ⌘K / destinazioni.
  const dest = read("src", "lib", "admin-destinations.ts");
  assert.match(dest, /\/admin\/tools\/golive/, "destinazione in palette ⌘K");
});

/* ── 2. SLA nel seed ─────────────────────────────────────────────── */

test("migration 039: la policy SLA è seedata su content_settings, idempotente", () => {
  const mig = read("neon", "migrations", "039-sla-seed.sql");
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
