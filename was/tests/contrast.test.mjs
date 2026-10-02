/**
 * CONTRASTO WCAG AA dei token di stato — regressioni impossibili.
 *
 * Calcola il contrasto (soglia 4.5:1) degli stati del design system in
 * LIGHT e DARK leggendo i valori LIVE: i token da globals.css (le
 * utility Tailwind del progetto leggono le stesse CSS variables) e le
 * coppie fg/bg da glass.tsx (GlassStatus, GlassBadge, GlassNotice) e
 * dalle pill semantiche delle pagine elenco. Cambiare una tinta senza
 * rispettare l'AA fa fallire `npm test`. Nessuna costante duplicata:
 * il test parsa i file, come il browser parsa il CSS.
 *
 * Modello di calcolo (lo stesso dell'audit manuale del 2026-09-25):
 * - il testo poggia su fondi che possono avere alpha (vetri): i livelli
 *   si compongono FIGLI → padri sulla base della "aurora" (gradient del
 *   body, invisibile a getComputedStyle). Per ogni coppia si prende il
 *   CASO PEGGIORE tra i due estremi del gradient e tra le superfici su
 *   cui l'elemento compare realmente (aurora diretta o card glass);
 * - le semantiche (emerald/orange/amber/…) restano le scale Tailwind
 *   v3 in ENTRAMBE le mode per decisione di design («le semantiche non
 *   si toccano»): il test le verifica così come sono rendute.
 *
 * Esecuzione: `npm test` (node --test).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

// fileURLToPath: il pathname non è URL-encoded e regge i percorsi con spazi
// (es. «Web Agency Salento + Installer»).
const GLOBALS = fileURLToPath(new URL("../src/app/globals.css", import.meta.url));
const GLASS = fileURLToPath(new URL("../src/components/glass.tsx", import.meta.url));

/* ── WCAG 2.x: luminanza relativa e ratio ─────────────────────────── */

