import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
  assert.match(wf, /npm run build/, "il workflow non cronometra la build di release");
  assert.match(wf, /GITHUB_STEP_SUMMARY/, "manca la registrazione nella summary");
});

test("il budget d'allarme è dichiarato ed esplicito nel workflow", () => {
  const wf = readFileSync(path.join(ROOT, ".github", "workflows", "bundle-watch.yml"), "utf8");
  const match = wf.match(/--budget (\d+)/);
  assert.ok(match, "manca il flag --budget nel workflow");
  const budget = Number(match[1]);
  assert.ok(budget >= 190 && budget <= 260, `budget ${budget} fuori dalla finestra ragionevole (190–260 kB)`);
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

test("framer-motion resta confinato ai componenti admin", () => {
  // La chat (/consulenza) era l'ultimo componente pubblico che fetchava
  // framer nel browser: il chunk (40 kB gzip) viaggiava nel flight RSC e
  // la misura first load non lo vedeva (legge solo i tag src/href).
  // Da 0.6.1 il pubblico è framer-free: se qualcuno reimporta framer in
  // un componente pubblico, questa sentinella rompe prima del deploy.
  // Ammessi SOLO i componenti dietro login admin (mai fetchati dal pubblico).
  // maintenance-panel.tsx (2026-10-02): switch on/off tipo sveglia iOS
  // per il gate di manutenzione — il knob scorre con una molla framer
  // (stesso modello di toggle.tsx); la scheda vive in /admin/tools,
  // mai nel bundle dei visitatori.
  const AMMESSI = new Set([
    "src/components/admin-nav.tsx",
    "src/components/admin-toaster.tsx",
    "src/components/maintenance-panel.tsx",
    "src/components/status-pills.tsx",
    "src/components/toggle.tsx",
  ]);
  const violazioni = [];
  const scan = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) scan(p);
      else if (/\.tsx?$/.test(e.name) && readFileSync(p, "utf8").includes("from \"framer-motion\"")) {
        if (!AMMESSI.has(path.relative(ROOT, p))) violazioni.push(path.relative(ROOT, p));
      }
    }
  };
  scan(path.join(ROOT, "src"));
  assert.deepEqual(violazioni, [], `framer-motion tornato in file pubblici: ${violazioni.join(", ")} — usa le animazioni CSS (globals.css / chat.css), come fatto per Chat e login-card`);
});

test("la build di release resta su webpack: cambiare bundler invalida la misura", () => {
  // Il contratto 242→255 kB è misurato su next build --webpack: il default
  // di Next 16 (Turbopack) fa un bundle diverso (il regresso 278 kB è quel
  // bundler con framer). Se qualcuno toglie --webpack dallo script, il
  // workflow continua a girare ma misura un altro bundler: l'allarme diventa
  // rumore (o non suona più). La sentinella pinna lo strumento della misura.
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  for (const script of ["build", "build:local"]) {
    const cmd = pkg.scripts?.[script];
    assert.ok(cmd, `manca lo script "${script}" in package.json`);
    assert.match(
      cmd,
      /next build\s+--webpack(\s|$)/,
      `"${script}" non usa più --webpack: il workflow bundle-watch misurerebbe un bundler diverso da quello del contratto (242 kB). Rimettere --webpack, oppure ricalibrare il contratto CONSAPEVOLMENTE e aggiornare la storia in bundle-watch.yml.`
    );
  }
});
