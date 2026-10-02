/**
 * TEST A/B DELL'HERO — regole pure verificate dove vivono (ab-shared.ts,
 * hero-shared.ts). Come hero-shared.test.mjs: import diretto del .ts.
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  AB_VARIANTS,
  abHash,
  abBucket,
  abDecision,
  abVariantLabel,
} = await import("../src/lib/ab-shared.ts");
const { sanitizeHeroConfig, heroStatus, DEFAULT_HERO } = await import("../src/lib/hero-shared.ts");

test("hash: deterministico, sensibile all'input, a 32 bit senza segno", () => {
  assert.equal(abHash("coorte-1"), abHash("coorte-1"), "stesso input → stesso hash");
  assert.notEqual(abHash("coorte-1"), abHash("coorte-2"));
  assert.ok(abHash("qualsiasi") <= 0xffffffff);
});

test("bucketing: 50/50 su 2000 coorti e stabile per la stessa coorte", () => {
  let animated = 0;
  const first = new Map();
  for (let i = 0; i < 2000; i++) {
    const v = abBucket(`cohort-${i}`);
    if (v === "animated") animated++;
    if (!first.has(i)) first.set(i, v);
    assert.equal(abBucket(`cohort-${i}`), first.get(i), "la coorte non cambia variante");
  }
  const share = animated / 2000;
  assert.ok(share > 0.45 && share < 0.55, `quota animato ${share} fuori dal 50/50`);
});

test("varianti: etichette GA4 stabili «statico»/«animato»", () => {
  assert.deepEqual([...AB_VARIANTS], ["control", "animated"]);
  assert.equal(abVariantLabel("control"), "statico");
  assert.equal(abVariantLabel("animated"), "animato");
});

test("decisione: test OFF = vale la config salvata, com'era prima dell'A/B", () => {
  const off = { enabled: true, abTest: "off" };
  assert.deepEqual(abDecision(off, "cohort-1"), { variant: "animated", showAnimated: true });

  const offStatic = { enabled: false, abTest: "off" };
  assert.deepEqual(abDecision(offStatic, "cohort-1"), { variant: "control", showAnimated: false });
});

test("decisione: test ON = il bucket comanda, la config animata serve solo al gruppo animato", () => {
  const cfg = { enabled: true, abTest: "on" };
  for (let i = 0; i < 200; i++) {
    const { variant, showAnimated } = abDecision(cfg, `c-${i}`);
    assert.equal(showAnimated, variant === "animated", "showAnimated segue il bucket");
    assert.ok(["control", "animated"].includes(variant));
  }
  // Coorti note (regressione: il bucketing non deve cambiare a metà test).
  assert.equal(abBucket("c-0"), abBucket("c-0"));
});

test("config: abTest solo on/off, default off — nessun test per errore", () => {
  assert.equal(sanitizeHeroConfig({}).abTest, "off");
  assert.equal(sanitizeHeroConfig({ abTest: "on" }).abTest, "on");
  assert.equal(sanitizeHeroConfig({ abTest: "SI" }).abTest, "off");
  assert.equal(DEFAULT_HERO.abTest, "off");
});

test("stato hub: A/B acceso dice «A/B» anche con enabled false (la home è comunque divisa)", () => {
  assert.match(heroStatus({ enabled: false, template: "caret", abTest: "on" }).label, /^A\/B · Caret$/);
  assert.equal(heroStatus({ enabled: false, template: "caret", abTest: "on" }).ok, true);
  assert.match(heroStatus({ enabled: true, template: "lens", abTest: "off" }).label, /Attivo · Lens/);
  assert.equal(heroStatus({ enabled: false, template: "lens", abTest: "off" }).label, "Statico");
});
