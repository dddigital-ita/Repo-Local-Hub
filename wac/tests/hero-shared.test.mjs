/**
 * HERO ANIMATO — regole pure verificate dove vivono (hero-shared.ts).
 * Come tools-status.test.mjs: import diretto del .ts, nessun mock.
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  DEFAULT_HERO,
  HERO_TEMPLATES,
  HERO_CURSORS,
  sanitizeHeroConfig,
  heroWithFallbacks,
  heroVars,
  heroStatus,
  validHex,
} = await import("../src/lib/hero-shared.ts");

test("default: hero SPENTO e template spotlight — la home resta com'è", () => {
  const def = sanitizeHeroConfig(undefined);
  assert.equal(def.enabled, false, "il default non cambia la home pubblica");
  assert.equal(def.template, "spotlight");
  assert.ok(def.title.length > 0);
  assert.ok(def.placeholder.length > 0);
});

test("8 template noti: la scelta fuori catalogo degrada al default senza lanciare", () => {
  assert.equal(HERO_TEMPLATES.length, 8, "4 serissimi + 4 di nuova generazione");
  for (const t of HERO_TEMPLATES) {
    assert.equal(sanitizeHeroConfig({ template: t }).template, t);
  }
  assert.equal(sanitizeHeroConfig({ template: "fireworks" }).template, "spotlight");
  assert.equal(sanitizeHeroConfig({ template: 42 }).template, "spotlight");
});

test("cursore: 5 temi noti, valore fuori catalogo o assente → glow (compatibilità)", () => {
  assert.equal(HERO_CURSORS.length, 5, "glow, lens, comet, elastic + none (statico)");
  assert.equal(sanitizeHeroConfig({ cursor: "comet" }).cursor, "comet");
  assert.equal(sanitizeHeroConfig({ cursor: "lens" }).cursor, "lens");
  assert.equal(sanitizeHeroConfig({ cursor: "elastic" }).cursor, "elastic");
  assert.equal(sanitizeHeroConfig({ cursor: "none" }).cursor, "none", "statico = nessun effetto");
  assert.equal(sanitizeHeroConfig({ cursor: "ring" }).cursor, "glow", "vecchio tema ring → glow");
  assert.equal(sanitizeHeroConfig({ cursor: "spongebob" }).cursor, "glow");
  assert.equal(sanitizeHeroConfig({}).cursor, "glow", "salvataggi vecchi senza il campo → glow");
});

test("colore cursore: solo hex valido, altrimenti vuoto (= token brand)", () => {
  assert.equal(sanitizeHeroConfig({ cursorAccent: "#FF00AA" }).cursorAccent, "#ff00aa");
  assert.equal(sanitizeHeroConfig({ cursorAccent: "viola" }).cursorAccent, "");
  const custom = heroVars({ ...DEFAULT_HERO, cursor: "comet", cursorAccent: "#0aff9d" });
  assert.equal(custom["--hero-cursor-rgb"], "10 255 157");
});

test("testi: clamp ai limiti, trim, tipi sbagliati ignorati", () => {
  const long = "x".repeat(500);
  const s = sanitizeHeroConfig({ title: long, subtitle: 123, eyebrow: "  Ciao  " });
  assert.equal(s.title.length, 120);
  assert.equal(s.subtitle, "", "non-stringa → vuoto, poi fallback");
  assert.equal(s.eyebrow, "Ciao");
});

test("accento: solo hex valido, altrimenti stringa vuota (= token brand)", () => {
  assert.equal(validHex("#3D72EC"), "#3d72ec");
  assert.equal(validHex("blue"), null);
  assert.equal(validHex("#12345"), null);
  assert.equal(sanitizeHeroConfig({ accent: "#ABCDEF" }).accent, "#abcdef");
  assert.equal(sanitizeHeroConfig({ accent: "rosso" }).accent, "");
});

test("font e direzione sfumatura: solo valori noti", () => {
  assert.equal(sanitizeHeroConfig({ font: "playfair" }).font, "playfair");
  assert.equal(sanitizeHeroConfig({ font: "comic-sans" }).font, "system");
  assert.equal(sanitizeHeroConfig({ gradient: "diagonal" }).gradient, "diagonal");
  assert.equal(sanitizeHeroConfig({ gradient: "spirale" }).gradient, "horizontal");
});

test("heroWithFallbacks: un campo svuotato riprende il default, gli altri restano", () => {
  const out = heroWithFallbacks({
    ...DEFAULT_HERO,
    enabled: true,
    title: "",
    eyebrow: "Test",
  });
  assert.equal(out.title, DEFAULT_HERO.title, "titolo vuoto → default");
  assert.equal(out.eyebrow, "Test", "testo scelto dall'utente intatto");
  assert.equal(out.enabled, true);
});

test("heroVars: accento custom come tripletta rgb, assente se non scelto", () => {
  const custom = heroVars({ ...DEFAULT_HERO, accent: "#ff0000" });
  assert.equal(custom["--hero-accent"], "255 0 0");
  const plain = heroVars(DEFAULT_HERO);
  assert.equal(plain["--hero-accent"], undefined);
  assert.equal(plain["--hero-delay"], "0.15");
});

test("stato hub: spento = grigio «Statico» (default di proposito), attivo = verde col nome template", () => {
  const off = heroStatus(null);
  assert.equal(off.label, "Statico");
  assert.equal(off.warn, false, "default non è un problema");
  assert.equal(off.key, "hero");

  const on = heroStatus({ enabled: true, template: "caret" });
  assert.equal(on.ok, true);
  assert.equal(on.warn, false);
  assert.match(on.label, /Attivo · Caret/);
});
