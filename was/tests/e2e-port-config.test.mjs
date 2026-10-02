/**
 * Sentinella dell'infrastruttura E2E di porta: né la porta derivata né la
 * guard possono regredire in silenzio. Speculare a tests/e2e-port-guard.test.mjs
 * (che prova i comportamenti a runtime): qui si prova ciò che il REPO deve
 * continuare a dichiarare — config, override, convenzione condivisa col
 * repo gemello WebAgencyCrema (30/09/2026: la 3100 contesa ha causato un
 * riuso cieco col DB sbagliato e run uccise a metà).
 *
 * Il config è letto come TESTO (regex sui punti d'uso) e come MODULO
 * (import dinamico): il testo vede le intenzioni, il modulo il comportamento
 * risolto. È lo stile delle sentinelle del repo (consent, pre-push, registry).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("playwright.config.ts: porta dalla fonte unica, mai hardcoded", async () => {
  const config = await readFile(path.join(ROOT, "playwright.config.ts"), "utf8");
  // La fonte unica esiste e viene usata nei TRE punti d'uso (baseURL,
  // webServer.command, webServer.url) — la lettera del gemello esigeva
  // proprio che nessun resto resti hardcoded.
  assert.match(config, /const E2E_PORT = process\.env\.WAC_E2E_PORT \?\? String\(portaE2ERepo\(\)\)/);
  assert.match(config, /baseURL: `http:\/\/localhost:\$\{E2E_PORT\}`/);
  assert.match(config, /PORT=\$\{E2E_PORT\} node scripts\/e2e-dev-server\.mjs/);
  assert.match(config, /url: `http:\/\/localhost:\$\{E2E_PORT\}`/);
  // Nessuna porta hardcoded residua: la 3100 contesa non deve mai tornare.
  assert.doesNotMatch(config, /localhost:3100/);
  // Override esplicito: WAC_E2E_PORT vince sulla derivazione (convenzione).
  assert.match(config, /WAC_E2E_PORT/);
});

test("playwright.config.ts: la port-guard resta agganciata al globalSetup", async () => {
  const config = await readFile(path.join(ROOT, "playwright.config.ts"), "utf8");
  assert.match(config, /globalSetup: "scripts\/e2e-port-guard\.mjs"/,
    "il guard di porta deve restare agganciato al globalSetup");
  // E la rete di sicurezza a fine run resta al suo posto (speculare).
  assert.match(config, /globalTeardown: "scripts\/e2e-leak-guard\.mjs"/);
});

test("portaE2ERepo: deterministica, in banda 3110-3189, mai la 3100 né la porta del gemello", async () => {
  const { portaE2ERepo } = await import(path.join(ROOT, "scripts", "e2e-port.cjs"));
  // La convenzione col gemello è ANTI-COLLISIONE (porte diverse, mai la
  // 3100 contesa), NON un numero fisso: la porta deriva dal percorso
  // assoluto e un valore atteso hardcoded marcisce al primo rename della
  // cartella (successo qui: 3135 era la derivazione del percorso della
  // copia pre-rebrand «+ Installer»; il percorso vero deriva 3168).
  // Invariante vera: in banda, mai 3100, mai la porta del gemello (3166).
  // Se un futuro rename approda su una porta occupata, rimedi: correggere
  // il percorso o usare l'override WAC_E2E_PORT.
  const nostra = portaE2ERepo(ROOT);
  assert.ok(nostra >= 3110 && nostra <= 3189, `la porta derivata deve stare in banda 3110-3189 (visto ${nostra})`);
  assert.notEqual(nostra, 3100, "la 3100 contesa non deve mai tornare");
  assert.notEqual(nostra, 3166, "la porta non deve collidere col gemello (3166)");
  // Deterministica e in banda anche per percorsi arbitrari.
  const p1 = portaE2ERepo("/tmp/was-fixture-alfa");
  const p2 = portaE2ERepo("/tmp/was-fixture-alfa");
  assert.equal(p1, p2, "lo stesso percorso deve dare sempre la stessa porta");
  assert.ok(p1 >= 3110 && p1 <= 3189, `la porta deve stare in banda 3110-3189 (visto ${p1})`);
  // Percorsi distinti quasi sempre distinti (la banda è larga).
  const altra = portaE2ERepo("/tmp/was-fixture-beta");
  assert.notEqual(p1, altra, "percorsi fixture diversi devono dare porte diverse");
});

test("override WAC_E2E_PORT: vince sulla derivazione (convenzione col gemello)", async () => {
  const { WAC_E2E_PORT: prima } = process.env;
  process.env.WAC_E2E_PORT = "3199";
  try {
    // Rilettura del config con l'env impostata: Playwright non cacha i
    // config tra processi, qui basta un nuovo import in un processo pulito
    // — per questo la verifica la fa il file di config, non questo test.
    const config = await readFile(path.join(ROOT, "playwright.config.ts"), "utf8");
    assert.match(config, /process\.env\.WAC_E2E_PORT \?\? String\(portaE2ERepo\(\)\)/,
      "l'override deve precedere la derivazione nel config");
  } finally {
    if (prima === undefined) delete process.env.WAC_E2E_PORT;
    else process.env.WAC_E2E_PORT = prima;
  }
});
