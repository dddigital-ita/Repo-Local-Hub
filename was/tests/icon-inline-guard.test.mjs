/**
 * ICON INLINE GUARD — il test della sentinella.
 *
 * Stessa filosofia di overlay-guard.test.mjs: le fixture in
 * tests/fixtures/icon-inline-guard/ sono JSX veri (parsati con lo stesso
 * compilatore della build) che riproducono il bug «icona su riga propria»
 * (Tailwind Preflight rende ogni svg display:block) e tutte le sue forme
 * legittime; la sentinella finale gira il guard sul codice reale di src/
 * e impone che resti pulito.
 *
 * Il guard gira anche da CLI, agganciato al hook pre-push (vedi
 * githooks/pre-push): una violazione blocca il push.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runIconGuard } from "../scripts/icon-inline-guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures", "icon-inline-guard");
const SRC = path.join(here, "..", "src");

const fixtureFiles = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => path.join(FIXTURES, f));

function listFiles(dir, ext) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

const fixtureCss = listFiles(FIXTURES, ".css");
const srcCss = listFiles(SRC, ".css");

function runOnFixtures() {
  return runIconGuard({ files: fixtureFiles, cssFiles: fixtureCss, srcDir: FIXTURES });
}

test("chat CTA: icona lucide + testo in <a> non-flex → segnalato (il bug reale)", () => {
  const { violations } = runOnFixtures();

  const inCta = violations.filter((v) => v.file.endsWith("bug-chat-cta.tsx"));
  assert.equal(inCta.length, 1, `attesa 1 violazione in bug-chat-cta: ${JSON.stringify(violations, null, 2)}`);
  assert.equal(inCta[0].host, "a");
  assert.equal(inCta[0].icon, "Phone");
  assert.match(inCta[0].file, /bug-chat-cta\.tsx$/);
  assert.equal(typeof inCta[0].line, "number");
});

test("flex al livello sbagliato: conta l'ospite dell'accoppiata, non un antenato qualsiasi", () => {
  const { violations } = runOnFixtures();

  // lo span inline-flex avvolge SOLO l'icona: il testo resta fuori, e il
  // primo ospite con testo accanto è l'<a> non-flex — non basta un
  // qualunque antenato safe per dichiarare legale l'accoppiata.
  const inFlex = violations.filter((v) => v.file.endsWith("bug-flex-on-wrong-level.tsx"));
  assert.equal(inFlex.length, 1, `attesa 1 violazione: ${JSON.stringify(violations, null, 2)}`);
  assert.equal(inFlex[0].host, "a", `l'ospite segnalato deve essere l'<a>: ${JSON.stringify(inFlex, null, 2)}`);
});

test("condizionali Tailwind sugli span interni: l'ospite resta scoperto", () => {
  const { violations } = runOnFixtures();

  // le classi sm:flex finiscono sugli SPAN, non sull'<a>: nel vivo Next.js
  // l'icona è andata davvero a capo. Il guard deve vedere l'ospite nudo.
  const inCond = violations.filter((v) => v.file.endsWith("bug-conditional-tailwind.tsx"));
  assert.equal(inCond.length, 1, `attesa 1 violazione: ${JSON.stringify(violations, null, 2)}`);
  assert.equal(inCond[0].host, "a");
});

test("icona dinamica locale: stessa semantica del lucide diretto", () => {
  const { violations } = runOnFixtures();

  const inDyn = violations.filter((v) => v.file.endsWith("bug-dynamic-icon.tsx"));
  assert.equal(inDyn.length, 1, `attesa 1 violazione: ${JSON.stringify(violations, null, 2)}`);
  assert.equal(inDyn[0].host, "p");
  assert.equal(inDyn[0].icon, "BotIcon");
});

test("le forme legali non urlano sul lupo: zero violazioni sugli ok-*", () => {
  const { violations } = runOnFixtures();

  const okFiles = fixtureFiles
    .filter((f) => path.basename(f).startsWith("ok-"))
    .map((f) => path.basename(f));
  assert.ok(okFiles.length >= 8, `fixture ok attese almeno 8: ${okFiles.join(", ")}`);

  for (const base of okFiles) {
    const hit = violations.filter((v) => v.file.endsWith(base));
    assert.deepEqual(hit, [], `${base} è dichiarato legale ma è stato segnalato`);
  }
});

test("back-link con <Link> esterno e inline-flex all'uso: legali", () => {
  const { violations } = runOnFixtures();

  // il caso che ha motivato il verdetto sui componenti esterni: la
  // className scritta all'uso finisce sull'elemento radice del Link,
  // quindi il sito d'uso È un ospite safe-inline.
  assert.deepEqual(
    violations.filter((v) => v.file.endsWith("ok-backlink.tsx")),
    [],
    JSON.stringify(violations, null, 2),
  );
});

test("grafico con role=\"img\" + aria-label: immagine dichiarata, non icona", () => {
  const { violations } = runOnFixtures();

  // un svg con nome accessibile è un'immagine (chart, illustrazione):
  // trattarlo come icona manderebbe in overload il giudizio sull'ospite.
  assert.deepEqual(
    violations.filter((v) => v.file.endsWith("ok-named-image.tsx")),
    [],
    JSON.stringify(violations, null, 2),
  );
});

test("icona assoluta dentro il wrapper dell'input: fuori dal flusso, mai un'accoppiata", () => {
  const { violations } = runOnFixtures();

  assert.deepEqual(
    violations.filter((v) => v.file.endsWith("ok-icon-only.tsx")),
    [],
    JSON.stringify(violations, null, 2),
  );
});

test("inventario: esattamente 4 violazioni sulle fixture", () => {
  const { violations } = runOnFixtures();
  assert.equal(
    violations.length,
    4,
    `attese 4 (chat-cta, flex-on-wrong-level, conditional-tailwind, dynamic-icon): ${JSON.stringify(violations, null, 2)}`,
  );
});

test("il codice reale di src/ passa il guard (sentinella anti-regressione)", () => {
  const srcFiles = listFiles(SRC, ".tsx").concat(listFiles(SRC, ".ts"));

  const { violations, files } = runIconGuard({ files: srcFiles, cssFiles: srcCss });

  assert.ok(files > 100, `il guard deve vedere il progetto vero, non ${files} file`);
  assert.deepEqual(
    violations,
    [],
    `violazioni nel codice reale — correggi con "inline-flex items-center gap-2" sull'ospite (o "inline" sull'icona): ${JSON.stringify(violations, null, 2)}`,
  );
});

test("il guard è agganciato al hook pre-push, dopo l'overlay guard", () => {
  const hook = readFileSync(path.join(here, "..", "githooks", "pre-push"), "utf8");

  const overlayIdx = hook.indexOf("scripts/overlay-guard.mjs");
  const iconIdx = hook.indexOf("scripts/icon-inline-guard.mjs");
  assert.ok(overlayIdx > 0, "il hook deve chiamare l'overlay guard");
  assert.ok(iconIdx > overlayIdx, "l'icon guard deve girare dopo l'overlay guard");
  assert.match(hook, /icon-inline-guard\.mjs\s+--quiet/, "il guard icone deve girare in --quiet nel hook");
});
