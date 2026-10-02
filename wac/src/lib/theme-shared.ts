/**
 * Funzioni PURE del tema — importabili dai componenti client (nessun db).
 * La lettura/persistenza (getSiteTheme, themeVars per il layout) sta in
 * `theme.ts` (server-only).
 */

export type ThemeName = "classic" | "zendesk";

/** Chiaro (default) o scuro: dimensione ortogonale al tema (Fase dark). */
export type ThemeMode = "light" | "dark";

export interface SiteThemeClient {
  theme: ThemeName;
  mode?: ThemeMode;
  primary?: string;
  accent?: string;
}

export const DEFAULT_THEME_CLIENT: SiteThemeClient = { theme: "classic", mode: "light" };

export type BrandStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

const BRAND_STEPS: BrandStep[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgbTriplet(h: number, s: number, l: number): string {
  const H = ((((h % 360) + 360) % 360) / 360);
  const S = Math.min(1, Math.max(0, s / 100));
  const L = Math.min(1, Math.max(0, l / 100));
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const hue = (t: number) => {
    let T = t;
    if (T < 0) T += 1;
    if (T > 1) T -= 1;
    if (T < 1 / 6) return p + (q - p) * 6 * T;
    if (T < 1 / 2) return q;
    if (T < 2 / 3) return p + (q - p) * (2 / 3 - T) * 6;
    return p;
  };
  const r = Math.round(hue(H + 1 / 3) * 255);
  const g = Math.round(hue(H) * 255);
  const b = Math.round(hue(H - 1 / 3) * 255);
  return `${r} ${g} ${b}`;
}

/**
 * Scala brand 50→950 derivata da un hex primario: hue fisso, saturazione
 * e lightness calibrate sulla scala blu attuale (500 ≈ il primario).
 * Restituisce TRIPLETTI rgb pronti per le CSS variables.
 */
export function brandScale(primaryHex: string): Record<BrandStep, string> {
  const { h } = hexToHsl(primaryHex);
  const lightness: Record<BrandStep, number> = { 50: 97, 100: 93, 200: 87, 300: 78, 400: 67, 500: 58, 600: 51, 700: 46, 800: 40, 900: 26, 950: 16 };
  const saturation: Record<BrandStep, number> = { 50: 92, 100: 90, 200: 88, 300: 85, 400: 84, 500: 82, 600: 82, 700: 80, 800: 75, 900: 68, 950: 66 };
  const out = {} as Record<BrandStep, string>;
  for (const n of BRAND_STEPS) {
    out[n] = hslToRgbTriplet(h, saturation[n], lightness[n]);
  }
  return out;
}

/** hex → "r g b" (per iniettare una singola variabile). */
export function toRgbTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 0xff} ${(n >> 8) & 0xff} ${n & 0xff}`;
}

/* ── Contrasto WCAG (pure, per il colore del testo sui CTA brand) ── */

function relLum(triplet: string): number {
  const [r, g, b] = triplet.split(" ").map(Number);
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * Colore del TESTO sopra il fondo primario (CTA, badge numerati):
 * bianco se il contrasto con il brand-600 attivo passa AA (≥ 4.5:1),
 * altrimenti quasi-nero (slate-950). Con un primario chiaro scelto
 * dall'utente la scala (soprattutto in dark) schiarisce il 600 e il
 * bianco crolla sotto soglia — è l'equivalente light di adjustScaleForDark:
 * il bottone resta leggibile con OGNI colore, non solo col blu default.
 * A 600 (L≈51–63) il quasi-nero passa sempre di larghissima margine.
 */
export function onBrandColor(brand600Triplet: string): string {
  const lum = relLum(brand600Triplet);
  const white = (1.05) / (lum + 0.05);
  return white >= 4.5 ? "255 255 255" : "2 6 23";
}

/**
 * Aggiusta la scala brand per lo sfondo SCURO (Fase dark, pura).
 *
 * La curva lightness è calibrata per superfici chiare: su scuro gli step
 * 400–600 diventano troppo scuri (il bottone primario si perde nel fondo)
 * e 50–200 troppo chiari (i badge brand-50 su vetro scuro accecano).
 * Regola: i toni scuri si SCHIARIScono (legge il fondo), i chiari si
 * SCURISCONO un poco (legge il testo bianco sopra) — mirror simmetrico,
 * 500 resta il perno intatto.
 */
export function adjustScaleForDark(scale: Record<BrandStep, string>): Record<BrandStep, string> {
  const delta: Record<BrandStep, number> = {
    50: -14,
    100: -10,
    200: -6,
    300: -2,
    400: 6,
    500: 8,
    600: 12,
    700: 14,
    800: 18,
    900: 22,
    950: 26,
  };
  const out = {} as Record<BrandStep, string>;
  for (const n of BRAND_STEPS) {
    const [r, g, b] = scale[n].split(" ").map(Number);
    const { h, s, l } = rgbToHsl(r, g, b);
    const nl = Math.min(96, Math.max(6, l + delta[n]));
    out[n] = hslToRgbTriplet(h, s, nl);
  }
  return out;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (max === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}
