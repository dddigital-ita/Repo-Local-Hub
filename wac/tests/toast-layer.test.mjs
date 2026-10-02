/**
 * LAYER TOAST VIEWPORT-ANCHORED — ogni rotta admin eredita il layer dei
 * toast senza containing block.
 *
 * La verifica nel browser (2026-09-26) ha confermato l'invariante: i toast
 * appaiono a centro-alto su tutte le rotte admin perché il loro unico
 * antenato è `main.aurora` — e `.aurora` è solo gradient, nessun
 * backdrop-filter/filter/transform che possa diventare containing block
 * dei `position:fixed` (il bug della palette ⌘K, commit 8e5c7ba).
 *
 * Questo test rende l'invariante eseguibile, leggendo il codice dove vive:
 *  1. il layout admin monta AdminToaster PRIMA dei contenuti, così nessuna
 *     rotta può rendersi senza il layer;
 *  2. il layer mantiene le classi viewport-anchored e il veil framer-motion
 *     resta DENTRO il layer (la pillola glass è figlia, non antenato);
 *  3. `main.aurora` non porta classi a rischio (containing block);
 *  4. ogni rotta admin (page.tsx) è renderizzata dentro quel layout:
 *     nessuna rotta ha un layout proprio che bypassi `app/admin/layout`.
 *  5. `.aurora` resta innocua anche in globals.css: niente filtri lì.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const ADMIN = path.join(ROOT, "src", "app", "admin");
const LAYOUT = path.join(ADMIN, "layout.tsx");
const TOASTER = path.join(ROOT, "src", "components", "admin-toaster.tsx");
const GLOBALS = path.join(ROOT, "src", "app", "globals.css");

const layout = readFileSync(LAYOUT, "utf8");
const toaster = readFileSync(TOASTER, "utf8");

test("il layout admin monta AdminToaster: ogni rotta lo eredita", () => {
  assert.match(layout, /import\s+AdminToaster\s+from\s+"@\/components\/admin-toaster"/);
  assert.match(layout, /<AdminToaster\s*\/?>/);
});

test("il layer viene montato PRIMA dei contenuti: nessuna rotta lo perde", () => {
  const toasterIdx = layout.indexOf("<AdminToaster");
  const navIdx = layout.indexOf("<AdminNav");
  const childrenIdx = layout.indexOf("{children}");
  assert.ok(toasterIdx !== -1, "AdminToaster assente dal layout");
  assert.ok(childrenIdx !== -1, "children assente dal layout");
  assert.ok(toasterIdx < childrenIdx, "AdminToaster dopo i contenuti: rotte con contenido + toast invertiti");
  assert.ok(navIdx === -1 || toasterIdx < navIdx, "AdminToaster dopo la nav: la nav glass sopra il layer può coprire i toast");
});

test("il layer toast ha le classi viewport-anchored (fixed, top-4, z-100)", () => {
  assert.match(toaster, /className="[^"]*\bfixed\b/);
  assert.match(toaster, /\binset-x-0\b/);
  assert.match(toaster, /\btop-4\b/);
  assert.match(toaster, /\bz-\[?100/);
  assert.match(toaster, /pointer-events-none/, "il layer deve lasciar passare i click (il veil non intercetta)");
});

test("la pillola glass è figlia del layer: nessun antenato glass tra layer e viewport", () => {
  const layerIdx = toaster.indexOf("pointer-events-none fixed");
  const pillIdx = toaster.indexOf("glass-strong");
  assert.ok(layerIdx !== -1, "layer non trovato");
  assert.ok(pillIdx > layerIdx, "glass-strong PRIMA del layer: un antenato glass bloccherebbe il fixed");
});

test("l'unico antenato del layer è main.aurora: il layout non aggiunge superfici a rischio", () => {
  // L'albero del layout è: <main class="aurora ..."> <AdminToaster/> ...
  // main non deve avere classi oltre ad aurora che creino containing block.
  const mainTag = layout.match(/<main\s+className="([^"]*)"/);
  assert.ok(mainTag, "il layout deve avere <main> con className");
  const risky = /backdrop-blur|backdrop-filter|\bfilter\b|will-change|transform|glass|blur-/.test(mainTag[1]);
  assert.equal(risky, false, `<main> porta classi a rischio: "${mainTag[1]}"`);
});

test(".aurora in globals.css resta solo gradient: nessun filtro che crei containing block", () => {
  const css = readFileSync(GLOBALS, "utf8");
  const block = css.match(/\.aurora\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, "blocco .aurora non trovato in globals.css");
  const risky = /backdrop-filter|filter\s*:|will-change|transform\s*:/.test(block[1]);
  assert.equal(risky, false, `.aurora ha acquisito proprietà a rischio:\n${block[0]}`);
});

test("nessuna rotta admin ha un layout proprio che bypassa il layout admin", () => {
  const dirs = readdirSync(ADMIN, { recursive: true, encoding: "utf8" })
    .map((f) => f.toString())
    .filter((f) => f.endsWith("layout.tsx"));
  assert.deepEqual(dirs, ["layout.tsx"], `layout aggiuntivi trovati: ${dirs.join(", ")}`);
});
