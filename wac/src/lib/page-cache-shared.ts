/**
 * CACHE PAGINE PUBBLICHE — logica condivisa (proxy, rotta config,
 * action admin, pannello).
 *
 * Il TTL della cache CDN delle pagine pubbliche (home e landing)
 * vive qui come configurazione DB: l'admin la sposta con uno
 * slider e il proxy applica `s-maxage` sulla risposta, senza
 * redeploy. È la leva «velocità» della pagina Prestazioni: meno
 * secondi = contenuto più fresco, più secondi = TTFB più basso.
 *
 * Questo modulo è PURO (niente `pg`, niente I/O): lo importa anche
 * il proxy, che per convenzione non può toccare il database. La
 * lettura DB vive in page-cache-store.ts, la scrittura nell'action
 * admin (dietro requireAdmin + audit).
 */

export const PAGE_CACHE_KEY = "page_cache_ttl";

/** Limite inferiore: sotto il minuto la cache non ripaga il round-trip. */
export const PAGE_CACHE_MIN_S = 60;

/** Limite superiore: un giorno è il massimo di freschezza cedibile. */
export const PAGE_CACHE_MAX_S = 86_400;

/** Default: 5 minuti (equilibrio freschezza/velocità all'avvio). */
export const DEFAULT_PAGE_CACHE_TTL_S = 300;

/** Passo dello slider: la cache si misura in minuti, non secondi. */
export const PAGE_CACHE_STEP_S = 60;

export interface PageCacheConfig {
  /** Per quanti secondi la CDN serve home e landing senza chiamare l'origine. */
  ttlSeconds: number;
}

export const DEFAULT_PAGE_CACHE: PageCacheConfig = {
  ttlSeconds: DEFAULT_PAGE_CACHE_TTL_S,
};

/** Etichetta leggibile per UI e audit: «5 minuti», «2 ore», «1 giorno». */
export function describePageCacheTtl(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.round(seconds) : DEFAULT_PAGE_CACHE_TTL_S;
  if (s % 86_400 === 0) {
    const giorni = s / 86_400;
    return giorni === 1 ? "1 giorno" : `${giorni} giorni`;
  }
  if (s % 3600 === 0) {
    const ore = s / 3600;
    return ore === 1 ? "1 ora" : `${ore} ore`;
  }
  const minuti = Math.max(1, Math.round(s / 60));
  return minuti === 1 ? "1 minuto" : `${minuti} minuti`;
}

/** Se un campo manca o è di tipo sbagliato ricade sul default: la
 *  config corrotta non può né bloccare il proxy né svuotare la CDN.
 *  Arrotonda a secondi interi e tiene il range: un valore fuori
 *  soglia è errore di digitazione, non volontà. */
export function sanitizePageCacheConfig(raw: unknown): PageCacheConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  const n = Number(o.ttlSeconds);
  if (!Number.isFinite(n)) return { ...DEFAULT_PAGE_CACHE };
  const clamped = Math.min(PAGE_CACHE_MAX_S, Math.max(PAGE_CACHE_MIN_S, Math.round(n)));
  return { ttlSeconds: clamped };
}
