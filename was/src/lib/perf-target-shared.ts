/**
 * TARGET DI RISPOSTA ADMIN — logica condivisa (store, action
 * admin, pannello).
 *
 * La soglia verde della scheda Velocità dell'admin (Tools →
 * Prestazioni) vive qui come configurazione DB: l'admin la
 * sposta con uno slider e le barre/pill della pagina si
 * colorano al momento — il risparmio di un redeploy e la
 * libertà di decidere COSA conta come «veloce» per il piano.
 * È la leva «target» della vista di telemetria: meno ms =
 * verde più esigente; più ms = il piano perdona.
 *
 * Questo modulo è PURO (niente `pg`, niente I/O): la lettura
 * DB vive in perf-target-store.ts, la scrittura nell'action
 * admin (dietro requireAdmin + audit).
 */

export const PERF_TARGET_KEY = "perf_target_ms";

/** Limite inferiore: sotto i 200 ms il verde non dice più nulla. */
export const PERF_TARGET_MIN_MS = 200;

/** Limite superiore: 3 s — oltre il piano, il target è il problema. */
export const PERF_TARGET_MAX_MS = 3_000;

/** Default: il target del piano (1 s a caldo, ADR-005 esteso). */
export const DEFAULT_PERF_TARGET_MS = 1_000;

/** Passo dello slider: 50 ms — abbastanza fine da sentire il cambio. */
export const PERF_TARGET_STEP_MS = 50;

export interface PerfTargetConfig {
  /** Soglia verde: mediana di rendering sotto questo valore = «ok». */
  targetMs: number;
}

export const DEFAULT_PERF_TARGET: PerfTargetConfig = {
  targetMs: DEFAULT_PERF_TARGET_MS,
};

/** Etichetta leggibile per UI e audit: «1 s», «2,5 s», «850 ms». */
export function describePerfTargetMs(ms: number): string {
  const n = Number.isFinite(ms) ? Math.round(ms) : DEFAULT_PERF_TARGET_MS;
  if (n < 1000) return `${n} ms`;
  const s = n / 1000;
  return `${s.toFixed(Number.isInteger(s) ? 0 : 1).replace(".", ",")} s`;
}

/** Se un campo manca o è di tipo sbagliato ricade sul default:
 *  la config corrotta non può né bloccare la pagina né colorare
 *  tutto di verde. Arrotonda al passo e tiene il range: un valore
 *  fuori soglia è errore di digitazione, non volontà. */
export function sanitizePerfTargetConfig(raw: unknown): PerfTargetConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  const n = Number(o.targetMs);
  if (!Number.isFinite(n)) return { ...DEFAULT_PERF_TARGET };
  const stepped = Math.round(n / PERF_TARGET_STEP_MS) * PERF_TARGET_STEP_MS;
  const clamped = Math.min(PERF_TARGET_MAX_MS, Math.max(PERF_TARGET_MIN_MS, stepped));
  return { targetMs: clamped };
}
