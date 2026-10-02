/**
 * TEST PRE-PUSH GUARD — il hook versionato fa il suo lavoro senza spingere
 * nulla: githooks/pre-push esegue l'overlay guard e ne propaga l'esito,
 * quindi e' sufficiente eseguirlo come script (il repo e' pulito: esce 0).
 *
 * Copre:
 *  1. il hook esiste, e' eseguibile e chiama l'overlay guard;
 *  2. eseguito in questo repo (pulito) esce 0;
 *  3. package.json attiva core.hooksPath=githooks via postinstall;
 *  4. il hook e' attivo ANCHE in questa checkout (config locale);
 *  5. il workflow CI esiste e invoca il guard PRIMA di typecheck e test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, accessSync, constants } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();

test("il hook pre-push esiste, e' eseguibile e chiama l'overlay guard", () => {
  const hookPath = path.join(ROOT, "githooks", "pre-push");
  accessSync(hookPath, constants.X_OK); // lancia se non eseguibile
  const hook = readFileSync(hookPath, "utf8");
  assert.match(hook, /overlay-guard\.mjs/);
});

test("eseguito nel repo (pulito) il hook esce 0", () => {
  const out = execFileSync("sh", [path.join(ROOT, "githooks", "pre-push")], {
    encoding: "utf8",
    cwd: ROOT,
  });
  assert.match(out, /overlay guard/);
});

test("package.json attiva core.hooksPath=githooks via postinstall", () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  // Tollera il salvagente «|| true»: su cPanel l'install gira SENZA repo git
  // e il postinstall non deve far fallire npm install; in dev (con .git)
  // il test successivo verifica che il hook sia davvero attivo.
  assert.match(pkg.scripts.postinstall, /^git config core\.hooksPath githooks( 2>\/dev\/null)?( \|\| true)?$/);
});

test("il hook e' attivo in questa checkout (core.hooksPath = githooks)", () => {
  const active = execFileSync("git", ["config", "core.hooksPath"], {
    encoding: "utf8",
    cwd: ROOT,
  }).trim();
  assert.equal(active, "githooks");
});

test("il workflow CI invoca il guard prima di typecheck e test", () => {
  const wf = readFileSync(
    path.join(ROOT, ".github", "workflows", "overlay-guard.yml"),
    "utf8",
  );
  assert.match(wf, /overlay-guard\.mjs/);
  const guardIdx = wf.indexOf("node scripts/overlay-guard.mjs"); // step `run:`
  const typeIdx = wf.indexOf("npm run typecheck");
  const testIdx = wf.indexOf("npm test");
  assert.ok(guardIdx !== -1, "manca lo step del guard");
  assert.ok(typeIdx !== -1 && typeIdx > guardIdx, "typecheck prima del guard");
  assert.ok(testIdx !== -1 && testIdx > typeIdx, "test prima del typecheck");
});
