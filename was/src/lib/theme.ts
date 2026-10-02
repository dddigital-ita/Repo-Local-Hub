import { db } from "./db";
import { brandScale, adjustScaleForDark, toRgbTriplet, onBrandColor } from "./theme-shared";
import type { BrandStep, ThemeName } from "./theme-shared";

export type { ThemeName } from "./theme-shared";

/**
 * Lettura/persistenza del tema (server-only).
 *
 * Il tema è UNO e globale (sito + admin): «classic» (Liquid Glass, resa
 * attuale) o «zendesk» (Glossy Garden). L'utente può anche personalizzare
 * primario e accento: la scala 50–950 del brand viene DERIVATA in HSL da
 * `brandScale()` (in theme-shared, pura) e iniettata come CSS variables
 * nel root layout (server-side → zero flash).
 *
 * Persistenza: content_settings key `site_theme` (stesso pattern di
 * getSlaPolicy: query, validazione, fallback ai default se il DB non c'è
 * o il JSON è invalido — il sito funziona degradato).
 */

export const SITE_THEME_KEY = "site_theme";

export interface SiteTheme {
  theme: ThemeName;
  /** Chiaro (default) o scuro: dimensione ortogonale al tema. */
  mode: ThemeMode;
  /** Colore primario in hex (es. #3d72ec): deriva l'intera scala brand. */
  primary?: string;
  /** Colore accento opzionale per hover link e dettagli dei CTA. */
  accent?: string;
}

export type ThemeMode = "light" | "dark";

export const DEFAULT_THEME: SiteTheme = { theme: "classic", mode: "light" };

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function validHex(v: unknown): string | undefined {
  return typeof v === "string" && HEX_RE.test(v) ? v.toLowerCase() : undefined;
}

const BRAND_STEPS: BrandStep[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** Legge il tema salvato; DB assente/JSON invalido → default «classic». */
export async function getSiteTheme(): Promise<SiteTheme> {
  const pool = db();
  if (!pool) return DEFAULT_THEME;
  try {
    const { rows } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = $1",
      [SITE_THEME_KEY],
    );
    const raw = rows[0]?.value as Partial<SiteTheme> | undefined;
    if (!raw || typeof raw !== "object") return DEFAULT_THEME;
    const theme: SiteTheme = {
      theme: raw.theme === "zendesk" ? "zendesk" : "classic",
      mode: raw.mode === "dark" ? "dark" : "light",
    };
    const primary = validHex(raw.primary);
    if (primary) theme.primary = primary;
    const accent = validHex(raw.accent);
    if (accent) theme.accent = accent;
    return theme;
  } catch {
    return DEFAULT_THEME;
  }
}

/* ── CSS variables inline (solo override: default = nessuna var) ── */

/**
 * Custom properties da applicare su <html style=…>: SOLO per i colori
 * personalizzati. Se il primary non è impostato, nessun override — i
 * token restano quelli del tema dichiarato in globals.css.
 * * In dark la scala viene aggiustata da `adjustScaleForDark` (toni scuri
 * schiariti, chiari scuriti): il bottone primario e i link restano
 * leggibili sul fondo scuro con OGNI colore scelto dall'utente.
 * `--on-brand` è il colore del TESTO sopra i fondi brand (CTA, badge
 * numerati): bianco o quasi-nero secondo il contrasto AA reale contro
 * brand-600 — usato dall'override CSS dei CTA pubblici in entrambe le
 * modalità (fallback #ffffff = tema default blu, che passa sempre).
 */
export function themeVars(theme: SiteTheme): Record<string, string> {
  const vars: Record<string, string> = {};
  const dark = theme.mode === "dark";
  if (theme.primary) {
    const scale = brandScale(theme.primary);
    const final = dark ? adjustScaleForDark(scale) : scale;
    for (const n of BRAND_STEPS) {
      vars[`--brand-${n}`] = final[n];
    }
    vars["--on-brand"] = onBrandColor(final[600]);
  }
  if (theme.accent) {
    // Il picker alimenta i dettagli condivisi (hover link, bordi e glow CTA).
    vars["--accent"] = toRgbTriplet(theme.accent);
  }
  return vars;
}
