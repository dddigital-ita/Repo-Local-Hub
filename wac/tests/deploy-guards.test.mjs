/**
 * TEST GUARDIE ANTINCIDENTE — proteggono la regola nata il 28/09/2026, quando
 * l'app fu registrata nella docroot del sito principale e Passenger coprì i
 * siti WordPress. Tre linee di difesa, verificate QUI senza toccare nulla:
 *
 *  1. server.js (boot guard): rifiuta l'avvio dentro public_html o in una
 *     docroot con ≥ 2 marker WordPress; override solo consapevole via env.
 *  2. wizard (src/lib/setup.ts · docrootGuard): rifiuta l'installazione
 *     nello stesso scenario, prima di scrivere un solo file.
 *  3. scripts/deploy-preflight.mjs: blocca dominio principale e WordPress
 *     PRIMA della registrazione su Setup Node.js App;
 *     scripts/verify-deploy.mjs --wp=… verifica dopo che il sito principale
 *     è ancora vivo.
 *
 * Stile del repo (vedi tests/setup-wizard.test.mjs): le decisioni si
 * verificano leggendo i sorgenti e, dove è puro, importando la logica.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const SERVER_JS = path.join(ROOT, "server.js");
const SETUP = path.join(ROOT, "src", "lib", "setup.ts");
const PREFLIGHT = path.join(ROOT, "scripts", "deploy-preflight.mjs");
const VERIFY = path.join(ROOT, "scripts", "verify-deploy.mjs");

const serverJs = readFileSync(SERVER_JS, "utf8");
const setup = readFileSync(SETUP, "utf8");
const preflight = readFileSync(PREFLIGHT, "utf8");
const verify = readFileSync(VERIFY, "utf8");

describe("boot guard di server.js", () => {
  test("la guardia gira PRIMA di richiedere next (l'app non parte affatto)", () => {
    const guardPos = serverJs.indexOf("runBootGuard()");
    const nextPos = serverJs.indexOf('require("next")');
    assert.ok(guardPos > -1, "chiamata runBootGuard() presente");
    assert.ok(nextPos > -1, "require di next presente");
    assert.ok(guardPos < nextPos, "la guardia deve precedere il caricamento di next");
  });

  test("vietate per nome: public_html e affini", () => {
    assert.match(serverJs, /public_html/);
    assert.match(serverJs, /htdocs/);
  });

  test("vietata per contenuto: servono almeno 2 marker WordPress indipendenti", () => {
    for (const marker of ["wp-config.php", "wp-settings.php", "wp-admin", "wp-includes", "wp-content"]) {
      assert.ok(serverJs.includes(marker), `marker ${marker} considerato dal rilevamento`);
    }
    assert.match(serverJs, /WP_THRESHOLD = 2/, "soglia di 2 marker: niente falsi positivi su cartelle nostre");
  });

  test("l'override esiste ma è esplicito e nominato", () => {
    assert.match(serverJs, /WAC_ALLOW_ANY_DOCROOT/);
  });
});

describe("docrootGuard del wizard (src/lib/setup.ts)", () => {
  test("esiste ed è esportata", () => {
    assert.match(setup, /export function docrootGuard/);
  });

  test("runInstall la chiama PRIMA di qualunque scrittura (markInProgress dopo la guardia)", () => {
    const guardPos = setup.indexOf("const guard = docrootGuard()");
    // col «;» per non matchare la DEFINIZIONE della funzione, più su nel file
    const markPos = setup.indexOf("markInProgress();");
    assert.ok(guardPos > -1, "runInstall invoca docrootGuard");
    assert.ok(markPos > -1);
    assert.ok(guardPos < markPos, "la guardia precede markInProgress: nessun file scritto se non è sicuro");
  });

  test("rifiuta public_html e i marker WordPress, e punta alla procedura giusta", () => {
    const fn = setup.slice(setup.indexOf("export function docrootGuard"), setup.indexOf("export type SetupState"));
    assert.match(fn, /public_html/);
    assert.match(fn, /wp-config\.php/);
    assert.match(fn, /markers\.length >= 2/);
    assert.ok(setup.includes("sottodominio dedicato"), "il messaggio d'errore insegna la procedura corretta");
  });
});

describe("preflight e verify (scripts)", () => {
  test("deploy-preflight.mjs blocca i domini principali via DEPLOY_PRIMARY_DOMAINS", () => {
    assert.match(preflight, /DEPLOY_PRIMARY_DOMAINS/);
    assert.match(preflight, /dddigital\.net/);
    assert.match(preflight, /wp-content/);
    assert.match(preflight, /wp-json|generator/);
  });

  test("verify-deploy.mjs accetta --wp e considera 200/301 'vivo', 5xx/errore no", () => {
    assert.match(verify, /--wp=/);
    assert.match(verify, /status === 200 \|\| .*status === 301/);
    assert.match(verify, /Passenger|sta coprendo/);
  });
});

describe("boot guard: comportamento reale su cartelle simulate", () => {
  const nodeBin = process.execPath;

  function tryBootIn(dir, env = {}) {
    // La guardia guarda __dirname (dove VIVE server.js), quindi la fixture
    // deve contenere una copia di server.js: è esattamente ciò che accadrebbe
    // caricando il progetto nella docroot sbagliata.
    copyFileSync(SERVER_JS, path.join(dir, "server.js"));
    try {
      execFileSync(nodeBin, [path.join(dir, "server.js")], {
        cwd: dir,
        env: { ...process.env, ...env, PORT: "0" },
        timeout: 15_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { exit: 0, stderr: "" };
    } catch (err) {
      const e = err;
      return { exit: e.status ?? 1, stderr: String(e.stderr ?? "") + String(e.stdout ?? "") };
    }
  }

  test("rifiuta l'avvio dentro public_html con dentro un WordPress", () => {
    const tmp = path.join(os.tmpdir(), `wac-guard-test-${Date.now()}`, "public_html");
    mkdirSync(path.join(tmp, "wp-admin"), { recursive: true });
    mkdirSync(path.join(tmp, "wp-includes"), { recursive: true });
    writeFileSync(path.join(tmp, "wp-config.php"), "<?php // test fixture\n");
    writeFileSync(path.join(tmp, "index.php"), "<?php // wp fixture\n");

    const { exit, stderr } = tryBootIn(tmp);
    assert.notEqual(exit, 0, "il processo deve uscire con errore");
    assert.match(stderr, /AVVIO RIFIUTATO/);
    assert.match(stderr, /public_html/);
  });

  test("rifiuta l'avvio in qualunque cartella con ≥ 2 marker WordPress (anche fuori public_html)", () => {
    const tmp = path.join(os.tmpdir(), `wac-guard-test2-${Date.now()}`, "sito-principale");
    mkdirSync(path.join(tmp, "wp-includes"), { recursive: true });
    writeFileSync(path.join(tmp, "wp-config.php"), "<?php // test fixture\n");

    const { exit, stderr } = tryBootIn(tmp);
    assert.notEqual(exit, 0);
    assert.match(stderr, /WordPress/);
  });

  test("l'override consapevole WAC_ALLOW_ANY_DOCROOT=1 lascia proseguire il boot (e fallire per mancanza di .next)", () => {
    const tmp = path.join(os.tmpdir(), `wac-guard-test3-${Date.now()}`, "public_html");
    mkdirSync(path.join(tmp, "wp-includes"), { recursive: true });
    writeFileSync(path.join(tmp, "wp-config.php"), "<?php // test fixture\n");

    const { exit, stderr } = tryBootIn(tmp, { WAC_ALLOW_ANY_DOCROOT: "1" });
    assert.notEqual(exit, 0, "senza .next il boot fallisce comunque, ma per un ALTRO motivo");
    assert.doesNotMatch(stderr, /AVVIO RIFIUTATO/, "nessun rifiuto della guardia quando l'override è attivo");
  });
});
