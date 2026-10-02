import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// Sorveglianza bundle (Passo 4 del piano): le sentinelle verificano che il
// workflow di misura resti collegato agli script reali e al budget deciso.
// Se un domani cambia il nome degli script o il budget, questo test deve
// rompersi PRIMA del deploy, non dopo.

test("il workflow bundle-watch misura il payload con lo script del repo", () => {
  const wf = readFileSync(path.join(ROOT, ".github", "workflows", "bundle-watch.yml"), "utf8");
  assert.match(wf, /scripts\/measure-payload\.mjs/, "il workflow non usa measure-payload.mjs");
  assert.match(wf, /scripts\/check-bundle-budget\.mjs/, "il workflow non applica il budget");
  assert.match(wf, /scripts\/check-framer-firstload\.mjs/, "il workflow non esegue la sentinella framer-firstload");
  assert.match(wf, /npm run build/, "il workflow non cronometra la build di release");
  assert.match(wf, /GITHUB_STEP_SUMMARY/, "manca la registrazione nella summary");
});

test("lo script sentinella framer sorveglia le rotte pubbliche giuste", () => {
  // Home + una landing + la chat: se un domani si aggiunge una rotta è un
  // arricchimento, ma queste tre devono restare (layout, [slug], Chat).
  const s = readFileSync(path.join(ROOT, "scripts", "check-framer-firstload.mjs"), "utf8");
  assert.match(s, /"\/",/, "manca la home dalle rotte sorvegliate");
  assert.match(s, /siti-web-gallipoli/, "manca una landing dalle rotte sorvegliate");
  assert.match(s, /consulenza/, "manca la chat dalle rotte sorvegliate");
  assert.match(s, /nomodule/i, "lo script deve escludere i polyfill nomodule");
  assert.match(s, /process\.exit\(1\)/, "lo script deve fallire il CI alla contaminazione");
});

test("la build di release resta webpack: il budget 180 è calibrato su quella misura", () => {
  // L'anello che ha reso criptico l'allarme «278 kB vs 210»: il workflow chiama
  // `npm run build`, ma se qualcuno toglie --webpack dallo script, next build
  // default a Turbopack e la misura salta a ~258 kB (misurato 2026-09-30 col
  // metodo corretto: webpack 168,4 · turbopack 257,9 — splitting diverso,
  // stesso codice). Il budget NON è un giudizio su Turbopack: è il contratto
  // della build webpack. Se un domani si volesse Turbopack in produzione, si
  // rimisura e si aggiorna il budget CONSAPEVOLMENTE, poi si cambia QUESTO
  // test di proposito — non per silenzio.
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  for (const script of ["build", "build:local"]) {
    assert.match(
      pkg.scripts[script] ?? "",
      /next build --webpack/,
      `package.json «${script}» non usa --webpack: il budget del bundle-watch misurerebbe un bundler diverso da quello del contratto`,
    );
  }
});

test("il budget d'allarme è dichiarato ed esplicito nel workflow", () => {
  const wf = readFileSync(path.join(ROOT, ".github", "workflows", "bundle-watch.yml"), "utf8");
  const match = wf.match(/--budget (\d+)/);
  assert.ok(match, "manca il flag --budget nel workflow");
  const budget = Number(match[1]);
  // Basare misurata 2026-09-30 (metodo corretto, senza polyfill nomodule):
  // webpack 168,4 kB + 6% ≈ 180. Finestra: 160–200, il contratto reale.
  assert.ok(budget >= 160 && budget <= 200, `budget ${budget} fuori dalla finestra ragionevole (160–200 kB)`);
});

test("la misura esclude i polyfill nomodule (payload che i browser non pagano)", () => {
  // Il tag <script nomodule> è ignorato da ogni browser moderno: contarlo
  // gonfiava la misura di ~39 kB fantasma. Lo script deve filtrarli.
  const measure = readFileSync(path.join(ROOT, "scripts", "measure-payload.mjs"), "utf8");
  assert.match(measure, /nomodule/i, "measure-payload non esclude i polyfill nomodule");
});

test("measure-payload produce il formato FIRST_LOAD_GZ_KB che il budget legge", () => {
  const measure = readFileSync(path.join(ROOT, "scripts", "measure-payload.mjs"), "utf8");
  assert.match(measure, /FIRST_LOAD_GZ_KB=/, "measure-payload non stampa il marker del budget");
  const checker = readFileSync(path.join(ROOT, "scripts", "check-bundle-budget.mjs"), "utf8");
  assert.match(checker, /FIRST_LOAD_GZ_KB=/, "check-bundle-budget non legge il marker prodotto");
});

test("gli script della sorveglianza esistono nel repo", () => {
  assert.ok(existsSync(path.join(ROOT, "scripts", "measure-payload.mjs")), "manca measure-payload.mjs");
  assert.ok(existsSync(path.join(ROOT, "scripts", "check-bundle-budget.mjs")), "manca check-bundle-budget.mjs");
});
