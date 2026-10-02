/**
 * SENTINELLA DEL REGISTRO E2E — il README promette cosa copre ogni spec
 * (sezione «Test»): questa guardia fallisce quando docs e realtà divergono,
 * nelle due direzioni in cui divergono davvero:
 *
 *  1. SPEC NON REGISTRATA: una nuova spec in tests/e2e senza riga nel
 *     registro — la routine di guardia (README) poggia su quella lista:
 *     una spec dimenticata è un'area che i bump/tag rilasciano incustodita;
 *  2. REGISTRO BUGIARDO: una riga che punta a un file che non esiste più
 *     (spec rinominata o rimossa) — la doc che comanda run a mano deve
 *     restare eseguibile lettera per lettera.
 *
 * Il parsi è deliberamente stupido (righe tabellari markdown): il registro
 * è per le persone prima che per la guardia. Letto dal REALE README.md, non
 * da una copia: la verità è una sola (come le sentinelle di contrasto).
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readSource } from "./helpers/source.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Il README si legge RAW: è markdown — stripComments taglierebbe gli `//`
 *  degli URL come fossero commenti. Il registro è contenuto, non codice. */
const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");

/** Le spec realmente su disco (la stessa estensione della config Playwright). */
function specReali() {
  return readdirSync(path.join(ROOT, "tests/e2e"))
    .filter((f) => f.endsWith(".spec.ts"))
    .sort();
}

/** Le righe del registro markdown: `| \`nome.spec.ts\` | descrizione |`. */
function registroDalReadme(md) {
  const righe = md.split("\n").filter((l) => /^\|\s*`[^`]+\.spec\.ts`\s*\|/.test(l));
  return righe.map((l) => {
    const m = l.match(/^\|\s*`([^`]+\.spec\.ts)`\s*\|/);
    return m?.[1] ?? "";
  });
}

describe("registro E2E nel README", () => {
  test("il README contiene il registro tabellare delle spec", () => {
    const registro = registroDalReadme(readme);
    assert.ok(registro.length > 0, "nessuna riga `| `nome.spec.ts` | … |` trovata nel README");
  });

  test("ogni spec su disco è registrata (nessuna area incustodita)", () => {
    const registro = registroDalReadme(readme);
    const mancano = specReali().filter((f) => !registro.includes(f));
    assert.deepEqual(
      mancano,
      [],
      "spec senza riga nel registro README (sezione «Test»): aggiungerle alla lista " +
        "con la loro copertura, altrimenti la routine di guardia non le vede",
    );
  });

  test("il registro non punta a spec inesistenti (doc eseguibile)", () => {
    const registro = registroDalReadme(readme);
    const reali = specReali();
    const fantasmi = registro.filter((f) => !reali.includes(f));
    assert.deepEqual(
      fantasmi,
      [],
      "il README registra spec che non esistono più: rimuovere le righe (o reintegrare le spec)",
    );
  });

  test("nessun doppione nel registro (una spec, una riga)", () => {
    const registro = registroDalReadme(readme);
    const doppi = registro.filter((f, i) => registro.indexOf(f) !== i);
    assert.deepEqual(doppi, [], "righe duplicate nel registro");
  });

  test("le eccezioni documentate sono reali: prodlike-captcha è fuori routine nella config", () => {
    // La doc dice che prodlike-captcha gira solo con la config prodlike:
    // la promessa è vera se playwright.config.ts lo esclude davvero (nel
    // CODICE, non in un commento: qui sì readSource, è TypeScript).
    const config = readSource("playwright.config.ts").code;
    assert.match(
      config,
      /testIgnore:\s*\/prodlike-\(captcha\|cache\|admin-skeleton\)/,
      "le spec prodlike non sono più escluse dalla config: aggiornare la nota nel README",
    );
  });
});
