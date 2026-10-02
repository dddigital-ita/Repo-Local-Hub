import pg from "pg";
import { db } from "./db";
import {
  PERF_TARGET_KEY,
  sanitizePerfTargetConfig,
  type PerfTargetConfig,
} from "./perf-target-shared";

/**
 * LETTURA del target di risposta da content_settings (tabella
 * esistente: zero migration). separata dalla logica pura così
 * che la rotta e l'action la possano chiamare senza trascinare
 * la scrittura (che sta nell'action, dietro requireAdmin + audit).
 */

/** Un solo posto costruisce il pool di lettura: SSL come lib/db.ts. */
function perfTargetPool(dsn: string): pg.Pool {
  const connectionString = dsn + (dsn.includes("?") ? "&" : "?") + "uselibpqcompat=true";
  return new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    ssl: /localhost|127\.0\.0\.1/.test(dsn) ? false : { rejectUnauthorized: false },
  });
}

/** Legge la config; in caso di DB assente/giù ritorna il default
 *  (target del piano): un problema DB non deve colorare la scheda. */
export async function readPerfTargetConfig(dsn?: string): Promise<PerfTargetConfig> {
  let pool: pg.Pool | null = null;
  try {
    pool = dsn ? perfTargetPool(dsn) : db();
    if (!pool) return sanitizePerfTargetConfig(null);
    const { rows } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = $1",
      [PERF_TARGET_KEY],
    );
    return sanitizePerfTargetConfig(rows[0]?.value);
  } catch {
    return sanitizePerfTargetConfig(null);
  } finally {
    if (pool && dsn) await pool.end().catch(() => undefined); // il pool di db() è condiviso: non va chiuso
  }
}
