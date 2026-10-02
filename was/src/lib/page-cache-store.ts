import pg from "pg";
import { db } from "./db";
import {
  PAGE_CACHE_KEY,
  sanitizePageCacheConfig,
  type PageCacheConfig,
} from "./page-cache-shared";

/**
 * LETTURA della config cache pagine da content_settings (tabella
 * esistente: zero migration). separata dalla logica pura così che
 * il proxy e la rotta config la possano chiamare senza trascinare
 * la scrittura (che sta nell'action, dietro requireAdmin + audit).
 */

/** Un solo posto costruisce il pool di lettura: SSL come lib/db.ts. */
function pageCachePool(dsn: string): pg.Pool {
  const connectionString = dsn + (dsn.includes("?") ? "&" : "?") + "uselibpqcompat=true";
  return new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    ssl: /localhost|127\.0\.0\.1/.test(dsn) ? false : { rejectUnauthorized: false },
  });
}

/** Legge la config; in caso di DB assente/giù ritorna il default
 *  (TTL di default): un problema DB non deve rallentare il sito. */
export async function readPageCacheConfig(dsn?: string): Promise<PageCacheConfig> {
  let pool: pg.Pool | null = null;
  try {
    pool = dsn ? pageCachePool(dsn) : db();
    if (!pool) return sanitizePageCacheConfig(null);
    const { rows } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = $1",
      [PAGE_CACHE_KEY],
    );
    return sanitizePageCacheConfig(rows[0]?.value);
  } catch {
    return sanitizePageCacheConfig(null);
  } finally {
    if (pool && dsn) await pool.end().catch(() => undefined); // il pool di db() è condiviso: non va chiuso
  }
}
