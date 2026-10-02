import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// Sentinelle dell'E2E consenso: il flusso GDPR deve restare coperto END-TO-END
// (banner → scelta → persistenza → cambio idea dal footer). Se qualcuno
// rinomina selettori chiave, toglie lo scenario o lo scollega dalla CI,
// la suite rompe qui, prima che il diritto di cambiare idea sparisca in
// silenzio dalla UI.

test("la spec E2E copre i quattro passi del consenso", () => {
  const spec = readFileSync(path.join(ROOT, "tests", "e2e", "consent.spec.ts"), "utf8");
  assert.match(spec, /Preferenze cookie/, "manca il selettore del banner");
  assert.match(spec, /Accetta tutti/, "manca lo scenario grant");
  assert.match(spec, /Solo necessari/, "manca lo scenario deny");
  assert.match(spec, /cambio idea/, "manca lo scenario di cambio idea dal footer");
  assert.match(spec, /googletagmanager/, "manca l'asserzione no-tracking pre-consenso");
  assert.match(spec, /toBe\("denied"\)/, "manca l'asserzione del valore denied");
  assert.match(spec, /toBe\("granted"\)/, "manca l'asserzione del valore granted");
});

test("il config Playwright deriva la porta E2E unica per repo", () => {
  assert.ok(existsSync(path.join(ROOT, "playwright.config.ts")), "manca playwright.config.ts");
  const config = readFileSync(path.join(ROOT, "playwright.config.ts"), "utf8");
  // Porta derivata dal percorso (portaE2ERepo, banda 3110–3189): i repo
  // gemelli con lo stesso stack copiato non si scontrano più (per due
  // volte la run del gemello «Web Agency Salento + Installer» occupava la
  // 3100 condivisa e i nostri login fallivano sul SUO database).
  assert.match(config, /portaE2ERepo/, "la porta E2E deve derivare dal percorso (portaE2ERepo)");
  assert.match(config, /E2E_PORT/, "E2E_PORT deve restare come override esplicito");
  assert.match(config, /reuseExistingServer/, "in locale deve riusare un server attivo");
  assert.match(config, /e2e-port-guard/, "il guard di porta deve restare agganciato al globalSetup");
});

test("portaE2ERepo: deterministica, in banda, mai la 3100 condivisa", async () => {
  const { portaE2ERepo } = await import(path.join(ROOT, "scripts", "e2e-port.cjs"));
  const p1 = portaE2ERepo("/tmp/wac-fixture-alfa");
  const p2 = portaE2ERepo("/tmp/wac-fixture-alfa");
  assert.equal(p1, p2, "lo stesso percorso deve dare sempre la stessa porta");
  assert.ok(p1 >= 3110 && p1 <= 3189, `la porta deve stare in banda 3110–3189 (visto ${p1})`);
  // Percorsi diversi nel tempo finiscono quasi sempre su porte diverse:
  // con queste due fixture la banda è abbastanza larga da non collidere.
  const altra = portaE2ERepo("/tmp/wac-fixture-beta");
  assert.notEqual(p1, altra, "percorsi fixture diversi devono dare porte diverse");
  // La vecchia 3100 condivisa coi gemelli non deve più tornare come default.
  assert.notEqual(portaE2ERepo(ROOT), 3100, "il default derivato non deve essere la 3100 legacy");
});

test("il flusso consenso resta raggiungibile dal footer (cambio idea)", () => {
  const footer = readFileSync(path.join(ROOT, "src", "components", "footer.tsx"), "utf8");
  assert.match(footer, /openPreferences/, "il footer deve chiamare openPreferences");
  assert.match(footer, /Preferenze cookie/, "il bottone del footer deve chiamarsi «Preferenze cookie»");
  const consent = readFileSync(path.join(ROOT, "src", "components", "consent.tsx"), "utf8");
  // Dopo una scelta il banner deve poter RIAPRIRE: la condizione di render
  // non può più dipendere da consent === "unknown".
  assert.ok(!/showBanner && consent === "unknown"/.test(consent), "il banner non deve richiedere consent unknown per riaprirsi");
});

test("l'E2E è agganciato a CI e a npm", () => {
  const wf = readFileSync(path.join(ROOT, ".github", "workflows", "overlay-guard.yml"), "utf8");
  assert.match(wf, /test:e2e/, "la CI non esegue l'E2E");
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:e2e"], "playwright test", "manca lo script test:e2e");
});
