/**
 * TEST TARGET DI RISPOSTA ADMIN — il cursore della
 * scheda Velocità vive in un modulo puro
 * (perf-target-shared) e in testi dichiarati: si
 * verifica senza DB e senza server, con lo stesso
 * metodo del repo (leggere le decisioni dove vivono +
 * eseguire le funzioni pure). Guard gemello-pari: la
 * superficie admin (perf page, pannello, action) vive in
 * entrambi i repo; i moduli shared viaggiano
 * via twin-sync.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");

// Le funzioni pure di perf-target-shared sono importabili
// senza DB (il pannello client le usa nel browser).
const shared = await import(path.join(ROOT, "src", "lib", "perf-target-shared.ts"));
const {
  sanitizePerfTargetConfig,
  describePerfTargetMs,
  PERF_TARGET_KEY,
  PERF_TARGET_MIN_MS,
  PERF_TARGET_MAX_MS,
  PERF_TARGET_STEP_MS,
  DEFAULT_PERF_TARGET_MS,
} = shared;

const actionSrc = readFileSync(path.join(ROOT, "src", "app", "admin", "actions.ts"), "utf8");
const perfSrc = readFileSync(
  path.join(ROOT, "src", "app", "admin", "tools", "perf", "page.tsx"),
  "utf8",
);
const panelSrc = readFileSync(
  path.join(ROOT, "src", "components", "perf-target-panel.tsx"),
  "utf8",
);
const storeSrc = readFileSync(path.join(ROOT, "src", "lib", "perf-target-store.ts"), "utf8");
const adminPerfSrc = readFileSync(path.join(ROOT, "src", "lib", "admin-perf.ts"), "utf8");
const adminPerf = await import(path.join(ROOT, "src", "lib", "admin-perf.ts"));

/* ── logica pura: costanti, sanitize, etichette ─────── */

test("costanti: range 200–3000 ms, default 1 s, passo 50 ms", () => {
  assert.equal(PERF_TARGET_MIN_MS, 200);
  assert.equal(PERF_TARGET_MAX_MS, 3_000);
  assert.equal(PERF_TARGET_STEP_MS, 50);
  assert.equal(DEFAULT_PERF_TARGET_MS, 1_000);
  assert.ok(
    DEFAULT_PERF_TARGET_MS >= PERF_TARGET_MIN_MS && DEFAULT_PERF_TARGET_MS <= PERF_TARGET_MAX_MS,
  );
  assert.ok((PERF_TARGET_MAX_MS - PERF_TARGET_MIN_MS) % PERF_TARGET_STEP_MS === 0);
});

test("sanitize: default 1 s quando la config è assente o corrotta", () => {
  for (const raw of [null, undefined, "garbage", 42, {}, []]) {
    const c = sanitizePerfTargetConfig(raw);
    assert.equal(c.targetMs, DEFAULT_PERF_TARGET_MS, `con ${JSON.stringify(raw)}`);
  }
});

test("sanitize: fuori range e non multipli del passo ricadono, arrotondati", () => {
  assert.equal(sanitizePerfTargetConfig({ targetMs: 5 }).targetMs, PERF_TARGET_MIN_MS);
  assert.equal(sanitizePerfTargetConfig({ targetMs: 999_999 }).targetMs, PERF_TARGET_MAX_MS);
  assert.equal(sanitizePerfTargetConfig({ targetMs: 873 }).targetMs, 850);
  assert.equal(sanitizePerfTargetConfig({ targetMs: "1200" }).targetMs, 1_200);
  assert.equal(
    sanitizePerfTargetConfig({ targetMs: "garbage" }).targetMs,
    DEFAULT_PERF_TARGET_MS,
  );
});

test("describe: etichette leggibili ms / secondi con virgola italiana", () => {
  assert.equal(describePerfTargetMs(200), "200 ms");
  assert.equal(describePerfTargetMs(850), "850 ms");
  assert.equal(describePerfTargetMs(1_000), "1 s");
  assert.equal(describePerfTargetMs(2_500), "2,5 s");
  assert.equal(describePerfTargetMs(3_000), "3 s");
  assert.equal(describePerfTargetMs(NaN), "1 s");
});

