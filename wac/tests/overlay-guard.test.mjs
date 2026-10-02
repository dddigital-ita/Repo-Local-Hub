/**
 * OVERLAY GUARD — il test della sentinella.
 *
 * Come gli altri test del repo, verifica il codice dove vive: le fixture
 * in tests/fixtures/overlay-guard/ sono alberi JSX veri (parsati con lo
 * stesso compilatore della build) che riproducono il bug della palette ⌘K
 * e le sue forme legittime; le sentinelle girano il guard sul codice reale
 * di src/ e impongono che resti pulito.
 *
 * Esecuzione: `npm test` (node --test). Il guard gira anche da CLI,
 * agganciato agli script build (guard:overlays).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runGuard } from "../scripts/overlay-guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures", "overlay-guard");
const SRC = path.join(here, "..", "src");

const fixtureFiles = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => path.join(FIXTURES, f));
const cssText = readFileSync(path.join(SRC, "app", "globals.css"), "utf8");

test("superficie glass → fixed senza portale: segnalato, con il percorso completo", () => {
  const { violations } = runGuard({ files: fixtureFiles, cssText, srcDir: FIXTURES });

  const inGlass = violations.filter((v) => v.file.endsWith("fixedmod.tsx"));
  assert.equal(inGlass.length, 1, `attesa 1 violazione in fixedmod, trovate: ${JSON.stringify(violations, null, 2)}`);
  assert.match(inGlass[0].cls, /fixed inset-0/);
  assert.ok(inGlass[0].chain.includes("glass"), `la catena deve nominare .glass: ${inGlass[0].chain}`);
});

test("default import attraverso il grafo: il bug da GlassWithDefault è raggiunto", () => {
  const { violations } = runGuard({ files: fixtureFiles, cssText, srcDir: FIXTURES });

  const viaDefault = violations.filter((v) => v.file.endsWith("bugdefault.tsx"));
  assert.equal(viaDefault.length, 1, `attesa 1 violazione da default import: ${JSON.stringify(violations, null, 2)}`);
  assert.ok(viaDefault[0].chain.includes("glass-strong"), `catena: ${viaDefault[0].chain}`);
});

test("literal dentro cn(): superficie e overlay composti sono visti", () => {
  const { violations } = runGuard({ files: fixtureFiles, cssText, srcDir: FIXTURES });

  const viaCn = violations.filter((v) => v.file.endsWith("cnfixture.tsx"));
  assert.equal(viaCn.length, 1, `attesa 1 violazione da cn(): ${JSON.stringify(violations, null, 2)}`);
  assert.match(viaCn[0].cls, /fixed/);
});

test("createPortal esenta l'overlay: nessuna violazione dal ramo portaled", () => {
  const { violations } = runGuard({ files: fixtureFiles, cssText, srcDir: FIXTURES });

  assert.equal(
    violations.filter((v) => v.file.endsWith("portaled.tsx")).length,
    0,
    `il portale non deve essere segnalato: ${JSON.stringify(violations, null, 2)}`,
  );
});

test("fixed fuori dal vetro resta legale: il guard non urla sul lupo", () => {
  const { violations } = runGuard({ files: fixtureFiles, cssText, srcDir: FIXTURES });

  // demo.tsx ha un fixed senza antenati glass: non deve produrre violazioni
  assert.equal(
    violations.filter((v) => v.file.endsWith("demo.tsx")).length,
    0,
    `fixed legale segnalato per errore: ${JSON.stringify(violations, null, 2)}`,
  );
});

test("inventario: esattamente 3 violazioni sulle fixture", () => {
  const { violations } = runGuard({ files: fixtureFiles, cssText, srcDir: FIXTURES });
  assert.equal(violations.length, 3, `attese 3 (fixedmod, bugdefault, cnfixture): ${JSON.stringify(violations, null, 2)}`);
});

test("il codice reale di src/ passa il guard (sentinella anti-regressione)", () => {
  const srcFiles = (function list(dir) {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...list(p));
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  })(SRC);

  const { violations } = runGuard({ files: srcFiles, cssText });
  assert.deepEqual(
    violations,
    [],
    `violazioni nel codice reale (il bug palette deve restare l'unico, e già fixato): ${JSON.stringify(violations, null, 2)}`,
  );
});
