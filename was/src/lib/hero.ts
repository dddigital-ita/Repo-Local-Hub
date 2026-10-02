import { db } from "./db";
import {
  DEFAULT_HERO,
  HERO_KEY,
  sanitizeHeroConfig,
  heroWithFallbacks,
} from "./hero-shared";
import type { HeroConfig } from "./hero-shared";

/**
 * Lettura/persistenza dell'hero animato (server-only). Stesso pattern di
 * theme.ts: una chiave content_settings, sanificazione totale, fallback ai
 * default se il DB non c'è o il JSON è invalido — il sito funziona degradato
 * e «enabled: false» (default) lascia la home ESATTAMENTE com'è oggi.
 */

export async function getHeroConfig(): Promise<HeroConfig> {
  const pool = db();
  if (!pool) return { ...DEFAULT_HERO };
  try {
    const { rows } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = $1",
      [HERO_KEY],
    );
    if (!rows[0]) return { ...DEFAULT_HERO };
    return sanitizeHeroConfig(rows[0].value);
  } catch {
    return { ...DEFAULT_HERO };
  }
}

/** Config pronta per il rendering: testi vuoti sostituiti dai default. */
export async function getRenderableHero(): Promise<HeroConfig> {
  return heroWithFallbacks(await getHeroConfig());
}