/* ── soglie: il verde è il cursore, l'ambra lo segue ──── */

test("sogliaTone: bande mobili con il target (ambra = 2,5× il target)", () => {
  const { sogliaTone } = adminPerf;
  // Default: firma del piano (verde 1 s, ambra 2,5 s).
  assert.equal(sogliaTone(870), "ok");
  assert.equal(sogliaTone(1_200), "warn");
  assert.equal(sogliaTone(3_000), "late");
  // Il cursore sposta TUTTE le bande.
  assert.equal(sogliaTone(870, 500), "warn", "870 sopra un target da 500 ms");
  assert.equal(sogliaTone(870, 900), "ok", "870 sotto un target da 900 ms");
  // Ambra = 2,5× il target: con target 800 ms l'ambra finisce a 2 s.
  assert.equal(sogliaTone(1_999, 800), "warn");
  assert.equal(sogliaTone(2_000, 800), "late");
});

/* ── store: content_settings, zero migration ─────────── */

test("il target vive in content_settings (zero migration: nessun DDL)", () => {
  assert.equal(PERF_TARGET_KEY, "perf_target_ms");
  assert.match(storeSrc, /content_settings/);
  assert.doesNotMatch(storeSrc, /create table|alter table/);
  assert.match(storeSrc, /sanitizePerfTargetConfig\(null\)/, "DB giù → default, mai errore");
});

/* ── admin: audit obbligatorio e wiring completo ─────── */

test("l'action richiede admin, sanifica, upserta e registra vecchio→nuovo in audit", () => {
  const idx = actionSrc.indexOf("export async function savePerfTarget");
  assert.ok(idx !== -1, "l'action del target non esiste");
  const block = actionSrc.slice(idx, actionSrc.indexOf("}", actionSrc.indexOf("revalidatePath", idx)));
  const order = (needle) => {
    const at = block.indexOf(needle);
    assert.ok(at !== -1, `manca ${needle}`);
    return at;
  };
  assert.ok(order("requireAdmin()") < order("PERF_TARGET_KEY"), "requireAdmin prima di ogni scrittura");
  assert.ok(order("sanitizePerfTargetConfig") < order("PERF_TARGET_KEY, JSON.stringify"), "input sanificato prima del salvataggio");
  assert.ok(block.includes("on conflict (key) do update"), "upsert additivo su content_settings");
  assert.ok(order("readPerfTargetConfig()") < order("logAudit("), "l'audit registra il cambio (vecchio→nuovo)");
  assert.match(block, /perf\.target/);
  assert.match(block, /\$\{prev\.targetMs\}→\$\{next\.targetMs\}ms/);
});

test("wiring: slider montato su /admin/tools/perf, il form invia l'action", () => {
  assert.match(perfSrc, /PerfTargetPanel/);
  assert.match(perfSrc, /readPerfTargetConfig/);
  assert.match(panelSrc, /savePerfTarget/);
  assert.match(panelSrc, /"use client"/);
  assert.match(panelSrc, /type="range"/);
  assert.match(panelSrc, /PERF_TARGET_MIN_MS/);
  assert.match(panelSrc, /PERF_TARGET_MAX_MS/);
  assert.match(panelSrc, /PERF_TARGET_STEP_MS/);
});

test("le barre seguono il cursore: il tono è funzione del target LOCALE, non del DB", () => {
  // Il colore si aggiorna AL MOMENTO: sogliaTone riceve lo
  // stato del pannello (targetMs), non la config letta.
  assert.match(panelSrc, /sogliaTone\(p\.dopo\.p50, targetMs\)/);
  assert.match(adminPerfSrc, /export function sogliaTone\(\s*ms: number,\s*targetMs: number/);
});
