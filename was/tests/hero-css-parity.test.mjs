import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Sentinella di parità di src/app/hero.css — lo stile dell'hero animato.
 * È FUORI dal perimetro twin-sync (src/app/ = pagine/route mai condivise),
 * ma è di fatto gemello-pari: qui una guardia dedicata lo tiene identico
 * al byte, con salto educato se il checkout gemello non è raggiungibile.
 */

const ROOT = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(ROOT, "twin-sync.json"), "utf8"));
const TWIN_ROOT = path.join(path.dirname(ROOT), manifest["twin-name"]);
const gemelloPresente = existsSync(path.join(TWIN_ROOT, "package.json"));

const HERO = readFileSync(path.join(ROOT, "src", "app", "hero.css"), "utf8");

test("hero.css contiene la sezione reveal in sequenza unificata", () => {
  for (const selettore of [
    ".hero-sequence .hero-step",
    "@keyframes hero-step-in",
    ".hero-sequence-chips .hero-chip:nth-child(4)",
    "prefers-reduced-motion",
  ]) {
    assert.ok(HERO.includes(selettore), `manca ${selettore} in hero.css`);
  }
  // La sezione non deve tornare in globals.css (doppia definizione = doppio ritmo).
  const globals = readFileSync(path.join(ROOT, "src", "app", "globals.css"), "utf8");
  assert.ok(!globals.includes("hero-sequence .hero-step"), "hero-sequence è tornato in globals.css: vive solo in hero.css");
});

test(
  "hero.css è byte-identico al gemello",
  { skip: gemelloPresente ? false : "checkout gemello non raggiungibile" },
  () => {
    const loro = readFileSync(path.join(TWIN_ROOT, "src", "app", "hero.css"), "utf8");
    assert.equal(HERO, loro, "hero.css è divergiato: uniformare PRIMA di modificare l'hero");
  },
);