function relLum([r, g, b]) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg, bg) {
  const l1 = relLum(fg);
  const l2 = relLum(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* Scale Tailwind v3 complete delle semantiche del progetto (i token CSS
   slate/brand invece arrivano parsati da globals.css, col mirror dark). */
const TAILWIND = {
  emerald: { 50: "#ecfdf5", 100: "#d1fae5", 200: "#a7f3d0", 300: "#6ee7b7", 400: "#34d399", 500: "#10b981", 600: "#059669", 700: "#047857", 800: "#065f46", 900: "#064e3b", 950: "#022c22" },
  orange: { 50: "#fff7ed", 100: "#ffedd5", 200: "#fed7aa", 300: "#fdba74", 400: "#fb923c", 500: "#f97316", 600: "#ea580c", 700: "#c2410c", 800: "#9a3412", 900: "#7c2d12", 950: "#431407" },
  amber: { 50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d", 400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309", 800: "#92400e", 900: "#78350f", 950: "#451a03" },
  green: { 50: "#f0fdf4", 100: "#dcfce7", 200: "#bbf7d0", 300: "#86efac", 400: "#4ade80", 500: "#22c55e", 600: "#16a34a", 700: "#15803d", 800: "#166534", 900: "#14532d", 950: "#052e16" },
  sky: { 50: "#f0f9ff", 100: "#e0f2fe", 200: "#bae6fd", 300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9", 600: "#0284c7", 700: "#0369a1", 800: "#075985", 900: "#0c4a6e", 950: "#082f49" },
  red: { 50: "#fef2f2", 100: "#fee2e2", 200: "#fecaca", 300: "#fca5a5", 400: "#f87171", 500: "#ef4444", 600: "#dc2626", 700: "#b91c1c", 800: "#991b1b", 900: "#7f1d1f", 950: "#450a0a" },
  violet: { 50: "#f5f3ff", 100: "#ede9fe", 200: "#ddd6fe", 300: "#c4b5fd", 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9", 800: "#5b21b6", 900: "#4c1d95", 950: "#2e1065" },
  /* slate e brand NON stanno qui: nel progetto leggono i token CSS
     (globals.css, con mirror dark) — il test li risolve da lì. */
};

/* ── Token live da globals.css ────────────────────────────────────── */

function tokensOf(body) {
  const out = {};
  for (const [, name, r, g, b] of body.matchAll(/--([a-z0-9-]+)\s*:\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    out[`--${name}`] = [Number(r), Number(g), Number(b)];
  }
  return out;
}

function buildTokenSets() {
  const css = readFileSync(GLOBALS, "utf8");
  const light = {};
  const darkOverride = {};
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // Il chunk tra due graffe contiene commenti (e nel primo anche le
    // @tailwind): strip dei commenti, collasso degli spazi → selettore reale.
    const sel = selector.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim();
    const t = tokensOf(body);
    // Il primo blocco è preceduto dalle @tailwind: il chunk le contiene
    // prima di ":root, [data-theme=…]" — quindi includes, non startsWith.
    if (sel.includes(":root") || sel.includes('[data-theme=')) Object.assign(light, t);
    if (sel === 'html[data-mode="dark"]') Object.assign(darkOverride, t);
  }
  assert.notDeepEqual(
    light["--slate-600"],
    darkOverride["--slate-600"],
    "parser: il blocco dark non è stato letto da globals.css",
  );
  return { light, dark: { ...light, ...darkOverride } };
}

/** Il testo del GlassBadge vive nel CSS (decisione anti-conflitto). */
function glassBadgeFg(mode) {
  const css = readFileSync(GLOBALS, "utf8");
  const re =
    mode === "dark"
      ? /html\[data-mode="dark"\]\s*\.glass-badge\s*\{[^}]*color:\s*rgb\(var\(--(slate-\d+)\)\)/
      : /(?<![\w-])\.glass-badge\s*\{[^}]*color:\s*rgb\(var\(--(slate-\d+)\)\)/;
  const step = css.match(re)?.[1];
  assert.ok(step, `regola .glass-badge (testo, ${mode}) non trovata in globals.css`);
  return `var(--${step})`;
}

/* ── Colori: "var(--x)", "var(--x)/50" (percentuale alpha), "emerald-700",
   "emerald-50/90", "#hex" ── */

function resolve(spec, tokens) {
  const m = spec.match(/^(.+?)(?:\/(\d+))?$/);
  const base = m[1];
  const alpha = m[2] ? Number(m[2]) / 100 : 1;
  let rgb;
  const varName = base.match(/^var\((--[\w-]+)\)$/)?.[1];
  if (varName) {
    rgb = tokens[varName];
    assert.ok(rgb, `token ${varName} non trovato in globals.css`);
  } else if (base.startsWith("#")) {
    rgb = hexToRgb(base);
  } else {
    const tw = base.match(/^([a-z]+)-(\d+)$/);
    const [fam, step] = [tw[1], tw[2]];
    // slate-* e brand-* leggono i token CSS (mirror dark incluso);
    // le semantiche usano le scale Tailwind statiche.
    if (fam === "slate") rgb = tokens[`--slate-${step}`];
    else if (fam === "brand") rgb = tokens[`--brand-${step}`];
    else rgb = TAILWIND[fam]?.[step] ? hexToRgb(TAILWIND[fam][step]) : undefined;
    assert.ok(rgb, `colore non risolvibile: ${base}`);
  }
  return { rgb, alpha };
}

/** Compositing bottom-up: layers[0] = più vicino al testo. */
function over(layers, tokens, base) {
  let acc = base;
  for (const spec of layers.slice().reverse()) {
    const { rgb, alpha } = resolve(spec, tokens);
    acc = [0, 1, 2].map((i) => rgb[i] * alpha + acc[i] * (1 - alpha));
  }
  return acc;
}

/* ── Superfici reali su cui gli stati compaiono ────────────────────── */

/** Estremi del gradient della aurora (per mode, dai token). */
function auroraExtremes(tokens) {
  return [tokens["--aurora-4-a"], tokens["--aurora-4-b"]];
}

/* ── Coppie fg/bg LIVE dai componenti e dalle pill semantiche ─────── */

function extractPairs() {
  const src = readFileSync(GLASS, "utf8");
  const pairs = [];

  // GlassStatus: ok (emerald) e ko (slate) — classi condizionali live.
  // Il corpo si cattura fino al prossimo commento/export: la firma
  // multilinea con }: { tronca il match pigro su \n}.
  const status = src.match(/export function GlassStatus[\s\S]*?(?=\n\/\*\*|\nexport )/);
  assert.ok(status, "GlassStatus non trovato in glass.tsx");
  const okCls = status[0].match(/ok\s*\n?\s*\?\s*"([^"]+)"/)?.[1];
  const koCls = status[0].match(/:\s*(?:\/\/[^\n]*\n\s*)?"([^"]+)"/)?.[1];
  assert.ok(okCls && koCls, "classi condizionali di GlassStatus non riconosciute");
  for (const [key, cls] of [["collegato", okCls], ["da collegare", koCls]]) {
    pairs.push({
      id: `GlassStatus ${key}`,
      fg: cls.match(/text-([a-z]+-\d+)/)?.[1],
      bg: cls.match(/bg-([a-z]+-\d+(?:\/\d+)?)/)?.[1],
      mode: "both",
    });
  }

  // GlassNotice: i tre tone dal map `tones` (info ha il vetro, non un pastello)
  const notice = src.match(/export function GlassNotice[\s\S]*?(?=\n\/\*\*|\nexport )/);
  assert.ok(notice, "GlassNotice non trovato in glass.tsx");
  const tones = notice[0].match(/const tones = \{([\s\S]*?)\} as const;/);
  assert.ok(tones, "map `tones` di GlassNotice non trovato");
  for (const [, tone, boxCls] of tones[1].matchAll(/(\w+):\s*\{\s*box:\s*"([^"]+)"/g)) {
    pairs.push({
      id: `GlassNotice ${tone}`,
      fg: boxCls.match(/text-([a-z]+-\d+)/)?.[1],
      bg: boxCls.match(/bg-([a-z]+-\d+(?:\/\d+)?)/)?.[1] ?? "var(--surface-white)/60",
      mode: "both",
    });
  }

  // GlassBadge: neutro su vetro — testo da .glass-badge, fondo dal componente
  pairs.push({ id: "GlassBadge neutro", fgCss: true, bg: "var(--surface-white)/50", mode: "both" });

  // Badge brand: in LIGHT le tinte arrivano dai CHIAMANTI (convenzione
  // condivisa dei pannelli e dei contatori header: bg-brand-50/90 +
  // text-brand-700); in DARK il CSS remappa con !important la regola
  // .glass-badge-brand (brand-200 su brand-900/55) — auditate 2026-09-25.
  pairs.push({ id: "GlassBadge brand (light, chiamanti)", fg: "var(--brand-700)", bg: "var(--brand-50)/90", mode: "light" });
  pairs.push({ id: "GlassBadge brand (dark, override CSS)", fg: "var(--brand-200)", bg: "var(--brand-900)/55", mode: "dark" });

  // Pill semantiche delle pagine elenco (stesse scale su Ticket/Lead/Callback).
  pairs.push({ id: "Pill «da rispondere»", fg: "orange-700", bg: "orange-50", mode: "both" });
  pairs.push({ id: "Callback fatto", fg: "green-700", bg: "green-100", mode: "both" });
  pairs.push({ id: "Callback mancato", fg: "amber-700", bg: "amber-100", mode: "both" });
  pairs.push({ id: "Lead caldo", fg: "orange-700", bg: "orange-100", mode: "both" });
  pairs.push({ id: "Lead freddo", fg: "sky-700", bg: "sky-100", mode: "both" });

  return pairs;
}

/* ── I test ────────────────────────────────────────────────────────── */

const { light: LIGHT, dark: DARK } = buildTokenSets();
const PAIRS = extractPairs();

test("il parser copre davvero i componenti di stato del design system", () => {
  const src = readFileSync(GLASS, "utf8");
  for (const name of ["GlassStatus", "GlassBadge", "GlassNotice"]) {
    assert.ok(src.includes(`export function ${name}`), `${name} manca in glass.tsx`);
  }
  assert.ok(PAIRS.length >= 8, `attese ≥8 coppie di stato, trovate ${PAIRS.length}`);
});

function minRatio(pair, mode) {
  const tokens = mode === "dark" ? DARK : LIGHT;
  const fg = resolve(pair.fgCss ? glassBadgeFg(mode) : pair.fg, tokens).rgb;
  // Fondi reali per la coppia: la sua tinta di bg (anche con alpha) sopra
  // la aurora (es. pill nell'header di pagina) o sopra una card glass
  // (.glass-solid, es. pill dentro le card elenco). layers[0] = più vicino
  // al testo → [bg, card]. Si prende il CASO PEGGIORE dei contesti e degli
  // estremi del gradient.
  const bgLayer = pair.bg;
  const contexts = auroraExtremes(tokens).flatMap((base) => [
    over([bgLayer], tokens, base),
    over([bgLayer, "var(--surface-white)/78"], tokens, base),
  ]);
  return Math.min(...contexts.map((bg) => contrast(fg, bg)));
}

test("ogni stato del design system è ≥ 4.5:1 in light e dark", () => {
  const failures = [];
  for (const pair of PAIRS) {
    const modes = pair.mode === "both" ? ["light", "dark"] : [pair.mode];
    for (const mode of modes) {
      const r = minRatio(pair, mode);
      if (r < 4.5) failures.push(`  - ${pair.id} [${mode}]: ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `Contrasti sotto 4.5:1 (AA testo normale) — correggere le tinte:\n${failures.join("\n")}`,
  );
});
