import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Sentinella di parità del tema grafico — theme.ts (lettura e
 * persistenza, server-only), theme-shared.ts (funzioni PURE:
 * derivazione della scala brand, contrasto WCAG, aggiustamento
 * per il dark) e theme-editor.tsx (editor con anteprima live).
 * Sono FUORI dal perimetro twin-sync (il manifest non li
 * elenca), ma sono di fatto gemello-pari: qui una guardia
 * dedicata li tiene identici al byte, con salto educato se il
 * checkout gemello non è raggiungibile.
 *
 * Rispetto a hero-css-parity il gemello è risolto in modo
 * BIDIREZIONALE: il manifest è lo stesso file in entrambi i
 * repo (fonte della verità: Crema), quindi qui il gemello è
 * l'ALTRO repo — twin-name se gira nella fonte, source-repo
 * se gira nel twin. Il confronto è reale da entrambe le
 * parti, mai un file contro sé stesso.
 */

const ROOT = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(ROOT, "twin-sync.json"), "utf8"));
const ioSonoLaFonte = path.basename(ROOT) === manifest["source-repo"];
const gemelloNome = ioSonoLaFonte ? manifest["twin-name"] : manifest["source-repo"];
const TWIN_ROOT = path.join(path.dirname(ROOT), gemelloNome);
const gemelloPresente = existsSync(path.join(TWIN_ROOT, "package.json"));

const THEME = readFileSync(path.join(ROOT, "src", "lib", "theme.ts"), "utf8");
const THEME_SHARED = readFileSync(path.join(ROOT, "src", "lib", "theme-shared.ts"), "utf8");
const THEME_EDITOR = readFileSync(path.join(ROOT, "src", "components", "theme-editor.tsx"), "utf8");

test("il tema espone le API chiave nei tre file", () => {
  // theme.ts: persistenza (content_settings, chiave site_theme)
  // e CSS variables inline iniettate dal root layout.
  for (const api of ["SITE_THEME_KEY", "getSiteTheme", "themeVars", "DEFAULT_THEME"]) {
    assert.ok(THEME.includes(api), `manca ${api} in theme.ts`);
  }
  // theme-shared.ts: funzioni PURE importabili dai componenti
  // client — la scala brand e il contrasto vivono qui.
  for (const api of [
    "export function brandScale",
    "export function adjustScaleForDark",
    "export function toRgbTriplet",
    "export function onBrandColor",
  ]) {
    assert.ok(THEME_SHARED.includes(api), `manca ${api} in theme-shared.ts`);
  }
  // theme-editor.tsx: selettore Classic/Zendesk con anteprima
  // live sugli attributi data-* del root e salvataggio
  // esplicito via server action.
  for (const api of ["saveThemeAction", "data-theme", "data-mode", "adjustScaleForDark"]) {
    assert.ok(THEME_EDITOR.includes(api), `manca ${api} in theme-editor.tsx`);
  }
});

test(
  "tema (theme.ts, theme-shared.ts, theme-editor.tsx) è byte-identico al gemello",
  { skip: gemelloPresente ? false : "checkout gemello non raggiungibile" },
  () => {
    const file = [
      ["src", "lib", "theme.ts", THEME],
      ["src", "lib", "theme-shared.ts", THEME_SHARED],
      ["src", "components", "theme-editor.tsx", THEME_EDITOR],
    ];
    for (const [a, b, c, mio] of file) {
      const loro = readFileSync(path.join(TWIN_ROOT, a, b, c), "utf8");
      assert.equal(mio, loro, `${a}/${b}/${c} è divergiato: uniformare PRIMA di toccare il tema`);
    }
  },
);
