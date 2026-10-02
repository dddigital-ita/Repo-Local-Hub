import pg from "pg";
import { db } from "./db";
import { MAINTENANCE_KEY, sanitizeMaintenanceConfig, type MaintenanceConfig } from "./maintenance-shared";

/**
 * LETTURA della config manutenzione da content_settings (tabella esistente:
 * zero migration). separata dalla logica pura così che il proxy e la pagina
 * la possano chiamare senza trascinare la scrittura (che sta nell'action,
 * dietro requireAdmin + audit).
 */

/** Un solo posto costruisce il pool di lettura: SSL come lib/db.ts. */
function maintenancePool(dsn: string): pg.Pool {
  const connectionString = dsn + (dsn.includes("?") ? "&" : "?") + "uselibpqcompat=true";
  return new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    ssl: /localhost|127\.0\.0\.1/.test(dsn) ? false : { rejectUnauthorized: false },
  });
}

/** Legge la config; in caso di DB assente/giù ritorna il default (spento):
 *  un problema DB non deve lasciare il sito chiuso per errore. */
export async function readMaintenanceConfig(dsn?: string): Promise<MaintenanceConfig> {
  let pool: pg.Pool | null = null;
  try {
    pool = dsn ? maintenancePool(dsn) : db();
    if (!pool) return sanitizeMaintenanceConfig(null);
    const { rows } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = $1",
      [MAINTENANCE_KEY],
    );
    return sanitizeMaintenanceConfig(rows[0]?.value);
  } catch {
    return sanitizeMaintenanceConfig(null);
  } finally {
    if (pool && dsn) await pool.end().catch(() => undefined); // il pool di db() è condiviso: non va chiuso
  }
}
