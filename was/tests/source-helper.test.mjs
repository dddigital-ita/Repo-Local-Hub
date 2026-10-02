/**
 * HELPER DI LETTURA PER LE SENTINELLE (tests/helpers/source.mjs) — i test
 * che lo usano devono avere la garanzia che le asserzioni cadano sul
 * CODICE, mai sui commenti. Il caso che ha motivato l'helper: la sentinella
 * `size: "invisible"` è passata «per caso», cadendo sul commento che
 * spiegava perché l'opzione non c'è più nel codice.
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { stripComments, readSource, codeBlock, assertInCode, assertNotInCode } from "./helpers/source.mjs";

test("source: stripComments toglie il commento di riga, l'URL in stringa resta intero", () => {
  const src = [
    'const url = "https://dash.cloudflare.com/?to=/:account/turnstile"; // utile',
    "const other = 'https://challenges.cloudflare.com/turnstile/v0/api.js'; // x",
  ].join("\n");
  const out = stripComments(src);
  assert.ok(out.includes('"https://dash.cloudflare.com/?to=/:account/turnstile"'), "la stringa non è troncata dal // interno");
  assert.ok(out.includes("'https://challenges.cloudflare.com/turnstile/v0/api.js'"), "anche i single quote");
  assert.ok(!out.includes("// utile"), "il commento di riga è sparito");
});

test("source: commento a blocchi, stringhe con escape e template letterali", () => {
  const src = [
    "/* intestazione",
    "   su più righe */",
    'const a = "testo con \\"apici\\" e // dentro"; /* coda */ const b = 1;',
    "const c = `template con // e /* blocco */ dentro`;",
  ].join("\n");
  const out = stripComments(src);
  assert.ok(out.includes('"testo con \\"apici\\" e // dentro"'), "la stringa con escape resta intera");
  assert.ok(out.includes("`template con // e /* blocco */ dentro`"), "i template sono letterali");
  assert.ok(!out.includes("intestazione") && !out.includes("coda"), "i commenti a blocchi spariscono");
});

test("source: ${…} nei template è codice — i commenti dentro spariscono, il resto resta", () => {
  const src = "const msg = `totale ${count /* count attivo */ + 1} euro`;";
  const out = stripComments(src);
  // I commenti a blocchi diventano uno spazio: l'espressione resta valida.
  assert.ok(/\$\{count\s+\+\s+1\}/.test(out), "l'espressione è pulita (spazi multipli inclusi)");
  assert.ok(!out.includes("count attivo"), "il commento dentro ${} è sparito");
});

test("source: il caso Turnstile — l'asserzione cade sul codice, mai sul commento", () => {
  const widget = readSource("src/components/turnstile-widget.tsx");
  // Precondizione: nel file reale la stringa storica esiste SOLO nel
  // commento — sul raw un includes la troverebbe (falso positivo).
  assert.ok(widget.raw.includes('size: "invisible"'), "il commento contiene la stringa storica");
  assert.ok(!widget.code.includes('size: "invisible"'), "il codice senza commenti NON la contiene: la sentinella può affermarlo davvero");
});

test("source: codeBlock isola il punto giusto (turnstile.render)", () => {
  const code = [
    "turnstile.render(container, {",
    "  sitekey: siteKey,",
    '  size: "invisible", // solo nella fixture del test',
    "  callback: () => resolve(),",
    "});",
  ].join("\n");
  const block = codeBlock(stripComments(code), "turnstile.render(container, {", "callback:");
  assert.ok(block.includes("sitekey: siteKey,"), "il blocco è quello atteso");
  assert.ok(block.includes('size: "invisible"'), "la size in codice viene vista");
  assert.ok(!stripComments(code).includes("solo nella fixture"), "il commento della fixture è sparito");
});

test("source: asserzioni esplicite con messaggio dedicato", () => {
  assertInCode("const a = 1;", "const a", "deve esserci");
  assertNotInCode("const a = 1; // const b", "const b", "non deve esserci (solo in commento)");
  assert.throws(() => assertInCode("const a = 1;", "const zzz", "manca"), /manca/);
});
